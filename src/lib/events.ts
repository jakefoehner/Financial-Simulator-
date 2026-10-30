// Scenario decisions: the choices offered, defaults for new ones, and plain-language summaries.
import type { TaxFacts } from "./api";
import type { Event, EventType, Id, LoanTerms } from "./types";

/** Offered in this order: the decisions Mom cares about most come first. */
export type ChoiceGroup = "kids" | "charity" | "advanced" | "self";

export const CHOICE_GROUPS: { id: ChoiceGroup; title: string }[] = [
  { id: "kids", title: "Help your kids" },
  { id: "charity", title: "Charity" },
  { id: "advanced", title: "Advanced estate tools" },
  { id: "self", title: "Your own money" },
];

/** Decisions that need children listed, and those that move investments in kind. */
export const NEEDS_KIDS: EventType[] = [
  "give_mix",
  "home_help",
  "cash_gift",
  "family_loan",
  "gift_assets",
  "fund529",
  "pay_tuition_medical",
  "family_llc",
  "grat",
];
export const NEEDS_GIFT_ACCOUNT: EventType[] = ["gift_assets", "family_llc", "grat"];

export const EVENT_CHOICES: { type: EventType; group: ChoiceGroup; title: string; blurb: string }[] = [
  {
    type: "home_help",
    group: "kids",
    title: "Help a child buy a home",
    blurb: "A down-payment gift, with an optional family loan for part of the price",
  },
  { type: "cash_gift", group: "kids", title: "Give cash", blurb: "Once or every year, to one child or to each child" },
  {
    type: "give_mix",
    group: "kids",
    title: "Give a mix of investments",
    blurb: "Stocks plus income funds (like Evergreen or Cliffwater), repeating every few years if savings hold",
  },
  {
    type: "family_loan",
    group: "kids",
    title: "Lend money to a child",
    blurb: "A loan at the IRS minimum rate, optionally forgiving some each year",
  },
  {
    type: "gift_assets",
    group: "kids",
    title: "Give stock or investments",
    blurb: "Put shares in a child's name; they keep your cost basis",
  },
  {
    type: "fund529",
    group: "kids",
    title: "Fund a 529 for a child",
    blurb: "Tax-free growth for school; up to 5 years of gifts at once",
  },
  {
    type: "pay_tuition_medical",
    group: "kids",
    title: "Pay tuition or medical bills",
    blurb: "Paid straight to the school or provider: not a gift, no limit",
  },
  {
    type: "charity_gift",
    group: "charity",
    title: "Give to charity",
    blurb: "Cash or appreciated stock, directly or through a donor-advised fund",
  },
  {
    type: "charitable_bequest",
    group: "charity",
    title: "Leave part of your estate to charity",
    blurb: "Lowers estate tax; IRA money is the most tax-efficient to leave",
  },
  {
    type: "family_llc",
    group: "advanced",
    title: "Set up a family LLC",
    blurb: "Give the kids LLC shares over time, valued at a discount",
  },
  {
    type: "grat",
    group: "advanced",
    title: "Use GRATs (annuity trusts)",
    blurb: "You're paid back with interest; growth above the IRS rate goes to the kids",
  },
  {
    type: "roth_conversion",
    group: "self",
    title: "Convert to Roth",
    blurb: "Move traditional IRA money to a Roth, paying tax now",
  },
  {
    type: "spending_change",
    group: "self",
    title: "Change yearly spending",
    blurb: "Spend more or less from a certain age",
  },
  {
    type: "social_security_age",
    group: "self",
    title: "Start Social Security at…",
    blurb: "Try a different claiming age",
  },
];

/** Extra words people might search for, per decision. */
export const CHOICE_KEYWORDS: Record<EventType, string> = {
  home_help: "house down payment mortgage buy first home gift loan",
  give_mix:
    "mix portfolio stocks income funds credit interval fund evergreen cliffwater yield payout repeat every years million",
  cash_gift: "money gift yearly annual exclusion tax-free each child",
  family_loan: "lend loan afr interest forgive mortgage note",
  gift_assets: "stock shares investments brokerage cost basis in kind meta",
  fund529: "college school education 529 superfund tuition grandchild",
  pay_tuition_medical: "college school tuition medical doctor hospital insurance health",
  charity_gift: "donate donation charity donor-advised fund daf church foundation stock deduction",
  charitable_bequest: "will estate charity donate ira beneficiary bequest",
  family_llc: "llc company business partnership discount shares control",
  grat: "trust annuity grat growth stock 7520",
  roth_conversion: "roth ira convert tax retirement",
  spending_change: "spend budget expenses lifestyle",
  social_security_age: "social security ss claim benefits retire age",
};

export function eventTitle(type: EventType): string {
  return EVENT_CHOICES.find((c) => c.type === type)!.title;
}

/** "2026-11" → "November 2026". */
export function afrMonthLabel(facts: TaxFacts): string {
  return new Date(`${facts.afrMonth}-15T12:00:00`).toLocaleString("en-US", { month: "long", year: "numeric" });
}

/** The IRS minimum (AFR) for a loan of this length: up to 3 years short-term, up to 9 mid-term, else long-term. */
export function afrFor(years: number, facts: TaxFacts): number {
  return years <= 3 ? facts.afrShortTerm : years <= 9 ? facts.afrMidTerm : facts.afrLongTerm;
}

export function defaultLoan(facts: TaxFacts, amount = 300_000, years = 15): LoanTerms {
  return { amount, rate: afrFor(years, facts), years, interestOnly: false, forgivePerYear: 0 };
}

/** A sensible starting point for a new decision. `age` is the primary person's age next year. */
export function newEvent(
  type: EventType,
  ctx: {
    firstChild: Id | null;
    firstGiftAccount: Id | null;
    age: number;
    facts: TaxFacts;
    /** Today's spendable savings, for the "only if savings hold" default. */
    savings?: number;
  },
): Event {
  const to = ctx.firstChild ?? 0;
  switch (type) {
    case "home_help":
      return { type, to, age: ctx.age, gift: 100_000, loan: null };
    case "give_mix":
      return {
        type,
        to: null,
        amount: 1_000_000,
        fromAge: ctx.age,
        everyYears: 4,
        untilAge: Math.max(ctx.age, 80),
        minSavings: ctx.savings ? Math.round((ctx.savings * 0.75) / 100_000) * 100_000 : null,
        stocksShare: 0.6,
        incomeYield: 0.085,
        reinvestIncome: false,
      };
    case "cash_gift":
      return {
        type,
        to: null,
        amount: ctx.facts.annualExclusion,
        fromAge: ctx.age,
        years: 10,
        maxAnnualExclusion: true,
      };
    case "family_loan":
      return { type, to, age: ctx.age, loan: defaultLoan(ctx.facts) };
    case "gift_assets":
      return { type, to: null, accountId: ctx.firstGiftAccount ?? 0, age: ctx.age, amount: 500_000 };
    case "roth_conversion":
      return { type, perYear: 100_000, fromAge: ctx.age, toAge: ctx.age + 4 };
    case "spending_change":
      return { type, fromAge: Math.max(ctx.age, 70), annualAmount: 0 };
    case "social_security_age":
      return { type, age: 70 };
    case "fund529":
      return { type, to, age: ctx.age, amount: 5 * ctx.facts.annualExclusion, superfund: true };
    case "pay_tuition_medical":
      return { type, to, amount: 60_000, fromAge: ctx.age, years: 4 };
    case "charity_gift":
      return { type, amount: 50_000, fromAge: ctx.age, years: 10, accountId: null, donorAdvised: false };
    case "charitable_bequest":
      return { type, share: 0.1, fromIraFirst: true };
    case "family_llc":
      return {
        type,
        accountId: ctx.firstGiftAccount ?? 0,
        age: ctx.age,
        amount: 3_000_000,
        discount: 0.3,
        giftShare: 0.1,
        years: 10,
      };
    case "grat":
      return {
        type,
        accountId: ctx.firstGiftAccount ?? 0,
        age: ctx.age,
        amount: 2_000_000,
        termYears: 2,
        rolling: true,
        untilAge: ctx.age + 10,
      };
  }
}

/** When the decision starts, for ordering the timeline. */
export function eventAge(e: Event): number {
  switch (e.type) {
    case "home_help":
    case "family_loan":
    case "gift_assets":
    case "social_security_age":
    case "fund529":
    case "family_llc":
    case "grat":
      return e.age;
    case "cash_gift":
    case "spending_change":
    case "roth_conversion":
    case "charity_gift":
    case "pay_tuition_medical":
    case "give_mix":
      return e.fromAge;
    case "charitable_bequest":
      // Happens at the end of the plan.
      return Number.MAX_SAFE_INTEGER;
  }
}

function ages(from: number, years: number): string {
  return years <= 1 ? `Age ${from}` : `Ages ${from}–${from + years - 1}`;
}

/** One line describing the decision, e.g. "Age 60 · Help Jordan buy a home: $100K gift + $400K loan…". */
export function eventSummary(
  e: Event,
  nameOf: (id: Id) => string,
  money: (v: number) => string,
  pct: (v: number) => string,
  accountName: (id: Id) => string = () => "an investment account",
): string {
  const loanText = (l: LoanTerms) =>
    `${money(l.amount)} loan over ${l.years} yrs at ${pct(l.rate)}${l.interestOnly ? " (interest only)" : ""}` +
    (l.forgivePerYear > 0 ? `, forgiving ${money(l.forgivePerYear)}/yr` : "");
  switch (e.type) {
    case "home_help":
      return (
        `Age ${e.age} · Help ${nameOf(e.to)} buy a home: ${money(e.gift)} gift` +
        (e.loan ? ` + ${loanText(e.loan)}` : "")
      );
    case "cash_gift": {
      const who = e.to == null ? "each child" : nameOf(e.to);
      const what = e.maxAnnualExclusion
        ? "the yearly gift-tax maximum"
        : `${money(e.amount)}${e.years > 1 ? " a year" : ""}`;
      return `${ages(e.fromAge, e.years)} · Give ${who} ${what}`;
    }
    case "family_loan":
      return `Age ${e.age} · Lend ${nameOf(e.to)} ${loanText(e.loan)}`;
    case "gift_assets":
      return `Age ${e.age} · Give ${e.to == null ? "each child" : nameOf(e.to)} ${money(e.amount)} from ${accountName(e.accountId)}`;
    case "roth_conversion":
      return `${ages(e.fromAge, e.toAge - e.fromAge + 1)} · Convert ${money(e.perYear)} a year to Roth`;
    case "spending_change":
      return `From age ${e.fromAge} · Spend ${money(e.annualAmount)} a year`;
    case "social_security_age":
      return `Start Social Security at ${e.age}`;
    case "give_mix": {
      const who = e.to == null ? "each child" : nameOf(e.to);
      const when = e.everyYears > 0 ? `Ages ${e.fromAge}–${e.untilAge}, every ${e.everyYears} yrs` : `Age ${e.fromAge}`;
      const mix = `${pct(e.stocksShare)} stocks, ${pct(1 - e.stocksShare)} income funds at ${pct(e.incomeYield)}${e.reinvestIncome ? " (reinvested)" : ""}`;
      const cond = e.minSavings != null ? `, if your savings are above ${money(e.minSavings)}` : "";
      return `${when} · Give ${who} ${money(e.amount)}: ${mix}${cond}`;
    }
    case "charity_gift": {
      const where = e.donorAdvised ? "a donor-advised fund" : "charity";
      const what = e.accountId == null ? "" : ` in stock from ${accountName(e.accountId)}`;
      return `${ages(e.fromAge, e.years)} · Give ${money(e.amount)}${e.years > 1 ? " a year" : ""}${what} to ${where}`;
    }
    case "charitable_bequest":
      return `In your will · Leave ${pct(e.share)} of your estate to charity${e.fromIraFirst ? ", IRA money first" : ""}`;
    case "fund529":
      return `Age ${e.age} · Put ${money(e.amount)} in a 529 for ${nameOf(e.to)}${e.superfund ? " (spread over 5 years)" : ""}`;
    case "pay_tuition_medical":
      return `${ages(e.fromAge, e.years)} · Pay ${money(e.amount)}${e.years > 1 ? " a year" : ""} of ${nameOf(e.to)}'s tuition or medical bills`;
    case "family_llc":
      return (
        `Age ${e.age} · Put ${money(e.amount)} from ${accountName(e.accountId)} in a family LLC; ` +
        `give the kids ${pct(e.giftShare)} of it a year for ${e.years} yrs at a ${pct(e.discount)} discount`
      );
    case "grat":
      return (
        `Age ${e.age} · Put ${money(e.amount)} from ${accountName(e.accountId)} in a ${e.termYears}-year GRAT` +
        (e.rolling ? `, rolling into new ones until ${e.untilAge}` : "")
      );
  }
}
