import { describe, expect, it } from "vitest";
import type { TaxFacts } from "./api";
import { afrFor, eventAge, eventSummary, EVENT_CHOICES, newEvent } from "./events";
import { formatPercent, formatUsdCompact } from "./format";
import type { Event } from "./types";

const facts: TaxFacts = {
  taxYear: 2026,
  annualExclusion: 19_000,
  exemption: 15_000_000,
  afrMonth: "2026-11",
  afrShortTerm: 0.0467,
  afrMidTerm: 0.0508,
  afrLongTerm: 0.0552,
};
const names: Record<number, string> = { 2: "Sam", 3: "Jordan" };
const summary = (e: Event) => eventSummary(e, (id) => names[id], formatUsdCompact, formatPercent);

describe("afrFor", () => {
  it("picks the IRS term bucket", () => {
    expect(afrFor(3, facts)).toBe(0.0467);
    expect(afrFor(9, facts)).toBe(0.0508);
    expect(afrFor(15, facts)).toBe(0.0552);
  });
});

describe("newEvent", () => {
  it("has a default for every choice, starting at the given age", () => {
    for (const c of EVENT_CHOICES) {
      const e = newEvent(c.type, { firstChild: 2, age: 59, facts });
      expect(e.type).toBe(c.type);
    }
    const loan = newEvent("family_loan", { firstChild: 2, age: 59, facts });
    expect(loan.type === "family_loan" && loan.loan.rate).toBe(0.0552);
  });
});

describe("eventSummary", () => {
  it("describes the main decisions in plain language", () => {
    expect(summary({ type: "home_help", to: 2, age: 59, gift: 150_000, loan: null })).toBe(
      "Age 59 · Help Sam buy a home: $150K gift",
    );
    expect(
      summary({
        type: "home_help",
        to: 3,
        age: 60,
        gift: 100_000,
        loan: { amount: 400_000, rate: 0.0552, years: 15, interestOnly: false, forgivePerYear: 19_000 },
      }),
    ).toBe("Age 60 · Help Jordan buy a home: $100K gift + $400K loan over 15 yrs at 5.52%, forgiving $19K/yr");
    expect(summary({ type: "cash_gift", to: null, amount: 0, fromAge: 59, years: 20, maxAnnualExclusion: true })).toBe(
      "Ages 59–78 · Give each child the yearly gift-tax maximum",
    );
    expect(
      summary({ type: "cash_gift", to: 2, amount: 50_000, fromAge: 61, years: 1, maxAnnualExclusion: false }),
    ).toBe("Age 61 · Give Sam $50K");
    expect(summary({ type: "roth_conversion", perYear: 100_000, fromAge: 60, toAge: 64 })).toBe(
      "Ages 60–64 · Convert $100K a year to Roth",
    );
    expect(summary({ type: "social_security_age", age: 70 })).toBe("Start Social Security at 70");
  });

  it("orders decisions by when they start", () => {
    const events: Event[] = [
      { type: "social_security_age", age: 70 },
      { type: "spending_change", fromAge: 65, annualAmount: 1 },
    ];
    expect(events.map(eventAge)).toEqual([70, 65]);
  });
});
