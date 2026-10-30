import { describe, expect, it } from "vitest";
import type { TaxFacts } from "./api";
import { afrFor, CHOICE_KEYWORDS, eventAge, eventSummary, EVENT_CHOICES, newEvent } from "./events";
import { matches } from "./search";
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
  section7520: 0.062,
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
      const e = newEvent(c.type, { firstChild: 2, firstGiftAccount: 1, age: 59, facts });
      expect(e.type).toBe(c.type);
    }
    const loan = newEvent("family_loan", { firstChild: 2, firstGiftAccount: 1, age: 59, facts });
    expect(loan.type === "family_loan" && loan.loan.rate).toBe(0.0552);
  });
});

describe("decision search", () => {
  it("finds decisions by everyday words", () => {
    const find = (q: string) =>
      EVENT_CHOICES.filter((c) => matches(q, [c.title, c.blurb, CHOICE_KEYWORDS[c.type]])).map((c) => c.type);
    expect(find("house")).toContain("home_help");
    expect(find("college")).toEqual(expect.arrayContaining(["fund529", "pay_tuition_medical"]));
    expect(find("trust")).toEqual(["grat"]);
    expect(find("donate")).toEqual(expect.arrayContaining(["charity_gift", "charitable_bequest"]));
    expect(find("loan")).toContain("family_loan");
    for (const c of EVENT_CHOICES) expect(find(c.title), c.type).toContain(c.type);
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
    expect(
      eventSummary(
        { type: "gift_assets", to: null, accountId: 1, age: 59, amount: 1_000_000 },
        (id) => names[id],
        formatUsdCompact,
        formatPercent,
        () => "Taxable brokerage",
      ),
    ).toBe("Age 59 · Give each child $1M from Taxable brokerage");
  });

  it("describes a repeating mix gift", () => {
    expect(
      summary({
        type: "give_mix",
        to: null,
        amount: 1_000_000,
        fromAge: 59,
        everyYears: 4,
        untilAge: 79,
        minSavings: 10_000_000,
        stocksShare: 0.6,
        incomeYield: 0.085,
        reinvestIncome: false,
      }),
    ).toBe(
      "Ages 59–79, every 4 yrs · Give each child $1M: 60% stocks, 40% income funds at 8.5%, if your savings are above $10M",
    );
  });

  it("describes charity, education, LLC and GRAT decisions", () => {
    const acct = () => "Brokerage";
    const s = (e: Event) => eventSummary(e, (id) => names[id], formatUsdCompact, formatPercent, acct);
    expect(s({ type: "charity_gift", amount: 100_000, fromAge: 60, years: 5, accountId: 1, donorAdvised: true })).toBe(
      "Ages 60–64 · Give $100K a year in stock from Brokerage to a donor-advised fund",
    );
    expect(s({ type: "charitable_bequest", share: 0.1, fromIraFirst: true })).toBe(
      "In your will · Leave 10% of your estate to charity, IRA money first",
    );
    expect(s({ type: "fund529", to: 2, age: 59, amount: 95_000, superfund: true })).toBe(
      "Age 59 · Put $95K in a 529 for Sam (spread over 5 years)",
    );
    expect(s({ type: "pay_tuition_medical", to: 3, amount: 60_000, fromAge: 59, years: 4 })).toBe(
      "Ages 59–62 · Pay $60K a year of Jordan's tuition or medical bills",
    );
    expect(
      s({ type: "family_llc", accountId: 1, age: 59, amount: 3_000_000, discount: 0.3, giftShare: 0.1, years: 10 }),
    ).toBe(
      "Age 59 · Put $3M from Brokerage in a family LLC; give the kids 10% of it a year for 10 yrs at a 30% discount",
    );
    expect(
      s({ type: "grat", accountId: 1, age: 59, amount: 2_000_000, termYears: 2, rolling: true, untilAge: 69 }),
    ).toBe("Age 59 · Put $2M from Brokerage in a 2-year GRAT, rolling into new ones until 69");
  });

  it("orders decisions by when they start", () => {
    const events: Event[] = [
      { type: "social_security_age", age: 70 },
      { type: "spending_change", fromAge: 65, annualAmount: 1 },
    ];
    expect(events.map(eventAge)).toEqual([70, 65]);
  });
});
