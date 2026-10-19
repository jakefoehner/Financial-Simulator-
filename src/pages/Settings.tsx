import { useEffect, useState } from "react";
import { api, type AppInfo } from "../lib/api";
import { Card, PageHeader } from "../components/Card";

export default function Settings() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .appInfo()
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <>
      <PageHeader title="Settings" />
      <Card title="About">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {info && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-[var(--muted)]">App version</dt>
            <dd>{info.appVersion}</dd>
            <dt className="text-[var(--muted)]">Engine version</dt>
            <dd>{info.engineVersion}</dd>
            <dt className="text-[var(--muted)]">Database schema</dt>
            <dd>v{info.schemaVersion}</dd>
            <dt className="text-[var(--muted)]">Data stored at</dt>
            <dd className="font-mono text-xs break-all select-text">{info.dbPath}</dd>
          </dl>
        )}
      </Card>
    </>
  );
}
