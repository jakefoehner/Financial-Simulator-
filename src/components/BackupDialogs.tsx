import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, type BackupInfo } from "../lib/api";
import { BACKUP_FILTERS, backupContents, defaultBackupName, passwordProblem, savedAtLabel } from "../lib/backup";
import { useApp } from "../lib/store";
import { TextField, Toggle } from "./fields";
import { Sheet } from "./Sheet";

type Step =
  | { kind: "save" }
  | { kind: "saved"; path: string; encrypted: boolean }
  | { kind: "password"; path: string }
  | { kind: "confirm"; path: string; password: string | null; info: BackupInfo }
  | { kind: "restored"; info: BackupInfo }
  | { kind: "failed"; message: string };

/**
 * Save a backup / Open a backup, started from the File menu or the Settings card.
 * Mounted once at the app root.
 */
export function BackupDialogs() {
  const request = useApp((s) => s.backupRequest);
  const requestBackup = useApp((s) => s.requestBackup);
  const household = useApp((s) => s.household);
  const mutate = useApp((s) => s.mutate);
  const go = useApp((s) => s.go);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");

  // File menu → the same flows as the Settings buttons.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("menu", (e) => {
      if (e.payload === "save_backup") requestBackup("save");
      if (e.payload === "open_backup") requestBackup("open");
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
    else if (preview.info) setStep({ kind: "confirm", path, password: pw, info: preview.info });
  };

  useEffect(() => {
    if (!request) return;
    requestBackup(null);
    close();
    if (request === "save") {
      setStep({ kind: "save" });
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

  if (step.kind === "save") {
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
            const path = await save({ defaultPath: defaultBackupName(household.info.name), filters: BACKUP_FILTERS });
            if (!path) return;
            await api.saveBackup(path, usePassword ? password : null);
            setStep({ kind: "saved", path, encrypted: usePassword });
          })
        }
      >
        <p className="text-sm text-[var(--muted)]">
          Saves everything you've entered (people, accounts, income, debts, spending, assumptions, and every plan) in
          one file. You can open it in this or any future version of the app, on this Mac or another.
        </p>
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
        title={step.kind === "saved" ? "Backup saved" : "Backup restored"}
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
            Your data now matches the backup of {step.info.householdName}: {backupContents(step.info)}.
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
  return (
    <Sheet
      title="Replace your data with this backup?"
      error={error}
      saving={busy}
      saveLabel="Replace my data"
      savingLabel="Restoring…"
      onCancel={close}
      onSave={() =>
        run(async () => {
          await mutate(() => api.restoreBackup(step.path, step.password));
          go("overview");
          setStep({ kind: "restored", info });
        })
      }
    >
      <div className="grid gap-1 rounded-lg border border-[var(--border)] px-4 py-3 text-sm">
        <p className="font-medium">{info.householdName}</p>
        <p className="text-[var(--muted)]">{backupContents(info)}</p>
        {(saved || info.appVersion) && (
          <p className="text-xs text-[var(--muted)]">
            {saved ? `Saved ${saved}` : "Saved"}
            {info.appVersion ? ` with version ${info.appVersion}` : ""}
            {info.encrypted ? " · password protected" : ""}
          </p>
        )}
      </div>
      <p className="text-sm text-[var(--muted)]">
        Everything currently in the app is replaced by what's in this file. A safety copy of your current data is saved
        first, so nothing is lost.
      </p>
    </Sheet>
  );
}
