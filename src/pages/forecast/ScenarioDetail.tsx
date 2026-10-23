import { TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/Card";
import { api } from "../../lib/api";
import { formatPercent, formatUsdCompact } from "../../lib/format";
import { balanceRows, cashFlowRows, type DollarMode } from "../../lib/projection";
import {
  replayRuns,
  SCENARIO_LABELS,
  THRESHOLDS,
  type ReplayedYear,
  type Representative,
  type ScenarioDetail,
} from "../../lib/simulation";
import type { Household } from "../../lib/types";
import { BalancesCard, YearByYearCard } from "./shared";

const CRASH = THRESHOLDS.crash;
const HIGH_INFLATION = THRESHOLDS.highInflation;

export default function ScenarioDetailView({
  household,
  startYear,
  representative: rep,
  mode,
  onClose,
  onError,
}: {
  household: Household;
  startYear: number;
  representative: Representative;
  mode: DollarMode;
  onClose: () => void;
  onError: (e: string) => void;
}) {
  const [detail, setDetail] = useState<ScenarioDetail | null>(null);

  useEffect(() => {
    api
      .scenarioDetail(startYear, rep.pathIndex)
      .then(setDetail)
      .catch((e) => onError(String(e)));
  }, [household, startYear, rep.pathIndex, onError]);

  const balances = useMemo(() => (detail ? balanceRows(detail.projection, mode) : []), [detail, mode]);
  const flows = useMemo(() => (detail ? cashFlowRows(detail.projection, mode) : []), [detail, mode]);
  const byYear = useMemo(() => new Map(detail?.replayed.map((r) => [r.year, r]) ?? []), [detail]);
  if (!detail) return null;

  const label = SCENARIO_LABELS[rep.kind];
  const runs = replayRuns(detail.replayed);
  const crashes = detail.replayed.filter((r) => r.adjusted.stocks <= CRASH);
  const inflationary = detail.replayed.filter((r) => r.adjusted.inflation >= HIGH_INFLATION);
  const peakInflation = inflationary.reduce((m, r) => Math.max(m, r.adjusted.inflation), 0);

  return (
    <div className="grid gap-5 rounded-xl border-2 border-accent/30 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{label.title} scenario</h2>
          <p className="text-sm text-[var(--muted)]">
            {label.blurb}.{" "}
            {rep.runsOutAtAge != null
              ? `Money runs out at ${rep.runsOutAtAge}.`
              : `Ends with ${formatUsdCompact(rep.endingInvestableReal)} of spendable savings in today's dollars.`}
          </p>
        </div>
        <button aria-label="Close scenario" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]">
          <X size={18} />
        </button>
      </div>

      <Card title="Market history this scenario replays">
        <ul className="flex flex-wrap gap-2 text-xs">
          {runs.map((r) => (
            <li key={`${r.fromAge}`} className="rounded-md border border-[var(--border)] px-2.5 py-1.5">
              <span className="text-[var(--muted)]">
                {r.fromAge === r.toAge ? `Age ${r.fromAge}` : `Ages ${r.fromAge}–${r.toAge}`}
              </span>{" "}
              <span className="font-medium">{r.fromYear === r.toYear ? r.fromYear : `${r.fromYear}–${r.toYear}`}</span>
            </li>
          ))}
        </ul>
        {crashes.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-sm">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" style={{ color: "var(--warning)" }} aria-hidden />
            <span>
              Big stock drops at{" "}
              {crashes.map((c) => `${c.age} (${c.sourceYear}: ${formatPercent(c.adjusted.stocks, 0)})`).join(", ")}.
            </span>
          </p>
        )}
        {inflationary.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-sm">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" style={{ color: "var(--warning)" }} aria-hidden />
            <span>
              High inflation ({formatPercent(HIGH_INFLATION, 0)}+) in {inflationary.length}{" "}
              {inflationary.length === 1 ? "year" : "years"}, peaking at {formatPercent(peakInflation, 1)}: ages{" "}
              {inflationary.map((r) => r.age).join(", ")}. Rising prices push up spending, so savings have to work
              harder.
            </span>
          </p>
        )}
        {crashes.length === 0 && inflationary.length === 0 && (
          <p className="mt-3 text-sm text-[var(--muted)]">No big crashes or high-inflation years in this one.</p>
        )}
        <p className="mt-2 text-xs text-[var(--muted)]">
          Stock returns and inflation shown are scaled to your Assumptions; the real figures are in each year's tooltip
          in the table below.
        </p>
      </Card>

      <BalancesCard rows={balances} mode={mode} />
      <YearByYearCard rows={flows} extra={(year) => <ReplayCell r={byYear.get(year)} />} />
    </div>
  );
}

function ReplayCell({ r }: { r: ReplayedYear | undefined }) {
  if (!r) return null;
  const crash = r.adjusted.stocks <= CRASH;
  return (
    <span
      className={crash ? "font-semibold" : ""}
      title={`Actual ${r.sourceYear}: stocks ${formatPercent(r.actual.stocks, 1)}, inflation ${formatPercent(r.actual.inflation, 1)}`}
    >
      {crash && <TriangleAlert size={12} className="mr-1 inline" style={{ color: "var(--warning)" }} aria-hidden />}
      {r.sourceYear} · stocks {formatPercent(r.adjusted.stocks, 0)} · inflation {formatPercent(r.adjusted.inflation, 1)}
    </span>
  );
}
