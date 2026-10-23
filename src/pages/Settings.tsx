import { useEffect, useState } from "react";
import { Button, Card, PageHeader } from "../components/Card";
import { PercentField, Row, SelectField, TextField } from "../components/fields";
import { ConfirmDialog } from "../components/Sheet";
import { api, type AppInfo } from "../lib/api";
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

  useEffect(() => setDraft(info), [info]);
  useEffect(() => {
    api
      .appInfo()
      .then(setAbout)
      .catch((e) => setError(String(e)));
  }, []);

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
          <p className="mt-3 text-xs text-[var(--muted)]">Your data never leaves this Mac.</p>
        </Card>

        <Card title="Start over">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-[var(--muted)]">Erase every person, account, income, debt, and expense.</p>
            <Button variant="danger" onClick={() => setConfirmErase(true)}>
              Erase all data
            </Button>
          </div>
        </Card>
      </div>

      {confirmErase && (
        <ConfirmDialog
          title="Erase all data?"
          body="This removes everything you've entered. It can't be undone."
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
