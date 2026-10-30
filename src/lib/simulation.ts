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
  estate: EstateRange;
  /** "Give a mix" gifts that happen only while savings hold: how often they did. */
  conditionalGifts: {
    madeShare: number;
    scheduled: number;
    madeAverage: number;
    allMadeShare: number;
  } | null;
}

/** Mirrors engine::solver. Money in today's dollars. */
export interface SafeGiftRequest {
  yearly: boolean;
  years: number;
  target: number;
}

export interface SafeGiftPoint {
  perChild: number;
  total: number;
  moneyLasts: number;
  familyTotalP50: number;
  estateTaxP50: number;
}

export interface SafeGiftResult {
  target: number;
  yearly: boolean;
  years: number;
  age: number;
  children: number;
  baseMoneyLasts: number;
  achievable: boolean;
  maxPerChild: number;
  maxTotal: number;
  atMax: SafeGiftPoint;
  curve: SafeGiftPoint[];
}

/** One sentence answering "how much can I safely give?". */
export function safeGiftSentence(r: SafeGiftResult, money: (v: number) => string, endAge: number): string {
  const pct = `${Math.round(r.target * 100)}%`;
  if (!r.achievable) {
    return `This plan is already below a ${pct} chance your money lasts, so there's no extra amount to give safely. Try spending a little less first, or a lower target.`;
  }
  const when = r.yearly ? ` every year for ${r.years} years` : " now";
  const each = r.children === 1 ? "your child" : "each child";
  return `You could give up to ${money(r.maxPerChild)} to ${each}${when} (${money(r.maxTotal)} in all) and keep a ${pct} chance your money lasts to ${endAge}.`;
}

/** 10th / 50th / 90th percentile of one number across scenarios. */
export interface Spread {
  p10: number;
  p50: number;
  p90: number;
}

/** Mirrors engine::montecarlo::EstateRange. Today's dollars. */
export interface EstateRange {
  age: number;
  estateTaxReal: Spread;
  familyTotalReal: Spread;
  children: { childId: number | null; name: string; totalReal: Spread }[];
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

/**
 * Display thresholds, shared by the Forecast screens and the "How this works"
 * panel so the explanation always matches what's on screen. Documented in the
 * README ("Data & definitions") and the docs/SPEC.md Decisions log.
 */
export const THRESHOLDS = {
  /** "Chance the money lasts": good at or above, caution at or above, otherwise concern. */
  moneyLasts: { good: 0.9, caution: 0.75 },
  /** "Chance you live off growth & income" is a stricter goal, so its bands are looser. */
  livesOffGrowth: { good: 0.75, caution: 0.4 },
  /** A replayed year is flagged as a crash when scaled stocks fall at least this much. */
  crash: -0.15,
  /** ...and as high inflation when scaled prices rise at least this much. */
  highInflation: 0.06,
} as const;

export function toneFor(share: number, bands: { good: number; caution: number }): "good" | "caution" | "bad" {
  return share >= bands.good ? "good" : share >= bands.caution ? "caution" : "bad";
}

/**
 * Private-investment assumptions used in the range of outcomes. Mirrors
 * STARTUP_OUTCOMES / CREDIT_DEFAULT_* in engine/src/montecarlo.rs; keep them in sync.
 */
export const PRIVATE_ASSUMPTIONS = {
  /** Share of individual startups returning less than what was invested, and the share returning 30×. */
  startupBelowCost: 0.7,
  startupTotalLoss: 0.55,
  startupThirtyX: 0.03,
  creditDefaultChance: 0.03,
  creditDefaultLoss: 0.25,
};

/** Where the bundled history comes from, shown in the app and README. */
export const DATA_SOURCES = {
  returns: "A. Damodaran, NYU Stern, “Historical Returns on Stocks, Bonds and Bills” (updated January 5, 2026)",
  returnsSeries:
    "S&P 500 including dividends, 10-year US Treasury bond total return, 3-month T-bill, and US home prices",
  inflation: "US Bureau of Labor Statistics, CPI-U all items (series CUUR0000SA0), December to December",
  checks:
    "Compounding every year's figures reproduces the source's own “$100 invested in 1928” totals through 2024 to within 0.1%, and known years match published figures (1931 stocks −43.8%, 2008 −36.6%, 2022 −18.0%, 1980 inflation 12.5%).",
  quirk: "The source's 2025 Treasury bond row says 7.80% while its running total implies 8.29%; the app uses 7.80%.",
};

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
