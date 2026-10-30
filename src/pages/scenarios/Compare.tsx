import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../components/Card";
import { api } from "../../lib/api";
import { formatUsd, formatUsdCompact } from "../../lib/format";
import type { Projection } from "../../lib/projection";
import type { Simulation } from "../../lib/simulation";
import type { Household, Id } from "../../lib/types";

/** First three categorical slots: validated for all pairs, so up to three plans stay distinguishable. */
const PLAN_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

interface PlanResult {
  id: Id | null;
  name: string;
  sim: Simulation;
  steady: Projection;
}

export function planName(h: Household, id: Id | null): string {
  return id == null ? "Base plan" : (h.scenarios.find((s) => s.id === id)?.name ?? "Plan");
}

export default function Compare({
  household,
  plans,
  startYear,
}: {
  household: Household;
  plans: (Id | null)[];
  startYear: number;
}) {
  const [results, setResults] = useState<PlanResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResults(null);
    Promise.all(
      plans.map(async (id) => ({
        id,
        name: planName(household, id),
        sim: await api.runSimulation(startYear, id),
        steady: await api.runProjection(startYear, id),
      })),
    )
      .then(setResults)
      .catch((e) => setError(String(e)));
  }, [household, plans, startYear]);

  if (error) return <p className="text-sm text-[var(--critical)]">{error}</p>;
  if (!results) return <p className="text-sm text-[var(--muted)]">Running each plan…</p>;

  const endAge = results[0].sim.ages.at(-1);
  const kids = results[0].sim.estate.children;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const charityOf = (r: PlanResult) =>
    r.steady.summary.estate.lifetimeCharityReal + r.steady.summary.estate.charitableBequestReal;
  const eventsOf = (r: PlanResult) => household.scenarios.find((s) => s.id === r.id)?.events ?? [];
  const anyCharity = results.some((r) => charityOf(r) > 0.5);
  const anyGrat = results.some((r) => eventsOf(r).some((e) => e.type === "grat"));
  const rows: { label: string; hint?: string; cell: (r: PlanResult) => string }[] = [
    { label: "Chance the money lasts", cell: (r) => pct(r.sim.moneyLasts) },
    { label: "Chance you live off growth & income", cell: (r) => pct(r.sim.livesOffGrowth) },
    { label: `Your typical savings at ${endAge}`, cell: (r) => formatUsdCompact(r.sim.investableReal.p50.at(-1)!) },
    {
      label: `Your savings at ${endAge}, rough markets`,
      cell: (r) => formatUsdCompact(r.sim.investableReal.p10.at(-1)!),
    },
    {
      label: "Given to the kids during your life",
      cell: (r) => formatUsdCompact(r.steady.summary.estate.lifetimeGiftsReal),
    },
    { label: "Estate tax (typical)", cell: (r) => formatUsdCompact(r.sim.estate.estateTaxReal.p50) },
    { label: "The kids receive in total (typical)", cell: (r) => formatUsdCompact(r.sim.estate.familyTotalReal.p50) },
    { label: "The kids receive, rough markets", cell: (r) => formatUsdCompact(r.sim.estate.familyTotalReal.p10) },
    // GRATs pay off in strong markets, so show that end of the range when one is in play.
    ...(anyGrat
      ? [
          {
            label: "The kids receive, strong markets",
            cell: (r: PlanResult) => formatUsdCompact(r.sim.estate.familyTotalReal.p90),
          },
        ]
      : []),
    ...(results.some((r) => r.sim.conditionalGifts)
      ? [
          {
            label: "Gifts made while savings held (avg)",
            cell: (r: PlanResult) =>
              r.sim.conditionalGifts
                ? `${r.sim.conditionalGifts.madeAverage.toFixed(1)} of ${r.sim.conditionalGifts.scheduled.toFixed(0)}`
                : "—",
          },
        ]
      : []),
    ...(anyCharity
      ? [{ label: "To charity (life + will)", cell: (r: PlanResult) => formatUsdCompact(charityOf(r)) }]
      : []),
    ...kids.map((k, i) => ({
      label: `${k.name} receives (typical)`,
      cell: (r: PlanResult) => formatUsdCompact(r.sim.estate.children[i]?.totalReal.p50 ?? 0),
    })),
  ];

  const chartRows = results[0].sim.ages.map((age, i) => ({
    age,
    ...Object.fromEntries(results.map((r, k) => [`p${k}`, r.sim.investableReal.p50[i]])),
  }));

  return (
    <div className="grid gap-5">
      <Card title="Side by side (today's dollars)">
        <table className="w-full text-right text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-[var(--muted)]">
              <th className="py-2 text-left font-medium" />
              {results.map((r, k) => (
                <th key={String(r.id)} className="py-2 pl-4 font-medium">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PLAN_COLORS[k] }} />
                  <span className="text-[var(--text)]">{r.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-[var(--border)]">
                <td className="py-2 text-left text-[var(--muted)]">{row.label}</td>
                {results.map((r) => (
                  <td key={String(r.id)} className="py-2 pl-4">
                    {row.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[var(--muted)]">
          "Typical" is the middle of {results[0].sim.scenarios.toLocaleString("en-US")} market scenarios; "rough
          markets" is 1 in 10{anyGrat ? ', "strong markets" 9 in 10' : ""}. What the kids receive counts gifts grown to
          age {results[0].sim.estate.age} at your portfolio's return, plus the inheritance after estate tax and an
          assumed {Math.round(household.assumptions.heirIncomeTaxRate * 100)}% income tax on inherited retirement
          accounts.
        </p>
      </Card>

      <Card title={`Your typical spendable savings, by age (today's dollars)`}>
        <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]" aria-label="Legend">
          {results.map((r, k) => (
            <li key={String(r.id)} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded" style={{ background: PLAN_COLORS[k] }} />
              {r.name}
            </li>
          ))}
        </ul>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="age"
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--axis)" }}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={formatUsdCompact}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-lg">
                      <p className="mb-1 font-medium">Age {label}</p>
                      {results.map((r, k) => (
                        <p key={String(r.id)} className="flex justify-between gap-4 tabular-nums">
                          <span className="text-[var(--muted)]">{r.name}</span>
                          <span>{formatUsd(Number(payload.find((p) => p.dataKey === `p${k}`)?.value ?? 0))}</span>
                        </p>
                      ))}
                    </div>
                  ) : null
                }
              />
              {results.map((r, k) => (
                <Line
                  key={String(r.id)}
                  type="linear"
                  dataKey={`p${k}`}
                  stroke={PLAN_COLORS[k]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: PLAN_COLORS[k], stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
