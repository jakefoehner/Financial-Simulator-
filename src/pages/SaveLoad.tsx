import { open } from "@tauri-apps/plugin-dialog";
import { Download, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, PageHeader } from "../components/Card";
import { Toggle } from "../components/fields";
import { ConfirmDialog } from "../components/Sheet";
import { api, type BackupStatus, type HouseholdEntry } from "../lib/api";
import { friendlyPath, savedAtLabel } from "../lib/backup";
import { activeHousehold, useApp } from "../lib/store";

/** Saving everything to a file and loading it back, plus the family's households and automatic backups. */
export default function SaveLoad() {
  const household = useApp((s) => s.household!);
  const family = useApp((s) => s.family);
  const mutate = useApp((s) => s.mutate);
  const switchHousehold = useApp((s) => s.switchHousehold);
  const requestBackup = useApp((s) => s.requestBackup);
  const go = useApp((s) => s.go);
  const [backups, setBackups] = useState<BackupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<HouseholdEntry | null>(null);

  // Reload after every change: an automatic backup may have just been written.
  useEffect(() => {
    api
      .getBackupSettings()
      .then(setBackups)
      .catch((e) => setError(String(e)));
  }, [household]);

  const run = async (op: () => Promise<unknown>) => {
    setError(null);
    try {
      await op();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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

  const households = family?.households ?? [];
  const active = activeHousehold(family);
  const many = households.length > 1;
  const unbuilt = family?.children.filter((c) => c.householdId == null) ?? [];

  return (
    <>
      <PageHeader
        title="Save & load"
        subtitle="Keep everything you've entered in a file. It opens in this and every future version of the app, on this Mac or another one, so nothing ever has to be typed in again."
      />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid max-w-3xl gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <ActionCard
            icon={<Download size={20} />}
            title="Save my data"
            body={
              many
                ? `Everything for the whole family (${households.map((h) => h.name).join(", ")}) in one file.`
                : "Everything you've entered, including every plan, in one file."
            }
            button="Save my data…"
            primary
            onClick={() => requestBackup("save")}
          />
          <ActionCard
            icon={<Upload size={20} />}
            title="Load saved data"
            body="Open a file saved earlier (or sent by a family member). You'll see what's in it before anything changes."
            button="Load saved data…"
            onClick={() => requestBackup("open")}
          />
        </div>
        <p className="-mt-2 px-1 text-xs text-[var(--muted)]">
          Also in the File menu: ⌘S to save, ⌘O to load.{" "}
          <button className="font-medium text-accent hover:underline" onClick={() => requestBackup("view")}>
            View someone else's file without loading it…
          </button>
        </p>

        <Card title="Households in this app">
          <p className="mb-3 text-sm text-[var(--muted)]">
            Each child can have a full household of their own (accounts, income, debts, spending, plans and a forecast),
            linked to yours so your gifts and their inheritance show up in it.
          </p>
          <ul className="grid gap-2">
            {households.map((h) => (
              <li
                key={String(h.id)}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm"
              >
                <span>
                  <span className="font-medium">{h.name}</span>
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {h.id == null ? "Your household" : h.linkedPersonId != null ? "Linked to yours" : "Not linked"}
                  </span>
                </span>
                <span className="flex gap-2">
                  {h.active ? (
                    <span className="px-2 text-xs text-[var(--muted)]">Open now</span>
                  ) : (
                    <Button variant="ghost" onClick={() => void run(() => switchHousehold(h.id))}>
                      Open
                    </Button>
                  )}
                  {h.id != null && (
                    <Button variant="danger" onClick={() => setDeleting(h)}>
                      Delete
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {unbuilt.length > 0 && (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {unbuilt.map((c) => c.name).join(" and ")} {unbuilt.length === 1 ? "doesn't" : "don't"} have a household
              yet.{" "}
              <button
                className="font-medium text-accent hover:underline"
                onClick={() => void run(() => switchHousehold(null).then(() => go("people")))}
              >
                Build one from your People page
              </button>
              .
            </p>
          )}
          {active && many && (
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--border)] pt-3 text-sm">
              <span className="text-[var(--muted)]">
                Sending just one household (for example, a child sharing theirs)?
              </span>
              <Button onClick={() => requestBackup("saveOne")}>Save {active.name}'s only…</Button>
            </div>
          )}
        </Card>

        {backups && (
          <Card title="Automatic backups">
            <div className="grid gap-3">
              <Toggle
                label="Save backups automatically"
                hint="The whole family, after you make changes (at most every 5 minutes) and when you quit. The newest 10 are kept."
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
          </Card>
        )}
      </div>

      {deleting && deleting.id != null && (
        <ConfirmDialog
          title={`Delete ${deleting.name}'s household?`}
          body="Their accounts, income, debts and plans in this app are removed. A safety copy of the whole family is saved first. (Their name stays on your People page.)"
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            const id = deleting.id!;
            setDeleting(null);
            void run(() => mutate(() => api.deleteChildHousehold(id)));
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function ActionCard({
  icon,
  title,
  body,
  button,
  primary,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  button: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-2 flex items-center gap-2 text-accent">
        {icon}
        <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
      </div>
      <p className="mb-4 flex-1 text-sm text-[var(--muted)]">{body}</p>
      <Button variant={primary ? "primary" : "secondary"} onClick={onClick}>
        {button}
      </Button>
    </div>
  );
}
