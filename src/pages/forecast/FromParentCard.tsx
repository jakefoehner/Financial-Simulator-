import { useEffect, useState } from "react";
import { Card } from "../../components/Card";
import { api, type IncomingSummary } from "../../lib/api";
import { formatUsdCompact } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { Household } from "../../lib/types";

/**
 * In a child's household linked to a parent's: what arrives from the parent's plan
 * (gifts, 529s, a family loan and its payments, the inheritance). Today's dollars.
 */
export default function FromParentCard({ household, startYear }: { household: Household; startYear: number }) {
  const load = useApp((s) => s.load);
  const [summary, setSummary] = useState<IncomingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .incomingSummary(startYear)
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [household, startYear]);

  if (error) return <p className="text-sm text-[var(--critical)]">{error}</p>;
  if (!summary) return null;

  const choose = async (plan: number | null) => {
    setError(null);
    try {
      await api.setParentPlan(plan);
      // Reload so every forecast on the page re-runs with the new money arriving.
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const me = household.people.find((p) => p.role === "primary");
  const ageIn = (year: number) => (me ? year - me.birthYear : null);
  const firstGift = summary.years.find((y) => y.cash + y.assets + y.education + y.paidForYou + y.loanIn > 0);
  const rows: { label: string; value: number; note?: string }[] = [
    {
      label: "Gifts",
      value: summary.giftsReal,
      note: firstGift
        ? `starting ${firstGift.year}${ageIn(firstGift.year) != null ? ` (your age ${ageIn(firstGift.year)})` : ""}`
        : undefined,
    },
    { label: "Into a 529 for you", value: summary.educationReal },
    { label: "Tuition or medical bills paid for you", value: summary.paidForYouReal },
    { label: "Family loan received", value: summary.loansInReal },
    { label: "…and your payments on it", value: -summary.loanPaymentsReal },
    {
      label: "Inheritance (after estate tax)",
      value: summary.inheritanceReal,
      note:
        summary.inheritanceYear != null
          ? `in ${summary.inheritanceYear}, after ${summary.parentName}'s plan ends at age ${summary.parentEstateAge}${ageIn(summary.inheritanceYear) != null ? ` (you'll be ${ageIn(summary.inheritanceYear)})` : ""}`
          : undefined,
    },
  ].filter((r) => Math.abs(r.value) > 0.5);

  return (
    <Card
      title={`From ${summary.parentName}'s plan`}
      actions={
        <select
          aria-label={`Which of ${summary.parentName}'s plans`}
          value={summary.plan ?? 0}
          onChange={(e) => void choose(Number(e.target.value) || null)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
        >
          {summary.plans.map((p) => (
            <option key={String(p.id)} value={p.id ?? 0}>
              {p.name}
            </option>
          ))}
        </select>
      }
    >
      {summary.problem ? (
        <p className="text-sm text-[var(--muted)]">
          {summary.parentName}'s plan can't be run yet ({summary.problem}), so nothing from it is included.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing arrives from "{summary.planName}" within this forecast.</p>
      ) : (
        <>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-[var(--border)] first:border-t-0">
                  <td className="py-1.5">
                    {r.label}
                    {r.note && <span className="ml-2 text-xs text-[var(--muted)]">{r.note}</span>}
                  </td>
                  <td className="py-1.5 text-right font-medium">
                    {r.value < 0 ? `−${formatUsdCompact(-r.value)}` : formatUsdCompact(r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-[var(--muted)]">
            Today's dollars, from {summary.parentName}'s "{summary.planName}" on its steady path (their Assumptions
            every year). This forecast includes it: cash and the inheritance go into your savings, gifted investments
            keep {summary.parentName}'s cost basis, and loan payments come out of your spending. In the range of
            outcomes, your markets vary while {summary.parentName}'s gifts stay as planned.
          </p>
        </>
      )}
    </Card>
  );
}
