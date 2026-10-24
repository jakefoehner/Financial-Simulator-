import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { api, type BackupInfo, type FamilyOverview, type LoadTarget } from "../lib/api";
import { BACKUP_FILTERS, backupContents, defaultBackupName, passwordProblem, savedAtLabel } from "../lib/backup";
import { activeHousehold, useApp } from "../lib/store";
import { SelectField, TextField, Toggle } from "./fields";
import { Sheet } from "./Sheet";

type Step =
  | { kind: "save"; scope: "family" | "household" }
  | { kind: "saved"; path: string; encrypted: boolean }
  | { kind: "password"; path: string }
  | { kind: "confirm"; path: string; password: string | null; info: BackupInfo }
  | { kind: "restored"; info: BackupInfo; whole: boolean }
  | { kind: "failed"; message: string };

/** Where a one-household file can go: "everything" | "main" | "child:<personId>" | "new". */
function loadChoices(family: FamilyOverview | null): { value: string; label: string }[] {
  const main = family?.households[0]?.name ?? "your";
  return [
    { value: "everything", label: "Replace everything (every household in this app)" },
    { value: "main", label: `As ${main}'s household (children's households are kept)` },
    ...(family?.children ?? []).map((c) => ({
      value: `child:${c.personId}`,
      label: `As ${c.name}'s household${c.householdId != null ? " (replaces it)" : ""}`,
    })),
    { value: "new", label: "As a new child household (not linked to anyone)" },
  ];
}

function toTarget(choice: string): LoadTarget {
  if (choice.startsWith("child:")) return { kind: "child", personId: Number(choice.slice(6)) };
  if (choice === "main") return { kind: "main" };
  if (choice === "new") return { kind: "newChild" };
  return { kind: "everything" };
}

/**
 * Save my data / Load saved data, started from the File menu or the Save & load page.
 * Mounted once at the app root.
 */
export function BackupDialogs() {
  const request = useApp((s) => s.backupRequest);
  const requestBackup = useApp((s) => s.requestBackup);
  const household = useApp((s) => s.household);
  const family = useApp((s) => s.family);
  const mutate = useApp((s) => s.mutate);
  const go = useApp((s) => s.go);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [loadAs, setLoadAs] = useState("everything");
  // Opening a file to look at (read-only) rather than to load.
  const viewOnly = useRef(false);

  // File menu → the same flows as the Settings buttons.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("menu", (e) => {
      if (e.payload === "save_backup") requestBackup("save");
      if (e.payload === "open_backup") requestBackup("open");
      if (e.payload === "import_file") {
        useApp.getState().go("accounts");
        useApp.getState().setImportRequest(true);
      }
    })
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, [requestBackup]);

  const close = () => {
    setStep(null);
    setError(null);
    setBusy(false);
    setPassword("");
    setAgain("");
    setUsePassword(false);
  };

  const inspect = async (path: string, pw: string | null) => {
    const preview = await api.inspectBackup(path, pw);
    if (preview.needsPassword) setStep({ kind: "password", path });
    else if (preview.info && viewOnly.current) {
      await api.viewBackup(path, pw);
      await useApp.getState().load();
      go("overview");
      close();
    } else if (preview.info) {
      // A child's own file most likely belongs to that child.
      const name = preview.info.households[0];
      const child = useApp.getState().family?.children.find((c) => c.name === name);
      setLoadAs(child ? `child:${child.personId}` : "everything");
      setStep({ kind: "confirm", path, password: pw, info: preview.info });
    }
  };

  useEffect(() => {
    if (!request) return;
    requestBackup(null);
    close();
    viewOnly.current = request === "view";
    if (request === "save" || request === "saveOne") {
      setStep({ kind: "save", scope: request === "saveOne" ? "household" : "family" });
      return;
    }
    void (async () => {
      try {
        const path = await open({ multiple: false, directory: false, filters: BACKUP_FILTERS });
        if (typeof path === "string") await inspect(path, null);
      } catch (e) {
        setStep({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [request, requestBackup]);

  if (!step || !household) return null;

  const run = async (op: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await op();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const active = activeHousehold(family);
  const many = (family?.households.length ?? 1) > 1;

  if (step.kind === "save") {
    const scope = step.scope;
    const problem = usePassword
      ? password === ""
        ? "Enter a password, or turn this off."
        : passwordProblem(password, again)
      : null;
    return (
      <Sheet
        title="Save a backup"
        error={error}
        saving={busy}
        saveLabel="Choose where to save…"
        onCancel={close}
        onSave={() =>
          run(async () => {
            if (problem) throw new Error(problem);
            const name = scope === "household" || !many ? (active?.name ?? household.info.name) : household.info.name;
            const path = await save({ defaultPath: defaultBackupName(name), filters: BACKUP_FILTERS });
            if (!path) return;
            await api.saveBackup(path, usePassword ? password : null, many ? scope : "family");
            setStep({ kind: "saved", path, encrypted: usePassword });
          })
        }
      >
        <p className="text-sm text-[var(--muted)]">
          Saves everything you've entered (people, accounts, income, debts, spending, assumptions, and every plan) in
          one file. You can open it in this or any future version of the app, on this Mac or another.
        </p>
        {many && active && (
          <SelectField<"family" | "household">
            label="What to save"
            value={scope}
            onChange={(s) => setStep({ kind: "save", scope: s })}
            options={[
              { value: "family", label: `The whole family (${family!.households.map((h) => h.name).join(", ")})` },
              { value: "household", label: `Just ${active.name}'s household` },
            ]}
          />
        )}
        <Toggle
          label="Protect with a password"
          hint="Recommended if you'll email the file or keep it somewhere shared."
          checked={usePassword}
          onChange={setUsePassword}
        />
        {usePassword && (
          <>
            <TextField label="Password" type="password" value={password} onChange={setPassword} autoFocus />
            <TextField label="Type it again" type="password" value={again} onChange={setAgain} />
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Write the password down somewhere safe. If it's forgotten, nobody (including us) can open the file.
            </p>
          </>
        )}
      </Sheet>
    );
  }

  if (step.kind === "saved" || step.kind === "restored") {
    return (
      <Sheet
        title={step.kind === "saved" ? "Saved" : "Loaded"}
        error={null}
        saving={false}
        saveLabel="Done"
        onSave={close}
        onCancel={close}
      >
        {step.kind === "saved" ? (
          <p className="text-sm">
            Saved{step.encrypted ? " with a password" : ""} to{" "}
            <span className="font-mono text-xs break-all select-text">{step.path}</span>
          </p>
        ) : (
          <p className="text-sm">
            {step.whole
              ? `Loaded ${step.info.households.join(", ")}: ${backupContents(step.info)}.`
              : `Loaded ${step.info.households[0]}'s household. It's open now; switch households at the top of the sidebar.`}
          </p>
        )}
      </Sheet>
    );
  }

  if (step.kind === "failed") {
    return (
      <Sheet
        title="Couldn't open that backup"
        error={null}
        saving={false}
        saveLabel="OK"
        onSave={close}
        onCancel={close}
      >
        <p className="text-sm">{step.message}</p>
      </Sheet>
    );
  }

  if (step.kind === "password") {
    return (
      <Sheet
        title="This backup has a password"
        error={error}
        saving={busy}
        saveLabel="Open"
        savingLabel="Opening…"
        onCancel={close}
        onSave={() => run(() => inspect(step.path, password))}
      >
        <TextField label="Password" type="password" value={password} onChange={setPassword} autoFocus />
      </Sheet>
    );
  }

  const { info } = step;
  const saved = savedAtLabel(info.savedAt);
  const isFamily = info.households.length > 1;
  const whole = isFamily || loadAs === "everything";
  return (
    <Sheet
      title="Load this saved data?"
      error={error}
      saving={busy}
      saveLabel={whole ? "Replace everything" : "Load it"}
      savingLabel="Loading…"
      onCancel={close}
      onSave={() =>
        run(async () => {
          await mutate(() => api.restoreBackup(step.path, step.password, isFamily ? null : toTarget(loadAs)));
          go("overview");
          setStep({ kind: "restored", info, whole });
        })
      }
    >
      <div className="grid gap-1 rounded-lg border border-[var(--border)] px-4 py-3 text-sm">
        <p className="font-medium">
          {isFamily ? `${info.households.length} households: ${info.households.join(", ")}` : info.households[0]}
        </p>
        <p className="text-[var(--muted)]">
          {isFamily ? `${info.households[0]}: ` : ""}
          {backupContents(info)}
        </p>
        {(saved || info.appVersion) && (
          <p className="text-xs text-[var(--muted)]">
            {saved ? `Saved ${saved}` : "Saved"}
            {info.appVersion ? ` with version ${info.appVersion}` : ""}
            {info.encrypted ? " · password protected" : ""}
          </p>
        )}
      </div>
      {!isFamily && (
        <SelectField<string> label="Load it" value={loadAs} onChange={setLoadAs} options={loadChoices(family)} />
      )}
      <p className="text-sm text-[var(--muted)]">
        {whole
          ? "Everything currently in the app is replaced by what's in this file."
          : "Only that household changes; everything else stays as it is."}{" "}
        A safety copy of your current data is saved first, so nothing is lost.
      </p>
    </Sheet>
  );
}
