import { useEffect, useState } from "react";
import { api, type Household, type YearRow } from "../lib/api";
import { formatUsd, formatUsdCompact, parseUsd } from "../lib/format";
import { Card, PageHeader } from "../components/Card";

const inputClass =
  "rounded-md border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

export default function Overview() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getHousehold()
      .then((h) => {
        setHousehold(h);
        setNameDraft(h.name);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name || name === household?.name) return;
    try {
      setHousehold(await api.updateHousehold({ name }));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <>
      <PageHeader
        title={household?.name ?? "Overview"}
        subtitle="Phase 0 preview. Data entry and real forecasts arrive in the next phases."
      />
      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <div className="grid gap-5">
        <Card title="Household">
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28 text-[var(--muted)]">Name</span>
            <input
              className={`${inputClass} w-72`}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </label>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Saved to your local SQLite database when you leave the field.
          </p>
        </Card>

        <ProjectionPreview />
      </div>
    </>
  );
}

function ProjectionPreview() {
  const [balance, setBalance] = useState("2,000,000");
  const [spend, setSpend] = useState("100,000");
  const [stocksPct, setStocksPct] = useState(60);
  const [rows, setRows] = useState<YearRow[]>([]);

  useEffect(() => {
    const start = parseUsd(balance);
    const annual = parseUsd(spend);
    if (Number.isNaN(start) || Number.isNaN(annual)) return;
    const allocation = { stocks: stocksPct / 100, bonds: (100 - stocksPct) / 100, cash: 0 };
    api
      .previewProjection(start, allocation, annual, 30)
      .then(setRows)
      .catch(() => setRows([]));
  }, [balance, spend, stocksPct]);

  const last = rows[rows.length - 1];

  return (
    <Card title="Engine check: 30-year fixed-return projection">
      <div className="mb-4 flex flex-wrap items-center gap-5 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Portfolio</span>
          <input className={`${inputClass} w-32`} value={balance} onChange={(e) => setBalance(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Spend / yr (today's $)</span>
          <input className={`${inputClass} w-28`} value={spend} onChange={(e) => setSpend(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Stocks {stocksPct}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={stocksPct}
            onChange={(e) => setStocksPct(+e.target.value)}
          />
        </label>
      </div>

      {last && (
        <p className="mb-3 text-sm">
          After 30 years: <strong>{formatUsdCompact(last.end_balance)}</strong> nominal,{" "}
          <strong>{formatUsdCompact(last.end_balance_real)}</strong> in today's dollars.
          <span className="text-[var(--muted)]"> (7% stocks / 4% bonds / 2.5% inflation, no taxes yet)</span>
        </p>
      )}

      <div className="max-h-72 overflow-y-auto rounded-md border border-[var(--border)]">
        <table className="w-full text-right text-xs tabular-nums">
          <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Year</th>
              <th className="px-3 py-1.5 font-medium">Start</th>
              <th className="px-3 py-1.5 font-medium">Withdrawal</th>
              <th className="px-3 py-1.5 font-medium">Growth</th>
              <th className="px-3 py-1.5 font-medium">End</th>
              <th className="px-3 py-1.5 font-medium">End (today's $)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year_index} className="border-t border-[var(--border)]">
                <td className="px-3 py-1 text-left">{r.year_index + 1}</td>
                <td className="px-3 py-1">{formatUsd(r.start_balance)}</td>
                <td className="px-3 py-1">{formatUsd(r.withdrawal)}</td>
                <td className="px-3 py-1">{formatUsd(r.growth)}</td>
                <td className="px-3 py-1">{formatUsd(r.end_balance)}</td>
                <td className="px-3 py-1">{formatUsd(r.end_balance_real)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
