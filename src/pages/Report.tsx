import { ArrowLeft, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card } from "../components/Card";
import { FanChart } from "../components/FanChart";
import { api } from "../lib/api";
import { eventAge, eventSummary } from "../lib/events";
import { formatPercent, formatUsd, formatUsdCompact } from "../lib/format";
import type { Projection } from "../lib/projection";
import { DATA_SOURCES, fanRows, outOf100, type Simulation } from "../lib/simulation";
import { useApp } from "../lib/store";
import { ACCOUNT_GROUPS, ageOf, currentYear } from "../lib/types";
import FamilyCard from "./forecast/FamilyCard";

/**
 * A printable summary of one plan, for an estate attorney or CPA. "Save as PDF…"
 * opens the Mac print panel, whose PDF menu saves it.
 */
export default function Report() {
  const household = useApp((s) => s.household!);
  const { plan, setPlan, go } = useApp();
  const [sim, setSim] = useState<Simulation | null>(null);
  const [steady, setSteady] = useState<Projection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startYear = currentYear();

  useEffect(() => {
    let cancelled = false;
    setSim(null);
    Promise.all([api.runSimulation(startYear, plan), api.runProjection(startYear, plan)])
      .then(([s, p]) => {
        if (cancelled) return;
        setSim(s);
        setSteady(p);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [household, plan, startYear]);

  const scenario = household.scenarios.find((s) => s.id === plan);
  const planName = scenario?.name ?? "Base plan";
  const nameOf = (id: number) => household.people.find((p) => p.id === id)?.name ?? "someone removed";
  const accountName = (id: number) => household.accounts.find((a) => a.id === id)?.name ?? "an account";
  const a = household.assumptions;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const print = async () => {
    setError(null);
    try {
      await api.printPage();
    } catch {
      // Outside the app (or if the panel can't open), fall back to the browser's print.
      window.print();
    }
  };

  return (
    <div className="report grid gap-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => go("results")}>
          <ArrowLeft size={14} /> Back to the forecast
        </Button>
        <div className="flex items-center gap-3">
          {household.scenarios.length > 0 && (
            <select
              aria-label="Plan"
              value={plan ?? 0}
              onChange={(e) => setPlan(Number(e.target.value) || null)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            >
              <option value={0}>Base plan</option>
              {household.scenarios.map((s) => (
                <option key={s.id} value={s.id!}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={() => void print()} disabled={!sim}>
            <Printer size={14} /> Save as PDF…
          </Button>
        </div>
      </div>
      <p className="no-print -mt-2 text-xs text-[var(--muted)]">
        In the print window, choose <strong>PDF → Save as PDF</strong> (bottom left) to save a file you can email.
      </p>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{household.info.name}</h1>
        <p className="text-sm text-[var(--muted)]">
          Plan: {planName} · Prepared {today} with Finance Simulator · All amounts in today's dollars unless noted
        </p>
      </header>

      {error && <p className="text-sm text-[var(--critical)]">{error}</p>}

      <Card title="Household">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <ul className="grid gap-0.5">
            {household.people.map((p) => (
              <li key={p.id}>
                {p.name}{" "}
                <span className="text-[var(--muted)]">
                  ({p.role === "primary" ? "you" : p.role}, age {ageOf(p)})
                </span>
              </li>
            ))}
            <li className="mt-1 text-[var(--muted)]">
              Spending {formatUsd(household.info.baseAnnualSpending)} a year · {household.info.state}
            </li>
          </ul>
          <table className="w-full tabular-nums">
            <tbody>
              {ACCOUNT_GROUPS.map((g) => {
                const total = household.accounts
                  .filter((x) => g.types.some((t) => t.type === x.accountType))
                  .reduce((s, x) => s + x.balance, 0);
                return total > 0 ? (
                  <tr key={g.label}>
                    <td className="py-0.5">{g.label}</td>
                    <td className="py-0.5 text-right">{formatUsd(total)}</td>
                  </tr>
                ) : null;
              })}
              <tr className="border-t border-[var(--border)] font-medium">
                <td className="py-0.5">Total</td>
                <td className="py-0.5 text-right">
                  {formatUsd(household.accounts.reduce((s, x) => s + x.balance, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {scenario && (
        <Card title="Decisions in this plan">
          <ul className="grid gap-1 text-sm">
            {[...scenario.events]
              .sort((x, y) => eventAge(x) - eventAge(y))
              .map((e, i) => (
                <li key={i}>{eventSummary(e, nameOf, formatUsdCompact, formatPercent, accountName)}</li>
              ))}
          </ul>
          {scenario.notes && <p className="mt-2 text-xs text-[var(--muted)]">{scenario.notes}</p>}
        </Card>
      )}

      {!sim || !steady ? (
        <p className="text-sm text-[var(--muted)]">Running the forecast…</p>
      ) : (
        <>
          <Card title="Range of outcomes">
            <p className="text-lg font-semibold">
              Money lasts to {sim.ages.at(-1)} in {outOf100(sim.moneyLasts)} market scenarios.
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Chance of living off growth and income: {Math.round(sim.livesOffGrowth * 100)}%. Typical savings at{" "}
              {sim.ages.at(-1)}: {formatUsdCompact(sim.investableReal.p50.at(-1)!)}; in rough markets (1 in 10):{" "}
              {formatUsdCompact(sim.investableReal.p10.at(-1)!)}.
            </p>
            <div className="report-chart mt-4">
              <FanChart rows={fanRows(sim, "today")} />
            </div>
          </Card>
          <div className="page-break">
            <FamilyCard estate={steady.summary.estate} range={sim.estate} />
          </div>
        </>
      )}

      <Card title="Assumptions and method">
        <p className="text-sm text-[var(--muted)]">
          Returns: stocks {formatPercent(a.stocksReturn)}, bonds {formatPercent(a.bondsReturn)}, cash{" "}
          {formatPercent(a.cashReturn)}, real estate {formatPercent(a.realEstateGrowth)}; inflation{" "}
          {formatPercent(a.inflation)}. The range of outcomes replays{" "}
          {sim?.scenarios.toLocaleString("en-US") ?? "thousands of"} sequences of real market years (1928–2025, in
          5-year runs), scaled so their long-run averages match these returns. Heirs are assumed to pay{" "}
          {formatPercent(a.heirIncomeTaxRate, 0)} income tax on inherited retirement accounts and{" "}
          {formatPercent(a.heirCapitalGainsRate, 0)} capital-gains tax on gifted assets' growth. Federal taxes under
          current law (2026 tables), plus a flat state rate of {formatPercent(household.info.flatStateRate)}.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Data: {DATA_SOURCES.returns}; inflation from {DATA_SOURCES.inflation}. A planning estimate, not legal or tax
          advice. Confirm gifting and estate decisions with an estate attorney or CPA.
        </p>
      </Card>
    </div>
  );
}
