import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/Card";
import { api } from "../../lib/api";
import { formatUsd, formatUsdCompact } from "../../lib/format";
import {
  balanceRows,
  cashFlowRows,
  savingsVerdict,
  type ClaimAgeOutcome,
  type DollarMode,
  type Projection,
} from "../../lib/projection";
import type { Household } from "../../lib/types";
import { BalancesCard, StatusTile, Tile, YearByYearCard } from "./shared";

/** One steady path: the Assumptions every single year. */
export default function SteadyPath({
  household,
  startYear,
  mode,
  onError,
}: {
  household: Household;
  startYear: number;
  mode: DollarMode;
  onError: (e: string) => void;
}) {
  const [projection, setProjection] = useState<Projection | null>(null);
  const [claimAges, setClaimAges] = useState<ClaimAgeOutcome[]>([]);

  // Re-run whenever the stored household changes (every edit returns a new object).
  useEffect(() => {
    Promise.all([api.runProjection(startYear), api.compareClaimAges(startYear)])
      .then(([p, c]) => {
        setProjection(p);
        setClaimAges(c);
      })
      .catch((e) => onError(String(e)));
  }, [household, startYear, onError]);

  const balances = useMemo(() => (projection ? balanceRows(projection, mode) : []), [projection, mode]);
  const flows = useMemo(() => (projection ? cashFlowRows(projection, mode) : []), [projection, mode]);
  if (!projection) return null;

  const s = projection.summary;
  const first = projection.years[0];
  const verdict = savingsVerdict(s, formatUsdCompact);

  return (
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
          value={formatUsd(first ? first.taxes + first.medicareSurcharge : 0)}
          hint="Federal, state, and Medicare surcharges"
        />
      </div>

      <BalancesCard
        rows={balances}
        mode={mode}
        footnote={
          s.startingInvestable > 0 ? `Savings you can spend today: ${formatUsd(s.startingInvestable)}.` : undefined
        }
      />

      {claimAges.length > 0 && <ClaimAgeCard outcomes={claimAges} />}

      <YearByYearCard rows={flows} />
    </div>
  );
}

function ClaimAgeCard({ outcomes }: { outcomes: ClaimAgeOutcome[] }) {
  const best = outcomes.reduce((b, o) => (o.endingNetWorthReal > b.endingNetWorthReal ? o : b));
  return (
    <Card title="When to start Social Security">
      <p className="mb-3 text-sm text-[var(--muted)]">
        Starting later means bigger checks for life. Here's how each choice plays out on the steady path, in today's
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
