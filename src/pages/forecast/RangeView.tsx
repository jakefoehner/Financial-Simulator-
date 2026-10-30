import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Card } from "../../components/Card";
import { FanChart } from "../../components/FanChart";
import { MethodNote } from "../../components/MethodNote";
import { api } from "../../lib/api";
import { formatUsd, formatUsdCompact } from "../../lib/format";
import type { DollarMode, EstateResult, Tone } from "../../lib/projection";
import {
  fanRows,
  outOf100,
  SCENARIO_LABELS,
  SCENARIO_ORDER,
  THRESHOLDS,
  toneFor,
  type Representative,
  type Simulation,
} from "../../lib/simulation";
import type { Household, Id } from "../../lib/types";
import FamilyCard from "./FamilyCard";
import ScenarioDetailView from "./ScenarioDetail";
import { dollarsLabel, money, StatusTile, Tile } from "./shared";

const oddsTone = (share: number): Tone => toneFor(share, THRESHOLDS.moneyLasts);
const growthTone = (share: number): Tone => toneFor(share, THRESHOLDS.livesOffGrowth);

const TONE_ICON = { good: CircleCheck, caution: TriangleAlert, bad: CircleAlert } as const;
const TONE_COLOR = { good: "var(--good)", caution: "var(--warning)", bad: "var(--critical)" } as const;

export default function RangeView({
  household,
  startYear,
  mode,
  plan,
  onError,
}: {
  household: Household;
  startYear: number;
  mode: DollarMode;
  plan: Id | null;
  onError: (e: string) => void;
}) {
  const [sim, setSim] = useState<Simulation | null>(null);
  const [selected, setSelected] = useState<Representative | null>(null);
  const [estate, setEstate] = useState<EstateResult | null>(null);

  useEffect(() => {
    Promise.all([api.runSimulation(startYear, plan), api.runProjection(startYear, plan)])
      .then(([s, p]) => {
        setSim(s);
        setEstate(p.summary.estate);
        // Keep the zoomed-in scenario open across edits, re-pointed at the new run.
        setSelected((cur) => (cur ? (s.representatives.find((r) => r.kind === cur.kind) ?? null) : null));
      })
      .catch((e) => onError(String(e)));
  }, [household, startYear, plan, onError]);

  const rows = useMemo(() => (sim ? fanRows(sim, mode) : []), [sim, mode]);
  if (!sim) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Running {household.assumptions.simulations.toLocaleString("en-US")} scenarios…
      </p>
    );
  }

  const endAge = sim.ages.at(-1) ?? 0;
  const tone = oddsTone(sim.moneyLasts);
  const Icon = TONE_ICON[tone];
  const last = rows.at(-1);

  return (
    <div className="grid gap-5">
      <Card>
        <p className="flex items-start gap-2 text-xl font-semibold tracking-tight">
          <Icon size={24} className="mt-0.5 shrink-0" style={{ color: TONE_COLOR[tone] }} aria-hidden />
          <span>
            Money lasts to {endAge} in {outOf100(sim.moneyLasts)} market scenarios
          </span>
        </p>
        <div className="mt-3">
          <MethodNote assumptions={household.assumptions} scenarios={sim.scenarios} />
        </div>
      </Card>

      {sim.conditionalGifts && (
        <div className="rounded-lg bg-accent/5 px-4 py-3 text-sm">
          <strong className="font-semibold">Gifts that depend on your savings: </strong>
          about {sim.conditionalGifts.madeAverage.toFixed(1)} of {sim.conditionalGifts.scheduled.toFixed(0)} happen on
          average ({Math.round(sim.conditionalGifts.madeShare * 100)}%). Every one happens in{" "}
          {Math.round(sim.conditionalGifts.allMadeShare * 100)}% of scenarios; in rougher markets some are skipped to
          protect your savings. To give more reliably, raise the savings line or give less each time.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatusTile
          label="Chance the money lasts"
          tone={tone}
          value={`${Math.round(sim.moneyLasts * 100)}%`}
          hint={`Every year's spending, taxes, and debts paid through age ${endAge}.`}
        />
        <StatusTile
          label="Chance you live off growth & income"
          tone={growthTone(sim.livesOffGrowth)}
          value={`${Math.round(sim.livesOffGrowth * 100)}%`}
          hint={`Ending with at least today's ${formatUsdCompact(sim.startingInvestable)} of savings, after inflation.`}
        />
        <Tile
          label={`Typical savings at ${endAge}`}
          value={formatUsdCompact(last?.median ?? 0)}
          hint={`Half of scenarios end above this (${dollarsLabel(mode)})`}
        />
        <Tile
          label={`Rough markets: savings at ${endAge}`}
          value={formatUsdCompact(last?.outer[0] ?? 0)}
          hint="1 in 10 scenarios end below this"
        />
      </div>

      <FanCard rows={rows} mode={mode} />

      {estate && <FamilyCard estate={estate} range={sim.estate} />}

      <Card title="Zoom in on a scenario">
        <p className="mb-3 text-sm text-[var(--muted)]">
          See one scenario year by year, including exactly which real market years it replayed.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {SCENARIO_ORDER.map((kind) => {
            const r = sim.representatives.find((x) => x.kind === kind);
            if (!r) return null;
            const active = selected?.kind === kind;
            return (
              <button
                key={kind}
                onClick={() => setSelected(active ? null : r)}
                aria-pressed={active}
                className={`rounded-lg border p-3 text-left transition ${active ? "border-accent bg-accent/5" : "border-[var(--border)] hover:border-accent"}`}
              >
                <p className="text-sm font-medium">{SCENARIO_LABELS[kind].title}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{SCENARIO_LABELS[kind].blurb}</p>
                <p className="mt-2 text-sm tabular-nums">
                  {r.runsOutAtAge != null
                    ? `Runs out at ${r.runsOutAtAge}`
                    : `Ends with ${formatUsdCompact(r.endingInvestableReal)}`}
                </p>
              </button>
            );
          })}
        </div>
      </Card>

      {selected && (
        <ScenarioDetailView
          key={`${selected.kind}-${selected.pathIndex}`}
          household={household}
          plan={plan}
          startYear={startYear}
          representative={selected}
          mode={mode}
          onClose={() => setSelected(null)}
          onError={onError}
        />
      )}
    </div>
  );
}

function FanCard({ rows, mode }: { rows: ReturnType<typeof fanRows>; mode: DollarMode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card
      title={`Savings you can spend, by age (${dollarsLabel(mode)})`}
      actions={
        <Button variant="ghost" onClick={() => setView(view === "chart" ? "table" : "chart")}>
          {view === "chart" ? "Show as table" : "Show as chart"}
        </Button>
      }
    >
      {view === "chart" ? (
        <FanChart rows={rows} />
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-[var(--border)]">
          <table className="w-full text-right text-xs tabular-nums">
            <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
              <tr>
                {[
                  "Age",
                  "Rough (1 in 10)",
                  "Worse than typical",
                  "Typical",
                  "Better than typical",
                  "Strong (1 in 10)",
                ].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium ${i === 0 ? "text-left" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.age} className="border-t border-[var(--border)]">
                  <td className="px-3 py-1.5 text-left">{r.age}</td>
                  <td className="px-3 py-1.5">{money(r.outer[0])}</td>
                  <td className="px-3 py-1.5">{money(r.inner[0])}</td>
                  <td className="px-3 py-1.5 font-medium">{formatUsd(r.median)}</td>
                  <td className="px-3 py-1.5">{money(r.inner[1])}</td>
                  <td className="px-3 py-1.5">{money(r.outer[1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--muted)]">
        Cash, brokerage, and retirement accounts. Real estate isn't included because it's never sold to pay bills.
      </p>
    </Card>
  );
}
