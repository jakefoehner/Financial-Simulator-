// Pieces shared by the steady path, the range of outcomes, and scenario detail.
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BalanceChart } from "../../components/BalanceChart";
import { Button, Card } from "../../components/Card";
import { formatUsd } from "../../lib/format";
import { BALANCE_SERIES, type BalanceRow, type CashFlowRow, type DollarMode, type Tone } from "../../lib/projection";

export function money(v: number): string {
  return Math.abs(v) < 0.5 ? "—" : formatUsd(v);
}

export function dollarsLabel(mode: DollarMode): string {
  return mode === "today" ? "today's dollars" : "future dollars";
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; title?: string }[];
}) {
  return (
    <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 text-xs" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          title={o.title}
          className={`rounded-md px-3 py-1 transition ${value === o.id ? "bg-accent text-white" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DollarToggle({ mode, onChange }: { mode: DollarMode; onChange: (m: DollarMode) => void }) {
  return (
    <Segmented
      value={mode}
      onChange={onChange}
      options={[
        { id: "today", label: "Today's dollars", title: "Inflation removed: what the money would buy today" },
        { id: "future", label: "Future dollars", title: "The actual dollar amounts in each year" },
      ]}
    />
  );
}

export function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

/** Status is carried by icon + text, with color only as reinforcement. */
const TONE_ICON = { good: CircleCheck, caution: TriangleAlert, bad: CircleAlert } as const;
const TONE_COLOR = { good: "var(--good)", caution: "var(--warning)", bad: "var(--critical)" } as const;

export function StatusTile({ label, tone, value, hint }: { label: string; tone: Tone; value: string; hint?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 flex items-start gap-1.5 text-base font-semibold tracking-tight">
        <Icon size={18} className="mt-0.5 shrink-0" style={{ color: TONE_COLOR[tone] }} aria-hidden />
        <span>{value}</span>
      </p>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export function BalancesCard({ rows, mode, footnote }: { rows: BalanceRow[]; mode: DollarMode; footnote?: string }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card
      title={`What you own, by age (${dollarsLabel(mode)})`}
      actions={
        <Button variant="ghost" onClick={() => setView(view === "chart" ? "table" : "chart")}>
          {view === "chart" ? "Show as table" : "Show as chart"}
        </Button>
      }
    >
      {view === "chart" ? (
        <BalanceChart rows={rows} />
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-[var(--border)]">
          <table className="w-full text-right text-xs tabular-nums">
            <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Age</th>
                {BALANCE_SERIES.map((s) => (
                  <th key={s.key} className="px-3 py-2 font-medium">
                    {s.label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Debts</th>
                <th className="px-3 py-2 font-medium">Net worth</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.age} className="border-t border-[var(--border)]">
                  <td className="px-3 py-1.5 text-left">{r.age}</td>
                  {BALANCE_SERIES.map((s) => (
                    <td key={s.key} className="px-3 py-1.5">
                      {money(r[s.key])}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">{money(r.debt)}</td>
                  <td className="px-3 py-1.5 font-medium">{formatUsd(r.netWorth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--muted)]">
        {footnote ? `${footnote} ` : ""}Real estate is counted but never sold to pay bills.
      </p>
    </Card>
  );
}

export function YearByYearCard({ rows, extra }: { rows: CashFlowRow[]; extra?: (year: number) => ReactNode }) {
  // Only plans that give or lend money get the extra column.
  const showGiving = rows.some((r) => r.giving > 0.5);
  const headers = [
    "Year",
    "Age",
    "Income",
    "Social Security",
    "From savings",
    "Spending & debts",
    ...(showGiving ? ["Gifts & loans"] : []),
    "Taxes",
    "Saved",
    "Net worth",
  ];
  return (
    <Card title="Year by year">
      <div className="max-h-[28rem] overflow-y-auto rounded-md border border-[var(--border)]">
        <table className="w-full text-right text-xs tabular-nums">
          <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
            <tr>
              {headers.map((h, i) => (
                <th key={h} className={`px-3 py-2 font-medium ${i < 2 ? "text-left" : ""}`}>
                  {h}
                </th>
              ))}
              {extra && <th className="px-3 py-2 text-left font-medium">Markets replayed</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-t border-[var(--border)]">
                <td className="px-3 py-1.5 text-left">{r.year}</td>
                <td className="px-3 py-1.5 text-left">{r.age}</td>
                <td className="px-3 py-1.5">{money(r.income)}</td>
                <td className="px-3 py-1.5">{money(r.socialSecurity)}</td>
                <td className="px-3 py-1.5">{money(r.fromSavings)}</td>
                <td className="px-3 py-1.5">{money(r.spending)}</td>
                {showGiving && <td className="px-3 py-1.5">{money(r.giving)}</td>}
                <td className="px-3 py-1.5">{money(r.taxes)}</td>
                <td className="px-3 py-1.5">{money(r.saved)}</td>
                <td className="px-3 py-1.5 font-medium">
                  {r.shortfall > 1 ? (
                    <span className="text-[var(--critical)]">Short {formatUsd(r.shortfall)}</span>
                  ) : (
                    formatUsd(r.netWorth)
                  )}
                </td>
                {extra && <td className="px-3 py-1.5 text-left">{extra(r.year)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        "From savings" includes required minimum distributions from retirement accounts. "Saved" includes retirement
        contributions and anything left over.{showGiving && ' "Income" includes family loan repayments.'}
      </p>
    </Card>
  );
}
