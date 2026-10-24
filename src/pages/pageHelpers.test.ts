import { describe, expect, it } from "vitest";
import type { Account } from "../lib/types";
import { withType } from "./Accounts";
import { payoffLabel } from "./Debts";
import { whenLabel } from "./Income";

const brokerage: Account = {
  id: 1,
  name: "Brokerage (taxable)",
  accountType: "taxable",
  ownerId: 1,
  balance: 100_000,
  costBasis: 60_000,
  stocksPct: 0.7,
  bondsPct: 0.3,
  cashPct: 0,
  annualContribution: 5_000,
  employerMatch: 0,
  notes: "",
  private: null,
  holdings: [],
};

describe("withType", () => {
  it("clears fields that don't apply to the new type", () => {
    const a = withType(brokerage, "savings");
    expect(a.name).toBe("Savings"); // default name follows the type
    expect([a.stocksPct, a.bondsPct, a.cashPct]).toEqual([0, 0, 1]);
    expect(a.costBasis).toBeNull();
    expect(a.annualContribution).toBe(0);
  });

  it("keeps a custom name and the existing mix between investment types", () => {
    const a = withType({ ...brokerage, name: "Schwab" }, "roth_ira");
    expect(a.name).toBe("Schwab");
    expect([a.stocksPct, a.bondsPct]).toEqual([0.7, 0.3]);
    expect(a.annualContribution).toBe(5_000);
    expect(a.costBasis).toBeNull(); // Roth gains aren't taxed on sale
  });
});

describe("labels", () => {
  it("describes income timing", () => {
    expect(whenLabel({ startAge: null, endAge: null })).toBe("For life");
    expect(whenLabel({ startAge: null, endAge: 65 })).toBe("Now until 65");
    expect(whenLabel({ startAge: 70, endAge: null })).toBe("From 70");
  });

  it("describes loan payoff", () => {
    expect(payoffLabel({ balance: 1_000, interestRate: 0, monthlyPayment: 100 })).toBe("10 mo");
    expect(payoffLabel({ balance: 2_400, interestRate: 0, monthlyPayment: 100 })).toBe("2 yr");
    expect(payoffLabel({ balance: 10_000, interestRate: 0.24, monthlyPayment: 150 })).toBe("Never at this payment");
  });
});
