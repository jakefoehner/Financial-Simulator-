// Mirrors engine/src/projection.rs output, plus helpers for displaying it.

export interface Balances {
  cash: number;
  taxable: number;
  taxDeferred: number;
  taxFree: number;
  realEstate: number;
  education: number;
  /** Family loans still owed to you. */
  loansReceivable: number;
  /** Private funds and startups (not spendable until they pay out). */
  private: number;
  /** Your remaining share of a family LLC. */
  familyLlc: number;
  /** Assets inside GRATs still in their term. */
  grats: number;
}

export interface TaxResult {
  agi: number;
  taxableSocialSecurity: number;
  deduction: number;
  itemized: boolean;
  itemizedDeductions: number;
  charityDeduction: number;
  charityCashAbsorbed: number;
  charityPropertyAbsorbed: number;
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
  /** Gifts this year including forgiven loan principal; `cashGifts` is just the cash given. */
  gifts: number;
  giftsByChild: { childId: number; amount: number; basis: number; taxFree: number }[];
  giftTax: number;
  cashGifts: number;
  loansMade: number;
  loanReceipts: number;
  rothConversion: number;
  lifetimeTaxableGifts: number;
  portfolioReturn: number;
  privateIncome: number;
  privateProceeds: number;
  shelteredGifts: number;
  /** Given to charity: cash plus investments at market value; `charityCash` is just the cash. */
  charity: number;
  charityCash: number;
  charityCarryforward: number;
  /** 529s plus tuition/medical paid directly. */
  education: number;
  superfundPending: number;
  llcGifts: number;
  llcDiscount: number;
  gratRemainders: number;
  tax: TaxResult;
  balances: Balances;
  debtBalance: number;
  netWorth: number;
  priceLevel: number;
}

export interface ChildEstate {
  childId: number | null;
  name: string;
  giftsReal: number;
  giftsGrownReal: number;
  giftsCapitalGainsTaxReal: number;
  inheritanceReal: number;
  totalReal: number;
}

/** Mirrors engine::estate::EstateResult. All amounts in today's dollars. */
export interface EstateResult {
  age: number;
  year: number;
  grossEstateReal: number;
  lifetimeTaxableGiftsReal: number;
  exemptionReal: number;
  exemptionCutApplies: boolean;
  estateTaxReal: number;
  giftTaxPaidReal: number;
  heirIncomeTaxRate: number;
  heirsIncomeTaxReal: number;
  netInheritanceReal: number;
  lifetimeGiftsReal: number;
  lifetimeGiftsGrownReal: number;
  heirCapitalGainsRate: number;
  heirsCapitalGainsTaxReal: number;
  antiClawbackApplies: boolean;
  charitableBequestReal: number;
  lifetimeCharityReal: number;
  llcDiscountReal: number;
  superfundIncludedReal: number;
  familyTotalReal: number;
  children: ChildEstate[];
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
  estate: EstateResult;
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

/** Converts a value to the chosen dollars, given the price level it was measured at (today = 1). */
export function inDollars(value: number, priceLevel: number, mode: DollarMode): number {
  return mode === "future" ? value : value / priceLevel;
}

/**
 * Price level at the start of each year (today = 1): the previous year's
 * end-of-year level. Flows during a year are converted with this; end-of-year
 * balances use that year's own `priceLevel`. Works for steady and replayed inflation.
 */
export function startLevels(years: Pick<YearResult, "priceLevel">[]): number[] {
  return years.map((_, i) => (i === 0 ? 1 : years[i - 1].priceLevel));
}

/** The series the balance chart stacks, bottom to top. Order is fixed so colors never move. */
export const BALANCE_SERIES = [
  { key: "cash", label: "Cash", hint: "Checking and savings" },
  { key: "taxable", label: "Brokerage", hint: "Taxed on dividends and when sold" },
  { key: "taxDeferred", label: "Pre-tax retirement", hint: "Traditional 401(k)/IRA: taxed when withdrawn" },
  { key: "taxFree", label: "Tax-free", hint: "Roth and HSA" },
  {
    key: "realEstate",
    label: "Real estate & other",
    hint: "Homes, property, private funds and startups, any 529s, family loans owed to you, and your family LLC share and GRATs",
  },
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

export function balanceRows(p: Projection, mode: DollarMode): BalanceRow[] {
  return p.years.map((y) => {
    const d = (v: number) => inDollars(v, y.priceLevel, mode);
    return {
      age: y.age,
      year: y.year,
      cash: d(y.balances.cash),
      taxable: d(y.balances.taxable),
      taxDeferred: d(y.balances.taxDeferred),
      taxFree: d(y.balances.taxFree),
      // 529s, family loans, private funds, an LLC and GRATs fold into the top band instead of adding colors.
      realEstate: d(
        y.balances.realEstate +
          y.balances.education +
          y.balances.loansReceivable +
          y.balances.private +
          y.balances.familyLlc +
          y.balances.grats,
      ),
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
  /** Cash gifts, money lent to family, cash to charity, 529s and tuition, and any gift tax. */
  giving: number;
  taxes: number;
  saved: number;
  shortfall: number;
  netWorth: number;
}

export function cashFlowRows(p: Projection, mode: DollarMode): CashFlowRow[] {
  const levels = startLevels(p.years);
  return p.years.map((y, i) => {
    const f = (v: number) => inDollars(v, levels[i], mode);
    return {
      year: y.year,
      age: y.age,
      // Family loan repayments count as money coming in.
      income: f(y.earnedIncome + y.otherIncome + y.loanReceipts + y.privateIncome),
      socialSecurity: f(y.socialSecurity),
      // RMDs are forced withdrawals, so they count as money from savings.
      fromSavings: f(y.withdrawals + y.requiredDistributions),
      spending: f(y.spending + y.oneTimeExpenses + y.debtPayments),
      giving: f(y.cashGifts + y.loansMade + y.giftTax + y.charityCash + y.education),
      taxes: f(y.taxes + y.medicareSurcharge),
      saved: f(y.saved + y.contributions),
      shortfall: f(y.shortfall),
      netWorth: inDollars(y.netWorth, y.priceLevel, mode),
    };
  });
}
