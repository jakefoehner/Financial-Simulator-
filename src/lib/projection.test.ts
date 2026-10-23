import { describe, expect, it } from "vitest";
import { balanceRows, cashFlowRows, inDollars, savingsVerdict, type Projection, type YearResult } from "./projection";

function year(overrides: Partial<YearResult>): YearResult {
  const zero = { cash: 0, taxable: 0, taxDeferred: 0, taxFree: 0, realEstate: 0, education: 0 };
  return {
    year: 2026,
    age: 67,
    earnedIncome: 0,
    otherIncome: 0,
    socialSecurity: 0,
    investmentIncome: 0,
    requiredDistributions: 0,
    withdrawals: 0,
    spending: 0,
    oneTimeExpenses: 0,
    debtPayments: 0,
    contributions: 0,
    taxes: 0,
    medicareSurcharge: 0,
    saved: 0,
    shortfall: 0,
    tax: {} as YearResult["tax"],
    balances: zero,
    debtBalance: 0,
    netWorth: 0,
    priceLevel: 1.025,
    ...overrides,
  };
}

const proj = (years: YearResult[]): Projection => ({ summary: {} as Projection["summary"], years });

describe("savingsVerdict", () => {
  const base = {
    startYear: 2026,
    startAge: 67,
    endAge: 100,
    startingInvestable: 5_000_000,
    runsOutAtAge: null,
    principalDipsAtAge: null,
    lowestInvestableReal: 5_000_000,
    lowestInvestableAge: null,
    endingNetWorthReal: 0,
    endingInvestableReal: 6_000_000,
  };
  const fmt = (v: number) => `${v / 1e6}M`;

  it("is good when savings never dip", () => {
    expect(savingsVerdict(base, fmt)).toEqual({ tone: "good", text: "Yes, savings never shrink" });
  });
  it("is a caution when savings dip and recover", () => {
    const v = savingsVerdict({ ...base, lowestInvestableReal: 4_500_000, lowestInvestableAge: 72 }, fmt);
    expect(v).toEqual({ tone: "caution", text: "Dips to 4.5M at 72, then recovers" });
  });
  it("is bad when savings end lower", () => {
    const v = savingsVerdict(
      { ...base, lowestInvestableReal: 1_000_000, lowestInvestableAge: 100, endingInvestableReal: 1_000_000 },
      fmt,
    );
    expect(v.tone).toBe("bad");
  });
});

describe("inDollars", () => {
  it("removes inflation for today's dollars", () => {
    const y = year({ priceLevel: 1.025 ** 2 });
    expect(inDollars(1.025 ** 2 * 100, y, "today", 0.025)).toBeCloseTo(100);
    expect(inDollars(500, y, "future", 0.025)).toBe(500);
  });

  it("uses the start-of-year level for flows", () => {
    const y = year({ priceLevel: 1.025 }); // first year: flows are already in today's dollars
    expect(inDollars(100, y, "today", 0.025, true)).toBeCloseTo(100);
  });
});

describe("rows", () => {
  it("folds 529s into the real-estate band and keeps net worth", () => {
    const y = year({
      balances: { cash: 1, taxable: 2, taxDeferred: 3, taxFree: 4, realEstate: 5, education: 6 },
      netWorth: 21,
      priceLevel: 1,
    });
    const [r] = balanceRows(proj([y]), "future", 0.025);
    expect(r.realEstate).toBe(11);
    expect(r.netWorth).toBe(21);
  });

  it("groups cash flows the way the table shows them", () => {
    const y = year({
      earnedIncome: 50,
      otherIncome: 10,
      withdrawals: 30,
      requiredDistributions: 5,
      spending: 70,
      oneTimeExpenses: 5,
      debtPayments: 10,
      taxes: 8,
      medicareSurcharge: 2,
    });
    const [r] = cashFlowRows(proj([y]), "future", 0.025);
    expect(r.income).toBe(60);
    expect(r.fromSavings).toBe(35);
    expect(r.spending).toBe(85);
    expect(r.taxes).toBe(10);
  });
});
