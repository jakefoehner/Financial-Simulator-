import { describe, expect, it } from "vitest";
import { formatPercent } from "./format";
import {
  fanRows,
  methodSummary,
  outOf100,
  replayRuns,
  scaledStockReturn,
  type ReplayedYear,
  type Simulation,
} from "./simulation";
import { DEFAULT_ASSUMPTIONS } from "./types";

describe("outOf100", () => {
  it.each([
    [0.976, "98 of 100"],
    [1, "100 of 100"],
    [0.998, "more than 99 of 100"],
    [0.002, "fewer than 1 in 100"],
    [0, "0 of 100"],
  ])("%d -> %s", (share, text) => {
    expect(outOf100(share)).toBe(text);
  });
});

describe("replayRuns", () => {
  const y = (age: number, sourceYear: number) => ({ age, sourceYear }) as ReplayedYear;

  it("groups consecutive real years and splits at jumps", () => {
    const runs = replayRuns([y(67, 2007), y(68, 2008), y(69, 2009), y(70, 1973), y(71, 1974)]);
    expect(runs).toEqual([
      { fromAge: 67, toAge: 69, fromYear: 2007, toYear: 2009 },
      { fromAge: 70, toAge: 71, fromYear: 1973, toYear: 1974 },
    ]);
  });

  it("reads back-to-back draws of consecutive real years as one run", () => {
    // e.g. 2020-2024 followed by 2025: one continuous stretch of history.
    expect(replayRuns([y(67, 2024), y(68, 2025)])).toHaveLength(1);
  });
});

describe("fanRows", () => {
  it("picks real or nominal bands", () => {
    const bands = (k: number) => ({ p10: [k], p25: [k + 1], p50: [k + 2], p75: [k + 3], p90: [k + 4] });
    const sim = {
      ages: [67],
      years: [2026],
      investableReal: bands(0),
      investableNominal: bands(10),
    } as unknown as Simulation;
    expect(fanRows(sim, "today")[0]).toEqual({ age: 67, year: 2026, outer: [0, 4], inner: [1, 3], median: 2 });
    expect(fanRows(sim, "future")[0].median).toBe(12);
  });
});

describe("scaledStockReturn", () => {
  it("matches the engine's centering for 2008 at 7%", () => {
    // engine test: 2008 lands between -37% and -40% at the 7% default.
    const v = scaledStockReturn(-0.3655, 0.07);
    expect(v).toBeLessThan(-0.37);
    expect(v).toBeGreaterThan(-0.4);
  });
});

describe("methodSummary", () => {
  it("states the method and the user's numbers", () => {
    const s = methodSummary(DEFAULT_ASSUMPTIONS, 5000, formatPercent);
    expect(s).toContain("5,000 scenarios replaying real market years and inflation from 1928–2025");
    expect(s).toContain("stocks grow 7%");
    expect(s).toContain("prices rise 2.5% a year on average");
  });

  it("says when inflation is held steady", () => {
    const s = methodSummary({ ...DEFAULT_ASSUMPTIONS, steadyInflation: true }, 1000, formatPercent);
    expect(s).not.toContain("and inflation");
    expect(s).toContain("a steady 2.5%");
  });
});
