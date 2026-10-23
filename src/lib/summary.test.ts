import { describe, expect, it } from "vitest";
import earlyCareerJson from "../../fixtures/demo-early-career.json";
import retireeJson from "../../fixtures/demo-retiree.json";
import { isEmpty, monthsToPayoff, setupSteps, summarize } from "./summary";
import type { Household } from "./types";

const retiree = retireeJson as unknown as Household;
const earlyCareer = earlyCareerJson as unknown as Household;

const empty: Household = {
  info: { name: "My Household", state: "TX", flatStateRate: 0, filingStatus: "single", baseAnnualSpending: 0 },
  people: [],
  accounts: [],
  income: [],
  debts: [],
  oneTimeExpenses: [],
};

describe("summarize", () => {
  it("totals the retiree demo", () => {
    const s = summarize(retiree, 2026);
    expect(s.totalAssets).toBe(6_915_000);
    expect(s.realEstate).toBe(1_550_000);
    expect(s.investable).toBe(5_365_000);
    expect(s.totalDebts).toBe(210_000);
    expect(s.netWorth).toBe(6_705_000);
    expect(s.currentAnnualIncome).toBe(42_000); // rental only; Social Security not claimed yet
    expect(s.annualDebtPayments).toBe(19_800);
  });

  it("drops income streams that have ended", () => {
    expect(summarize(earlyCareer, 2026).currentAnnualIncome).toBe(99_500);
    // Alex (born 1998) turns 65 in 2063, when salary and bonus stop.
    expect(summarize(earlyCareer, 2063).currentAnnualIncome).toBe(0);
  });

  it("counts Social Security once it is being received", () => {
    const claiming: Household = {
      ...retiree,
      people: retiree.people.map((p) => (p.role === "primary" ? { ...p, ssAlreadyClaiming: true } : p)),
    };
    expect(summarize(claiming, 2026).currentAnnualIncome).toBe(42_000 + 3_400 * 12);
  });
});

describe("monthsToPayoff", () => {
  it("matches a standard amortization", () => {
    // $200k at 6% with the 30-year payment (lenders round $1,199.101 up to $1,199.11) pays off in 360 months.
    expect(monthsToPayoff(200_000, 0.06, 1199.11)).toBe(360);
  });
  it("handles zero interest, paid-off, and never-ending loans", () => {
    expect(monthsToPayoff(1_000, 0, 100)).toBe(10);
    expect(monthsToPayoff(0, 0.05, 100)).toBe(0);
    expect(monthsToPayoff(10_000, 0.24, 150)).toBeNull();
  });
});

describe("setupSteps", () => {
  it("is all-incomplete for a new household and all-complete for a demo", () => {
    expect(setupSteps(empty).every((s) => !s.done)).toBe(true);
    expect(setupSteps(retiree).every((s) => s.done)).toBe(true);
    expect(isEmpty(empty)).toBe(true);
    expect(isEmpty(retiree)).toBe(false);
  });
});
