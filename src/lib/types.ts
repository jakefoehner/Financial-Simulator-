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
  | "llc_interest";
export type IncomeKind = "w2" | "bonus" | "self_employment" | "rental" | "pension" | "annuity" | "other";
export type DebtKind = "mortgage" | "student_loan" | "auto" | "credit_card" | "heloc" | "other";

export interface HouseholdInfo {
  name: string;
  state: string;
  flatStateRate: number;
  filingStatus: FilingStatus;
  baseAnnualSpending: number;
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
}

/** Mirrors `Assumptions::default()`. */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  stocksReturn: 0.07,
  bondsReturn: 0.04,
  cashReturn: 0.02,
  realEstateGrowth: 0.03,
  inflation: 0.025,
  stockDividendYield: 0.015,
};

export interface Household {
  info: HouseholdInfo;
  people: Person[];
  accounts: Account[];
  income: IncomeStream[];
  debts: Debt[];
  oneTimeExpenses: OneTimeExpense[];
  assumptions: Assumptions;
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

/** Mirrors `AccountType::has_allocation`. */
export function hasAllocation(t: AccountType): boolean {
  return !["checking", "savings", "real_estate", "pension"].includes(t);
}

/** Mirrors `AccountType::tracks_cost_basis`. */
export function tracksCostBasis(t: AccountType): boolean {
  return ["taxable", "real_estate", "crypto", "rsu", "espp", "options", "llc_interest"].includes(t);
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
