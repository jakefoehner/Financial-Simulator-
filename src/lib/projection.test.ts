import { describe, expect, it } from "vitest";
import {
  balanceRows,
  cashFlowRows,
  inDollars,
  savingsVerdict,
  startLevels,
  type Projection,
  type Summary,
  type YearResult,
} from "./projection";

function year(overrides: Partial<YearResult>): YearResult {
  const zero = {
    cash: 0,
    taxable: 0,
    taxDeferred: 0,
    taxFree: 0,
    realEstate: 0,
    education: 0,
    loansReceivable: 0,
    private: 0,
    familyLlc: 0,
    grats: 0,
  };
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
    gifts: 0,
    giftsByChild: [],
    giftTax: 0,
    cashGifts: 0,
    loansMade: 0,
    loanReceipts: 0,
    rothConversion: 0,
    lifetimeTaxableGifts: 0,
    portfolioReturn: 0,
    privateIncome: 0,
    privateProceeds: 0,
    shelteredGifts: 0,
    charity: 0,
    charityCash: 0,
    charityCarryforward: 0,
    education: 0,
    superfundPending: 0,
    llcGifts: 0,
    llcDiscount: 0,
    gratRemainders: 0,
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
    estate: {} as Summary["estate"],
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
    expect(inDollars(1.025 ** 2 * 100, 1.025 ** 2, "today")).toBeCloseTo(100);
    expect(inDollars(500, 1.05, "future")).toBe(500);
  });

  it("starts each year at the previous year's price level, even when inflation varies", () => {
    // 10% inflation in year 1, then 0%: year 2 starts at 1.10 and ends at 1.10.
    const levels = startLevels([{ priceLevel: 1.1 }, { priceLevel: 1.1 }, { priceLevel: 1.21 }]);
    expect(levels).toEqual([1, 1.1, 1.1]);
  });

  it("converts year-2 flows with the year-1 end level", () => {
    const years = [year({ priceLevel: 1.1 }), year({ priceLevel: 1.1, spending: 110 })];
    const rows = cashFlowRows(proj(years), "today");
    expect(rows[1].spending).toBeCloseTo(100);
  });
});

describe("rows", () => {
  it("folds 529s into the real-estate band and keeps net worth", () => {
    const y = year({
      balances: {
        cash: 1,
        taxable: 2,
        taxDeferred: 3,
        taxFree: 4,
        realEstate: 5,
        education: 6,
        loansReceivable: 0,
        private: 0,
        familyLlc: 0,
        grats: 0,
      },
      netWorth: 21,
      priceLevel: 1,
    });
    const [r] = balanceRows(proj([y]), "future");
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
    const [r] = cashFlowRows(proj([y]), "future");
    expect(r.income).toBe(60);
    expect(r.fromSavings).toBe(35);
    expect(r.spending).toBe(85);
    expect(r.taxes).toBe(10);
  });
});
