// Mirrors engine/src/model.rs. Keep field names and enum strings in sync.

export type Id = number;

export type FilingStatus = "single" | "married_joint" | "married_separate" | "head_of_household";
export type Role = "primary" | "spouse" | "child" | "other";
export type AccountType =
  | "checking"
  | "savings"
  | "taxable"
  | "trad_401k"
  | "roth_401k"
  | "trad_ira"
  | "roth_ira"
  | "hsa"
  | "plan_529"
  | "pension"
  | "real_estate"
  | "crypto"
  | "rsu"
  | "espp"
  | "options"
  | "llc_interest"
  | "real_estate_fund"
  | "private_credit"
  | "startup"
  | "other_alternative";
export type IncomeKind = "w2" | "bonus" | "self_employment" | "rental" | "pension" | "annuity" | "other";
export type DebtKind = "mortgage" | "student_loan" | "auto" | "credit_card" | "heloc" | "other";

export interface HouseholdInfo {
  name: string;
  state: string;
  flatStateRate: number;
  filingStatus: FilingStatus;
  baseAnnualSpending: number;
  /** Yearly home property tax in today's dollars (part of spending; used for itemized deductions). */
  homePropertyTax: number;
}

export interface Person {
  id: Id | null;
  name: string;
  birthYear: number;
  role: Role;
  lifeExpectancy: number;
  ssMonthlyBenefit: number | null;
  ssClaimAge: number;
  ssAlreadyClaiming: boolean;
}

export interface Account {
  id: Id | null;
  name: string;
  accountType: AccountType;
  ownerId: Id | null;
  balance: number;
  costBasis: number | null;
  stocksPct: number;
  bondsPct: number;
  cashPct: number;
  annualContribution: number;
  employerMatch: number;
  notes: string;
  /** Terms for private funds and startups; null for every other type. */
  private: PrivateTerms | null;
}

/** Mirrors engine::model::PrivateTerms. `balance` is today's value; `costBasis` is what was invested. */
export interface PrivateTerms {
  /** Cash paid out each year, as a share of what was invested. */
  cashYield: number;
  /** Share of payouts that is taxable income. */
  taxableShare: number;
  exitYear: number | null;
  /** Payout at exit as a multiple of what was invested (startups: the expected multiple). */
  exitMultiple: number;
  companies: number;
  qsbs: boolean;
}

export interface IncomeStream {
  id: Id | null;
  personId: Id | null;
  kind: IncomeKind;
  name: string;
  annualAmount: number;
  growthRate: number;
  startAge: number | null;
  endAge: number | null;
}

export interface Debt {
  id: Id | null;
  name: string;
  kind: DebtKind;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
  accountId: Id | null;
  notes: string;
  /** The mortgage on your own home: its interest can be itemized. */
  homeMortgage: boolean;
}

export interface OneTimeExpense {
  id: Id | null;
  name: string;
  year: number;
  amount: number;
}

export interface Assumptions {
  stocksReturn: number;
  bondsReturn: number;
  cashReturn: number;
  realEstateGrowth: number;
  inflation: number;
  stockDividendYield: number;
  /** Replayed-history scenarios in the range of outcomes. */
  simulations: number;
  /** Constant inflation instead of replaying history's. */
  steadyInflation: boolean;
  /** Income-tax rate heirs are assumed to pay on inherited traditional IRA/401(k) money. */
  heirIncomeTaxRate: number;
  /** "What if the estate exemption is cut": from this year on it becomes this amount (today's dollars). */
  exemptionCutEnabled: boolean;
  exemptionCutAmount: number;
  exemptionCutYear: number;
  /** Age at which to estimate the estate; null = the plan's last year. */
  estateAge: number | null;
  /** Capital-gains rate the kids pay selling gifted assets (gifts keep your basis). */
  heirCapitalGainsRate: number;
  /** "What if taxes rise": from this year, brackets and capital-gains rates go up by these amounts. */
  taxRiseEnabled: boolean;
  taxRiseYear: number;
  incomeTaxIncrease: number;
  capitalGainsIncrease: number;
}

export interface LoanTerms {
  amount: number;
  rate: number;
  years: number;
  interestOnly: boolean;
  forgivePerYear: number;
}

/** Mirrors engine::model::Event (tagged by `type`). Ages are the primary person's; money is today's dollars. */
export type Event =
  | { type: "home_help"; to: Id; age: number; gift: number; loan: LoanTerms | null }
  | { type: "cash_gift"; to: Id | null; amount: number; fromAge: number; years: number; maxAnnualExclusion: boolean }
  | { type: "family_loan"; to: Id; age: number; loan: LoanTerms }
  | { type: "gift_assets"; to: Id | null; accountId: Id; age: number; amount: number }
  | { type: "social_security_age"; age: number }
  | { type: "spending_change"; fromAge: number; annualAmount: number }
  | { type: "roth_conversion"; perYear: number; fromAge: number; toAge: number }
  | {
      type: "charity_gift";
      amount: number;
      fromAge: number;
      years: number;
      /** Give appreciated investments from this account; `null` = cash. */
      accountId: Id | null;
      donorAdvised: boolean;
    }
  | { type: "charitable_bequest"; share: number; fromIraFirst: boolean }
  | { type: "fund529"; to: Id; age: number; amount: number; superfund: boolean }
  | { type: "pay_tuition_medical"; to: Id; amount: number; fromAge: number; years: number }
  | {
      type: "family_llc";
      accountId: Id;
      age: number;
      amount: number;
      discount: number;
      /** Share of the LLC given each year, split evenly between the kids. */
      giftShare: number;
      years: number;
    }
  | {
      type: "grat";
      accountId: Id;
      age: number;
      amount: number;
      termYears: number;
      rolling: boolean;
      untilAge: number;
    };

export type EventType = Event["type"];

export interface Scenario {
  id: Id | null;
  name: string;
  notes: string;
  events: Event[];
}

/** Mirrors `Assumptions::default()`. */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  stocksReturn: 0.07,
  bondsReturn: 0.04,
  cashReturn: 0.02,
  realEstateGrowth: 0.03,
  inflation: 0.025,
  stockDividendYield: 0.015,
  simulations: 5000,
  steadyInflation: false,
  heirIncomeTaxRate: 0.24,
  exemptionCutEnabled: false,
  exemptionCutAmount: 7_000_000,
  exemptionCutYear: 2030,
  estateAge: null,
  heirCapitalGainsRate: 0.15,
  taxRiseEnabled: false,
  taxRiseYear: 2030,
  incomeTaxIncrease: 0.05,
  capitalGainsIncrease: 0.05,
};

export interface Household {
  info: HouseholdInfo;
  people: Person[];
  accounts: Account[];
  income: IncomeStream[];
  debts: Debt[];
  oneTimeExpenses: OneTimeExpense[];
  assumptions: Assumptions;
  scenarios: Scenario[];
}

// --- Labels -----------------------------------------------------------------

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: "Single",
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  head_of_household: "Head of household",
};

export const ROLE_LABELS: Record<Role, string> = {
  primary: "Me",
  spouse: "Spouse / partner",
  child: "Child",
  other: "Other",
};

/** Grouped for the account-type picker and the Accounts page sections. */
export const ACCOUNT_GROUPS: { label: string; types: { type: AccountType; label: string }[] }[] = [
  {
    label: "Cash",
    types: [
      { type: "checking", label: "Checking" },
      { type: "savings", label: "Savings" },
    ],
  },
  {
    label: "Investments",
    types: [
      { type: "taxable", label: "Brokerage (taxable)" },
      { type: "crypto", label: "Crypto" },
      { type: "llc_interest", label: "Family LLC interest" },
    ],
  },
  {
    label: "Retirement",
    types: [
      { type: "trad_401k", label: "401(k) / 403(b) — traditional" },
      { type: "roth_401k", label: "401(k) / 403(b) — Roth" },
      { type: "trad_ira", label: "IRA — traditional" },
      { type: "roth_ira", label: "IRA — Roth" },
      { type: "pension", label: "Pension (lump-sum value)" },
    ],
  },
  {
    label: "Health & education",
    types: [
      { type: "hsa", label: "HSA" },
      { type: "plan_529", label: "529 college savings" },
    ],
  },
  {
    label: "Equity compensation",
    types: [
      { type: "rsu", label: "RSUs" },
      { type: "espp", label: "ESPP" },
      { type: "options", label: "Stock options" },
    ],
  },
  { label: "Property", types: [{ type: "real_estate", label: "Real estate" }] },
  {
    label: "Private investments",
    types: [
      { type: "real_estate_fund", label: "Private real estate fund" },
      { type: "private_credit", label: "Private credit fund" },
      { type: "startup", label: "Startup / angel investments" },
      { type: "other_alternative", label: "Other private investment" },
    ],
  },
];

export const ACCOUNT_TYPE_LABELS = Object.fromEntries(
  ACCOUNT_GROUPS.flatMap((g) => g.types.map((t) => [t.type, t.label])),
) as Record<AccountType, string>;

export const INCOME_KIND_LABELS: Record<IncomeKind, string> = {
  w2: "Salary / wages (W-2)",
  bonus: "Bonus",
  self_employment: "Self-employment",
  rental: "Rental income",
  pension: "Pension",
  annuity: "Annuity",
  other: "Other",
};

export const DEBT_KIND_LABELS: Record<DebtKind, string> = {
  mortgage: "Mortgage",
  student_loan: "Student loan",
  auto: "Auto loan",
  credit_card: "Credit card",
  heloc: "Home equity line (HELOC)",
  other: "Other",
};

// --- Rules mirrored from the engine (for showing/hiding fields) --------------

/** Mirrors `AccountType::is_private`. */
export function isPrivate(t: AccountType): boolean {
  return ["real_estate_fund", "private_credit", "startup", "other_alternative"].includes(t);
}

/** Mirrors `AccountType::giftable_in_kind`. */
export function giftableInKind(t: AccountType): boolean {
  return ["taxable", "crypto", "rsu", "espp"].includes(t);
}

/** Mirrors `AccountType::has_allocation`. */
export function hasAllocation(t: AccountType): boolean {
  return !["checking", "savings", "real_estate", "pension"].includes(t) && !isPrivate(t);
}

/** Mirrors `AccountType::tracks_cost_basis`. */
export function tracksCostBasis(t: AccountType): boolean {
  return ["taxable", "real_estate", "crypto", "rsu", "espp", "options", "llc_interest"].includes(t) || isPrivate(t);
}

/** Mirrors `PrivateTerms::default_for`: typical starting terms the user then edits. */
export function defaultPrivateTerms(t: AccountType, year = currentYear()): PrivateTerms {
  const base: PrivateTerms = {
    cashYield: 0,
    taxableShare: 1,
    exitYear: year + 7,
    exitMultiple: 1.5,
    companies: 1,
    qsbs: false,
  };
  if (t === "real_estate_fund") return { ...base, cashYield: 0.08, taxableShare: 0.5 };
  if (t === "private_credit") return { ...base, cashYield: 0.085, exitYear: year + 5, exitMultiple: 1 };
  if (t === "startup") return { ...base, exitYear: year + 8, exitMultiple: 2, companies: 5 };
  return base;
}

/** Accounts you typically add money to every year. */
export function takesContributions(t: AccountType): boolean {
  return ["taxable", "trad_401k", "roth_401k", "trad_ira", "roth_ira", "hsa", "plan_529", "crypto", "espp"].includes(t);
}

export function hasEmployerMatch(t: AccountType): boolean {
  return t === "trad_401k" || t === "roth_401k" || t === "hsa";
}

/** Default stocks/bonds/cash mix when someone picks an account type. */
export function defaultAllocation(t: AccountType): Pick<Account, "stocksPct" | "bondsPct" | "cashPct"> {
  if (t === "checking" || t === "savings") return { stocksPct: 0, bondsPct: 0, cashPct: 1 };
  if (!hasAllocation(t)) return { stocksPct: 0, bondsPct: 0, cashPct: 0 };
  if (t === "crypto" || t === "rsu" || t === "espp" || t === "options")
    return { stocksPct: 1, bondsPct: 0, cashPct: 0 };
  return { stocksPct: 0.6, bondsPct: 0.4, cashPct: 0 };
}

export function currentYear(): number {
  return new Date().getFullYear();
}

export function ageOf(p: Pick<Person, "birthYear">, year = currentYear()): number {
  return year - p.birthYear;
}
