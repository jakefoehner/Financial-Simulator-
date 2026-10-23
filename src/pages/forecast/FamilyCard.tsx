import { Card } from "../../components/Card";
import { formatPercent, formatUsd, formatUsdCompact } from "../../lib/format";
import type { EstateResult } from "../../lib/projection";
import type { EstateRange } from "../../lib/simulation";
import { money } from "./shared";

/**
 * What the kids end up with and the estate tax. The breakdown comes from the
 * steady path; `range` (from the range of outcomes) adds typical and
 * rough-markets totals. Everything in today's dollars.
 */
export default function FamilyCard({ estate, range }: { estate: EstateResult; range?: EstateRange }) {
  const hasGifts = estate.lifetimeGiftsReal > 0.5;
  const iraInherited = estate.heirIncomeTaxRate > 0 ? estate.heirsIncomeTaxReal / estate.heirIncomeTaxRate : 0;

  return (
    <Card title={`For the family, at age ${estate.age} (today's dollars)`}>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Figure
          label="The kids receive in total"
          value={formatUsdCompact(range ? range.familyTotalReal.p50 : estate.familyTotalReal)}
          hint={range ? `Typical. Rough markets: ${formatUsdCompact(range.familyTotalReal.p10)}` : "On the steady path"}
        />
        <Figure
          label="Federal estate tax"
          value={formatUsdCompact(range ? range.estateTaxReal.p50 : estate.estateTaxReal)}
          hint={`40% above the ${formatUsdCompact(estate.exemptionReal)} exemption${estate.exemptionCutApplies ? " (after the cut you set)" : ""}`}
        />
        <Figure
          label="Lifetime exemption used by gifts"
          value={formatUsdCompact(estate.lifetimeTaxableGiftsReal)}
          hint="Gifts above the yearly exclusion"
        />
      </div>

      <p className="mb-1 text-xs text-[var(--muted)]">
        {range
          ? "Breakdown on the steady path (your Assumptions every year). The last column shows the range across market scenarios."
          : "Breakdown on the steady path (your Assumptions every year)."}
      </p>
      <table className="w-full text-right text-sm tabular-nums">
        <thead className="text-xs text-[var(--muted)]">
          <tr>
            <th className="py-1.5 text-left font-medium">Child</th>
            {hasGifts && <th className="py-1.5 font-medium">Given during your life</th>}
            {hasGifts && <th className="py-1.5 font-medium">…worth by age {estate.age}</th>}
            <th className="py-1.5 font-medium">Inheritance</th>
            <th className="py-1.5 font-medium">Total</th>
            {range && <th className="py-1.5 font-medium">Range: typical · rough markets</th>}
          </tr>
        </thead>
        <tbody>
          {estate.children.map((c, i) => (
            <tr key={c.childId ?? c.name} className="border-t border-[var(--border)]">
              <td className="py-2 text-left">{c.name}</td>
              {hasGifts && <td className="py-2">{money(c.giftsReal)}</td>}
              {hasGifts && <td className="py-2">{money(c.giftsGrownReal)}</td>}
              <td className="py-2">{formatUsd(c.inheritanceReal)}</td>
              <td className="py-2 font-medium">{formatUsd(c.totalReal)}</td>
              {range && (
                <td className="py-2 text-[var(--muted)]">
                  {formatUsdCompact(range.children[i]?.totalReal.p50 ?? 0)} ·{" "}
                  {formatUsdCompact(range.children[i]?.totalReal.p10 ?? 0)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-3 grid gap-1 text-xs text-[var(--muted)]">
        <li>
          <strong className="font-medium text-[var(--text)]">
            Assumes your kids pay {formatPercent(estate.heirIncomeTaxRate, 0)} income tax
          </strong>{" "}
          on the {formatUsdCompact(iraInherited)} they'd inherit in traditional IRA/401(k) accounts, which must be
          emptied within 10 years.{" "}
          <button
            className="text-accent hover:underline"
            onClick={() => document.getElementById("assumptions")?.scrollIntoView({ behavior: "smooth" })}
          >
            Change it in Assumptions below.
          </button>
        </li>
        <li>
          Other inherited assets get a "stepped-up" cost basis, so no capital-gains tax on past growth. Gifts keep your
          original basis.
          {hasGifts && " Gifts are shown grown to that age at your portfolio's return, as if your kids invested them."}
        </li>
        <li>Federal only; Texas has no estate or inheritance tax. A planning estimate, not legal or tax advice.</li>
      </ul>
    </Card>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs text-[var(--muted)]">{hint}</p>
    </div>
  );
}
