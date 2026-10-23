// Mirrors engine/src/montecarlo.rs and history.rs output, plus display helpers.
import type { DollarMode, Projection } from "./projection";
import type { Assumptions } from "./types";

export interface Bands {
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
}

export type ScenarioKind = "worst" | "rough" | "typical" | "strong";

export interface Representative {
  kind: ScenarioKind;
  pathIndex: number;
  endingInvestableReal: number;
  runsOutAtAge: number | null;
}

export interface Simulation {
  scenarios: number;
  ages: number[];
  years: number[];
  startingInvestable: number;
  /** Share (0–1) of scenarios where spending is always paid. */
  moneyLasts: number;
  /** Share ending with at least today's spendable savings, in today's dollars. */
  livesOffGrowth: number;
  stillOnTrack: number[];
  investableReal: Bands;
  investableNominal: Bands;
  netWorthReal: Bands;
  netWorthNominal: Bands;
  representatives: Representative[];
}

export interface MarketYear {
  stocks: number;
  bonds: number;
  cash: number;
  realEstate: number;
  inflation: number;
}

export interface HistoricalYear extends MarketYear {
  year: number;
}

export interface ReplayedYear {
  year: number;
  age: number;
  /** The real calendar year whose markets this year replays. */
  sourceYear: number;
  actual: HistoricalYear;
  adjusted: MarketYear;
}

export interface ScenarioDetail {
  pathIndex: number;
  projection: Projection;
  replayed: ReplayedYear[];
}

export const SCENARIO_LABELS: Record<ScenarioKind, { title: string; blurb: string }> = {
  rough: { title: "Rough markets", blurb: "1 in 10 scenarios end worse than this" },
  typical: { title: "Typical", blurb: "Half end better, half worse" },
  strong: { title: "Strong markets", blurb: "1 in 10 scenarios end better than this" },
  worst: { title: "Worst of all", blurb: "The single toughest scenario" },
};

/** Display order for the zoom-in buttons. */
export const SCENARIO_ORDER: ScenarioKind[] = ["rough", "typical", "strong", "worst"];

/** "97 of 100", never rounding to a misleading 0 or 100. */
export function outOf100(share: number): string {
  const n = Math.round(share * 100);
  if (share < 1 && n >= 100) return "more than 99 of 100";
  if (share > 0 && n <= 0) return "fewer than 1 in 100";
  return `${n} of 100`;
}

export interface FanRow {
  age: number;
  year: number;
  outer: [number, number];
  inner: [number, number];
  median: number;
}

/** Spendable savings bands by age, in the chosen dollars. */
export function fanRows(sim: Simulation, mode: DollarMode): FanRow[] {
  const b = mode === "today" ? sim.investableReal : sim.investableNominal;
  return sim.ages.map((age, i) => ({
    age,
    year: sim.years[i],
    outer: [b.p10[i], b.p90[i]],
    inner: [b.p25[i], b.p75[i]],
    median: b.p50[i],
  }));
}

export interface ReplayRun {
  fromAge: number;
  toAge: number;
  fromYear: number;
  toYear: number;
}

/** Groups a scenario's years into runs of consecutive real years ("ages 67–71 replay 2007–2011"). */
export function replayRuns(replayed: ReplayedYear[]): ReplayRun[] {
  const runs: ReplayRun[] = [];
  for (const y of replayed) {
    const last = runs.at(-1);
    if (last && y.sourceYear === last.toYear + 1 && y.age === last.toAge + 1) {
      last.toAge = y.age;
      last.toYear = y.sourceYear;
    } else {
      runs.push({ fromAge: y.age, toAge: y.age, fromYear: y.sourceYear, toYear: y.sourceYear });
    }
  }
  return runs;
}

/** Compound average US stock return 1928–2025 in the bundled data (see engine/src/history.rs tests). */
export const HISTORICAL_STOCK_GEOMEAN = 0.1002;

/** A real stock year scaled the way the engine centers history on the user's assumption. */
export function scaledStockReturn(actual: number, target: number): number {
  return ((1 + actual) * (1 + target)) / (1 + HISTORICAL_STOCK_GEOMEAN) - 1;
}

/** The always-visible one-line explanation of how the range is built. */
export function methodSummary(a: Assumptions, scenarios: number, pct: (v: number) => string): string {
  const inflation = a.steadyInflation
    ? `prices rise a steady ${pct(a.inflation)} a year`
    : `prices rise ${pct(a.inflation)} a year on average`;
  return (
    `${scenarios.toLocaleString("en-US")} scenarios replaying real market years${a.steadyInflation ? "" : " and inflation"} ` +
    `from 1928–2025 in random 5-year runs, scaled so stocks grow ${pct(a.stocksReturn)} and ${inflation} ` +
    `(your Assumptions).`
  );
}
