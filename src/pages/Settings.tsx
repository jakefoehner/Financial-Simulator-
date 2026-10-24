import { useEffect, useState } from "react";
import { Button, Card, PageHeader } from "../components/Card";
import { PercentField, Row, SelectField, TextField, Toggle } from "../components/fields";
import { ConfirmDialog } from "../components/Sheet";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type AppInfo, type BackupStatus } from "../lib/api";
import { friendlyPath, savedAtLabel } from "../lib/backup";
import { shallowEqual } from "../lib/equal";
import { useApp } from "../lib/store";
import { FILING_STATUS_LABELS, type FilingStatus, type HouseholdInfo } from "../lib/types";

export default function Settings() {
  const info = useApp((s) => s.household!.info);
  const mutate = useApp((s) => s.mutate);
  const [draft, setDraft] = useState<HouseholdInfo>(info);
  const [about, setAbout] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const requestBackup = useApp((s) => s.requestBackup);
  const [backups, setBackups] = useState<BackupStatus | null>(null);

  useEffect(() => setDraft(info), [info]);
  useEffect(() => {
    api
      .appInfo()
      .then(setAbout)
      .catch((e) => setError(String(e)));
  }, []);
  // Reload after every change: an automatic backup may have just been written.
  useEffect(() => {
    api
      .getBackupSettings()
      .then(setBackups)
      .catch((e) => setError(String(e)));
  }, [info]);

  const saveBackupSettings = (autoBackup: boolean, backupFolder: string | null) =>
    run(async () => setBackups(await api.saveBackupSettings({ autoBackup, backupFolder, lastAutoBackup: null })));

  const chooseFolder = async () => {
    const folder = await open({
      directory: true,
      multiple: false,
      defaultPath: backups?.settings.backupFolder ?? undefined,
      title: "Choose a folder for automatic backups",
    });
    if (typeof folder === "string") await saveBackupSettings(true, folder);
  };

  const dirty = !shallowEqual(draft, info);
  const set = <K extends keyof HouseholdInfo>(k: K, v: HouseholdInfo[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const run = async (op: () => Promise<unknown>) => {
    setError(null);
    try {
      await op();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid max-w-2xl gap-5">
        <Card title="Your data">
          <p className="text-sm text-[var(--muted)]">
            Save everything you've entered to a file you keep. It opens in this and every future version of the app, so
            you never have to type it in again.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => requestBackup("save")}>
              Save a backup…
            </Button>
            <Button onClick={() => requestBackup("open")}>Open a backup…</Button>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">Also in the File menu (⌘S to save, ⌘O to open).</p>

          {backups && (
            <div className="mt-5 grid gap-3 border-t border-[var(--border)] pt-4">
              <Toggle
                label="Save backups automatically"
                hint="After you make changes (at most every 5 minutes) and when you quit. The newest 10 are kept."
                checked={backups.settings.autoBackup}
                onChange={(on) =>
                  on && !backups.settings.backupFolder
                    ? void chooseFolder()
                    : void saveBackupSettings(on, backups.settings.backupFolder)
                }
              />
              {backups.settings.backupFolder ? (
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="min-w-0">
                    <span className="text-[var(--muted)]">Folder: </span>
                    <span className="break-all select-text">{friendlyPath(backups.settings.backupFolder)}</span>
                  </span>
                  <Button variant="ghost" onClick={() => void chooseFolder()}>
                    Change…
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">
                  Suggested: a folder in Documents, or in iCloud Drive to keep a copy off this Mac (
                  {friendlyPath(backups.suggestedFolder)}).
                </p>
              )}
              {backups.settings.autoBackup && (
                <p className="text-xs text-[var(--muted)]">
                  {savedAtLabel(backups.settings.lastAutoBackup)
                    ? `Last saved ${savedAtLabel(backups.settings.lastAutoBackup)}.`
                    : "No automatic backup yet."}{" "}
                  Automatic backups have no password, so pick a folder only you can reach.
                </p>
              )}
              {backups.lastError && <p className="text-sm text-red-600 dark:text-red-400">{backups.lastError}</p>}
            </div>
          )}
        </Card>

        <Card title="Household">
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => mutate(() => api.saveHouseholdInfo(draft)))) setSaved(true);
            }}
          >
            <TextField label="Household name" value={draft.name} onChange={(v) => set("name", v)} />
            <SelectField<FilingStatus>
              label="Tax filing status"
              value={draft.filingStatus}
              onChange={(v) => set("filingStatus", v)}
              options={(Object.keys(FILING_STATUS_LABELS) as FilingStatus[]).map((f) => ({
                value: f,
                label: FILING_STATUS_LABELS[f],
              }))}
            />
            <Row>
              <TextField
                label="State"
                value={draft.state}
                onChange={(v) => set("state", v.toUpperCase().slice(0, 2))}
              />
              <PercentField
                label="State income tax (flat estimate)"
                hint="Texas, Florida, and a few others have none: leave it at 0%."
                value={draft.flatStateRate}
                onChange={(v) => set("flatStateRate", v)}
              />
            </Row>
            <div className="flex items-center justify-end gap-3">
              {saved && !dirty && <span className="text-xs text-[var(--muted)]">Saved</span>}
              <Button variant="primary" type="submit" disabled={!dirty}>
                Save
              </Button>
            </div>
          </form>
        </Card>

        <Card title="About">
          {about && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-[var(--muted)]">App version</dt>
              <dd>{about.appVersion}</dd>
              <dt className="text-[var(--muted)]">Engine version</dt>
              <dd>{about.engineVersion}</dd>
              <dt className="text-[var(--muted)]">Database schema</dt>
              <dd>v{about.schemaVersion}</dd>
              <dt className="text-[var(--muted)]">Data stored at</dt>
              <dd className="font-mono text-xs break-all select-text">{about.dbPath}</dd>
            </dl>
          )}
          <p className="mt-3 text-xs text-[var(--muted)]">
            Your data stays on this Mac, except backups you save elsewhere.
          </p>
        </Card>

        <Card title="Start over">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-[var(--muted)]">
              Erase every person, account, income, debt, expense, and plan. A safety copy is saved first.
            </p>
            <Button variant="danger" onClick={() => setConfirmErase(true)}>
              Erase all data
            </Button>
          </div>
        </Card>
      </div>

      {confirmErase && (
        <ConfirmDialog
          title="Erase all data?"
          body="This removes everything you've entered. A safety copy is saved first, which you can open with Open a backup…"
          confirmLabel="Erase"
          danger
          onConfirm={async () => {
            setConfirmErase(false);
            await run(() => mutate(api.clearHousehold));
          }}
          onCancel={() => setConfirmErase(false)}
        />
      )}
    </>
  );
}
