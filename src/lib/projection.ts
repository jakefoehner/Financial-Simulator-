// Mirrors engine/src/projection.rs output, plus helpers for displaying it.

export interface Balances {
  cash: number;
  taxable: number;
  taxDeferred: number;
  taxFree: number;
  realEstate: number;
  education: number;
}

export interface TaxResult {
  agi: number;
  taxableSocialSecurity: number;
  deduction: number;
  taxableIncome: number;
  ordinaryTax: number;
  capitalGainsTax: number;
  childTaxCredit: number;
  incomeTax: number;
  niit: number;
  payrollTax: number;
  selfEmploymentTax: number;
  earlyWithdrawalPenalty: number;
  stateTax: number;
  federalTotal: number;
  total: number;
  marginalRate: number;
}

export interface YearResult {
  year: number;
  age: number;
  earnedIncome: number;
  otherIncome: number;
  socialSecurity: number;
  investmentIncome: number;
  requiredDistributions: number;
  withdrawals: number;
  spending: number;
  oneTimeExpenses: number;
  debtPayments: number;
  contributions: number;
  taxes: number;
  medicareSurcharge: number;
  saved: number;
  shortfall: number;
  tax: TaxResult;
  balances: Balances;
  debtBalance: number;
  netWorth: number;
  priceLevel: number;
}

export interface Summary {
  startYear: number;
  startAge: number;
  endAge: number;
  startingInvestable: number;
  runsOutAtAge: number | null;
  principalDipsAtAge: number | null;
  lowestInvestableReal: number;
  lowestInvestableAge: number | null;
  endingNetWorthReal: number;
  endingInvestableReal: number;
}

export interface Projection {
  summary: Summary;
  years: YearResult[];
}

export interface ClaimAgeOutcome {
  claimAge: number;
  isCurrentChoice: boolean;
  monthlyBenefitToday: number;
  lifetimeBenefitsReal: number;
  endingNetWorthReal: number;
  runsOutAtAge: number | null;
}

export type Tone = "good" | "caution" | "bad";

/**
 * Plain-language answer to "can I live off growth and income?", based on
 * spendable savings in today's dollars. A dip that recovers is a caution,
 * not an alarm.
 */
export function savingsVerdict(s: Summary, compact: (v: number) => string): { tone: Tone; text: string } {
  if (s.lowestInvestableAge == null) return { tone: "good", text: "Yes, savings never shrink" };
  if (s.endingInvestableReal >= s.startingInvestable) {
    return {
      tone: "caution",
      text: `Dips to ${compact(s.lowestInvestableReal)} at ${s.lowestInvestableAge}, then recovers`,
    };
  }
  return { tone: "bad", text: `Savings shrink to ${compact(s.endingInvestableReal)} by ${s.endAge}` };
}

/** "today" = today's dollars (inflation removed); "future" = the actual dollar amounts in that year. */
export type DollarMode = "today" | "future";

/**
 * Converts a year's value to the chosen dollars. End-of-year balances use the
 * end-of-year price level; flows during the year use the start-of-year level.
 */
export function inDollars(
  value: number,
  y: Pick<YearResult, "priceLevel">,
  mode: DollarMode,
  inflation: number,
  flow = false,
): number {
  if (mode === "future") return value;
  const level = flow ? y.priceLevel / (1 + inflation) : y.priceLevel;
  return value / level;
}

/** The series the balance chart stacks, bottom to top. Order is fixed so colors never move. */
export const BALANCE_SERIES = [
  { key: "cash", label: "Cash", hint: "Checking and savings" },
  { key: "taxable", label: "Brokerage", hint: "Taxed on dividends and when sold" },
  { key: "taxDeferred", label: "Pre-tax retirement", hint: "Traditional 401(k)/IRA: taxed when withdrawn" },
  { key: "taxFree", label: "Tax-free", hint: "Roth and HSA" },
  { key: "realEstate", label: "Real estate", hint: "Homes and property (plus any 529s)" },
] as const;

export type BalanceKey = (typeof BALANCE_SERIES)[number]["key"];

export interface BalanceRow {
  age: number;
  year: number;
  cash: number;
  taxable: number;
  taxDeferred: number;
  taxFree: number;
  realEstate: number;
  debt: number;
  netWorth: number;
}

export function balanceRows(p: Projection, mode: DollarMode, inflation: number): BalanceRow[] {
  return p.years.map((y) => {
    const d = (v: number) => inDollars(v, y, mode, inflation);
    return {
      age: y.age,
      year: y.year,
      cash: d(y.balances.cash),
      taxable: d(y.balances.taxable),
      taxDeferred: d(y.balances.taxDeferred),
      taxFree: d(y.balances.taxFree),
      // 529s are rare and small; fold them into the top band instead of adding a 6th color.
      realEstate: d(y.balances.realEstate + y.balances.education),
      debt: d(y.debtBalance),
      netWorth: d(y.netWorth),
    };
  });
}

export interface CashFlowRow {
  year: number;
  age: number;
  income: number;
  socialSecurity: number;
  fromSavings: number;
  spending: number;
  taxes: number;
  saved: number;
  shortfall: number;
  netWorth: number;
}

export function cashFlowRows(p: Projection, mode: DollarMode, inflation: number): CashFlowRow[] {
  return p.years.map((y) => {
    const f = (v: number) => inDollars(v, y, mode, inflation, true);
    return {
      year: y.year,
      age: y.age,
      income: f(y.earnedIncome + y.otherIncome),
      socialSecurity: f(y.socialSecurity),
      // RMDs are forced withdrawals, so they count as money from savings.
      fromSavings: f(y.withdrawals + y.requiredDistributions),
      spending: f(y.spending + y.oneTimeExpenses + y.debtPayments),
      taxes: f(y.taxes + y.medicareSurcharge),
      saved: f(y.saved + y.contributions),
      shortfall: f(y.shortfall),
      netWorth: inDollars(y.netWorth, y, mode, inflation),
    };
  });
}
