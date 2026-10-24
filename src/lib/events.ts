// Scenario decisions: the choices offered, defaults for new ones, and plain-language summaries.
import type { TaxFacts } from "./api";
import type { Event, EventType, Id, LoanTerms } from "./types";

/** Offered in this order: the decisions Mom cares about most come first. */
export const EVENT_CHOICES: { type: EventType; title: string; blurb: string }[] = [
  {
    type: "home_help",
    title: "Help a child buy a home",
    blurb: "A down-payment gift, with an optional family loan for part of the price",
  },
  { type: "cash_gift", title: "Give cash", blurb: "Once or every year, to one child or to each child" },
  {
    type: "family_loan",
    title: "Lend money to a child",
    blurb: "A loan at the IRS minimum rate, optionally forgiving some each year",
  },
  {
    type: "gift_assets",
    title: "Give stock or investments",
    blurb: "Put shares in a child's name; they keep your cost basis",
  },
  { type: "roth_conversion", title: "Convert to Roth", blurb: "Move traditional IRA money to a Roth, paying tax now" },
  { type: "spending_change", title: "Change yearly spending", blurb: "Spend more or less from a certain age" },
  { type: "social_security_age", title: "Start Social Security at…", blurb: "Try a different claiming age" },
];

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
  ctx: { firstChild: Id | null; firstGiftAccount: Id | null; age: number; facts: TaxFacts },
): Event {
  const to = ctx.firstChild ?? 0;
  switch (type) {
    case "home_help":
      return { type, to, age: ctx.age, gift: 100_000, loan: null };
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
  }
}

/** When the decision starts, for ordering the timeline. */
export function eventAge(e: Event): number {
  switch (e.type) {
    case "home_help":
    case "family_loan":
    case "gift_assets":
    case "social_security_age":
      return e.age;
    case "cash_gift":
    case "spending_change":
    case "roth_conversion":
      return e.fromAge;
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
  }
}
