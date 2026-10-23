import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BalanceChart } from "../components/BalanceChart";
import { Button, Card, EmptyState, PageHeader } from "../components/Card";
import { PercentField } from "../components/fields";
import { api } from "../lib/api";
import { formatPercent, formatUsd, formatUsdCompact } from "../lib/format";
import {
  BALANCE_SERIES,
  balanceRows,
  cashFlowRows,
  savingsVerdict,
  type ClaimAgeOutcome,
  type DollarMode,
  type Projection,
  type Tone,
} from "../lib/projection";
import { shallowEqual } from "../lib/equal";
import { useApp } from "../lib/store";
import { currentYear, DEFAULT_ASSUMPTIONS, type Assumptions } from "../lib/types";

export default function Results() {
  const household = useApp((s) => s.household!);
  const go = useApp((s) => s.go);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [claimAges, setClaimAges] = useState<ClaimAgeOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DollarMode>("today");

  // Re-run whenever the stored household changes (every edit returns a new object).
  useEffect(() => {
    const year = currentYear();
    Promise.all([api.runProjection(year), api.compareClaimAges(year)])
      .then(([p, c]) => {
        setProjection(p);
        setClaimAges(c);
        setError(null);
      })
      .catch((e) => {
        setProjection(null);
        setError(String(e));
      });
  }, [household]);

  const inflation = household.assumptions.inflation;
  const balances = useMemo(
    () => (projection ? balanceRows(projection, mode, inflation) : []),
    [projection, mode, inflation],
  );
  const flows = useMemo(
    () => (projection ? cashFlowRows(projection, mode, inflation) : []),
    [projection, mode, inflation],
  );

  if (error) {
    const needsPerson = household.people.every((p) => p.role !== "primary");
    return (
      <>
        <PageHeader title="Forecast" />
        <EmptyState
          title={needsPerson ? "Add yourself first" : "Couldn't run the forecast"}
          body={error}
          action={needsPerson ? <Button onClick={() => go("people")}>Go to People</Button> : undefined}
        />
      </>
    );
  }
  if (!projection) return null;

  const s = projection.summary;
  const first = projection.years[0];
  const firstYearTaxes = first ? first.taxes + first.medicareSurcharge : 0;
  const a = household.assumptions;
  const verdict = savingsVerdict(s, formatUsdCompact);

  return (
    <>
      <PageHeader
        title="Forecast"
        subtitle={`One steady path: investments grow ${formatPercent(a.stocksReturn)} (stocks) and ${formatPercent(a.bondsReturn)} (bonds) every year, prices rise ${formatPercent(a.inflation)}, and federal taxes are paid along the way. Ranges of good and bad markets come next.`}
        actions={<DollarToggle mode={mode} onChange={setMode} />}
      />

      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatusTile
            label="Does the money last?"
            tone={s.runsOutAtAge == null ? "good" : "bad"}
            value={s.runsOutAtAge == null ? `Yes, through age ${s.endAge}` : `Runs out at ${s.runsOutAtAge}`}
          />
          <StatusTile
            label="Living off growth & income?"
            tone={verdict.tone}
            value={verdict.text}
            hint={`Spendable savings in today's dollars: ${formatUsdCompact(s.startingInvestable)} now, ${formatUsdCompact(s.endingInvestableReal)} at ${s.endAge}.`}
          />
          <Tile
            label={`Net worth at ${s.endAge}`}
            value={formatUsdCompact(mode === "today" ? s.endingNetWorthReal : projection.years.at(-1)!.netWorth)}
            hint={mode === "today" ? "In today's dollars" : "In future dollars"}
          />
          <Tile
            label={`Taxes in ${s.startYear}`}
            value={formatUsd(firstYearTaxes)}
            hint="Federal, state, and Medicare surcharges"
          />
        </div>

        <BalancesCard projection={projection} rows={balances} mode={mode} />

        {claimAges.length > 0 && <ClaimAgeCard outcomes={claimAges} />}

        <Card title="Year by year">
          <div className="max-h-[28rem] overflow-y-auto rounded-md border border-[var(--border)]">
            <table className="w-full text-right text-xs tabular-nums">
              <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
                <tr>
                  {[
                    "Year",
                    "Age",
                    "Income",
                    "Social Security",
                    "From savings",
                    "Spending & debts",
                    "Taxes",
                    "Saved",
                    "Net worth",
                  ].map((h, i) => (
                    <th key={h} className={`px-3 py-2 font-medium ${i < 2 ? "text-left" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flows.map((r) => (
                  <tr key={r.year} className="border-t border-[var(--border)]">
                    <td className="px-3 py-1.5 text-left">{r.year}</td>
                    <td className="px-3 py-1.5 text-left">{r.age}</td>
                    <td className="px-3 py-1.5">{money(r.income)}</td>
                    <td className="px-3 py-1.5">{money(r.socialSecurity)}</td>
                    <td className="px-3 py-1.5">{money(r.fromSavings)}</td>
                    <td className="px-3 py-1.5">{money(r.spending)}</td>
                    <td className="px-3 py-1.5">{money(r.taxes)}</td>
                    <td className="px-3 py-1.5">{money(r.saved)}</td>
                    <td className="px-3 py-1.5 font-medium">
                      {r.shortfall > 1 ? (
                        <span className="text-[var(--critical)]">Short {formatUsd(r.shortfall)}</span>
                      ) : (
                        formatUsd(r.netWorth)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            "From savings" includes required minimum distributions from retirement accounts. "Saved" includes retirement
            contributions and anything left over.
          </p>
        </Card>

        <AssumptionsCard assumptions={household.assumptions} />
      </div>
    </>
  );
}

function money(v: number): string {
  return Math.abs(v) < 0.5 ? "—" : formatUsd(v);
}

function DollarToggle({ mode, onChange }: { mode: DollarMode; onChange: (m: DollarMode) => void }) {
  const opts: { id: DollarMode; label: string }[] = [
    { id: "today", label: "Today's dollars" },
    { id: "future", label: "Future dollars" },
  ];
  return (
    <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 text-xs" role="radiogroup">
      {opts.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={mode === o.id}
          onClick={() => onChange(o.id)}
          title={
            o.id === "today"
              ? "Inflation removed: what the money would buy today"
              : "The actual dollar amounts in each year"
          }
          className={`rounded-md px-3 py-1 transition ${mode === o.id ? "bg-accent text-white" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
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

function StatusTile({ label, tone, value, hint }: { label: string; tone: Tone; value: string; hint?: string }) {
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

function BalancesCard({
  projection,
  rows,
  mode,
}: {
  projection: Projection;
  rows: ReturnType<typeof balanceRows>;
  mode: DollarMode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card
      title={`What you own, by age (${mode === "today" ? "today's dollars" : "future dollars"})`}
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
        {projection.summary.startingInvestable > 0 &&
          `Savings you can spend today: ${formatUsd(projection.summary.startingInvestable)}. `}
        Real estate is counted but never sold to pay bills.
      </p>
    </Card>
  );
}

function ClaimAgeCard({ outcomes }: { outcomes: ClaimAgeOutcome[] }) {
  const best = outcomes.reduce((b, o) => (o.endingNetWorthReal > b.endingNetWorthReal ? o : b));
  return (
    <Card title="When to start Social Security">
      <p className="mb-3 text-sm text-[var(--muted)]">
        Starting later means bigger checks for life. Here's how each choice plays out in this forecast, in today's
        dollars.
      </p>
      <table className="w-full text-right text-sm tabular-nums">
        <thead className="text-xs text-[var(--muted)]">
          <tr>
            <th className="py-1.5 text-left font-medium">Start at</th>
            <th className="py-1.5 font-medium">Monthly check</th>
            <th className="py-1.5 font-medium">Total received</th>
            <th className="py-1.5 font-medium">Net worth at the end</th>
          </tr>
        </thead>
        <tbody>
          {outcomes.map((o) => (
            <tr
              key={o.claimAge}
              className={`border-t border-[var(--border)] ${o.isCurrentChoice ? "font-semibold" : ""}`}
            >
              <td className="py-2 text-left">
                {o.claimAge}
                {o.isCurrentChoice && <span className="ml-2 text-xs font-normal text-[var(--muted)]">your plan</span>}
                {o === best && !o.isCurrentChoice && (
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">most at the end</span>
                )}
              </td>
              <td className="py-2">{formatUsd(o.monthlyBenefitToday)}</td>
              <td className="py-2">{formatUsdCompact(o.lifetimeBenefitsReal)}</td>
              <td className="py-2">
                {o.runsOutAtAge != null ? `Runs out at ${o.runsOutAtAge}` : formatUsdCompact(o.endingNetWorthReal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-[var(--muted)]">Change your choice on the Income page.</p>
    </Card>
  );
}

function AssumptionsCard({ assumptions }: { assumptions: Assumptions }) {
  const mutate = useApp((s) => s.mutate);
  const [draft, setDraft] = useState(assumptions);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(assumptions), [assumptions]);

  const dirty = !shallowEqual(draft, assumptions);
  const isDefault = shallowEqual(assumptions, DEFAULT_ASSUMPTIONS);
  const set = (k: keyof Assumptions) => (v: number) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async (a: Assumptions) => {
    setError(null);
    try {
      await mutate(() => api.saveAssumptions(a));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card title="Assumptions">
      <p className="mb-4 text-sm text-[var(--muted)]">
        Yearly averages before inflation. Over the last century US stocks averaged about 10% and bonds about 5%; these
        defaults are deliberately more cautious.
      </p>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save(draft);
        }}
      >
        <div className="grid grid-cols-3 gap-4">
          <PercentField label="Stocks grow" value={draft.stocksReturn} onChange={set("stocksReturn")} />
          <PercentField label="Bonds grow" value={draft.bondsReturn} onChange={set("bondsReturn")} />
          <PercentField label="Cash earns" value={draft.cashReturn} onChange={set("cashReturn")} />
          <PercentField label="Real estate grows" value={draft.realEstateGrowth} onChange={set("realEstateGrowth")} />
          <PercentField label="Inflation" value={draft.inflation} onChange={set("inflation")} />
          <PercentField
            label="Stock dividends"
            hint="Part of the stock return, taxed yearly"
            value={draft.stockDividendYield}
            onChange={set("stockDividendYield")}
          />
        </div>
        {error && <p className="text-sm text-[var(--critical)]">{error}</p>}
        <div className="flex justify-end gap-2">
          {!isDefault && <Button onClick={() => void save(DEFAULT_ASSUMPTIONS)}>Reset to defaults</Button>}
          <Button variant="primary" type="submit" disabled={!dirty}>
            Update forecast
          </Button>
        </div>
      </form>
    </Card>
  );
}
