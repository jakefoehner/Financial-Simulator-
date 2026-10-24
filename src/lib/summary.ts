import { isPrivate, type Household } from "./types";

export interface Summary {
  totalAssets: number;
  investable: number;
  realEstate: number;
  /** Private funds and startups: in net worth, not spendable until they pay out. */
  privateInvestments: number;
  totalDebts: number;
  netWorth: number;
  /** Yearly income currently being received (not future streams). */
  currentAnnualIncome: number;
  annualSpending: number;
  annualDebtPayments: number;
}

export interface SetupStep {
  id: "people" | "accounts" | "income" | "spending";
  label: string;
  done: boolean;
}

/** Point-in-time totals for the Overview page. The projection engine does the real math. */
export function summarize(h: Household, year = new Date().getFullYear()): Summary {
  const totalAssets = sum(h.accounts.map((a) => a.balance));
  const realEstate = sum(h.accounts.filter((a) => a.accountType === "real_estate").map((a) => a.balance));
  const privateInvestments = sum(h.accounts.filter((a) => isPrivate(a.accountType)).map((a) => a.balance));
  const totalDebts = sum(h.debts.map((d) => d.balance));

  const primary = h.people.find((p) => p.role === "primary") ?? h.people[0];
  const ageFor = (personId: number | null) => {
    const p = h.people.find((x) => x.id === personId) ?? primary;
    return p ? year - p.birthYear : 0;
  };
  const activeIncome = h.income.filter((i) => {
    const age = ageFor(i.personId);
    return (i.startAge == null || age >= i.startAge) && (i.endAge == null || age < i.endAge);
  });
  const socialSecurity = h.people
    .filter((p) => p.ssAlreadyClaiming && p.ssMonthlyBenefit)
    .map((p) => p.ssMonthlyBenefit! * 12);

  return {
    totalAssets,
    investable: totalAssets - realEstate - privateInvestments,
    realEstate,
    privateInvestments,
    totalDebts,
    netWorth: totalAssets - totalDebts,
    currentAnnualIncome: sum(activeIncome.map((i) => i.annualAmount)) + sum(socialSecurity),
    annualSpending: h.info.baseAnnualSpending,
    annualDebtPayments: sum(h.debts.map((d) => d.monthlyPayment * 12)),
  };
}

export function setupSteps(h: Household): SetupStep[] {
  return [
    { id: "people", label: "Add yourself", done: h.people.some((p) => p.role === "primary") },
    { id: "accounts", label: "Add your accounts", done: h.accounts.length > 0 },
    {
      id: "income",
      label: "Add income & Social Security",
      done: h.income.length > 0 || h.people.some((p) => p.ssMonthlyBenefit != null),
    },
    { id: "spending", label: "Set your yearly spending", done: h.info.baseAnnualSpending > 0 },
  ];
}

export function isEmpty(h: Household): boolean {
  return h.people.length + h.accounts.length + h.income.length + h.debts.length + h.oneTimeExpenses.length === 0;
}

/**
 * Months until a loan is paid off at its current payment, or `null` if the
 * payment never catches up with the interest.
 */
export function monthsToPayoff(balance: number, annualRate: number, monthlyPayment: number): number | null {
  if (balance <= 0) return 0;
  if (monthlyPayment <= 0) return null;
  const r = annualRate / 12;
  if (r === 0) return Math.ceil(balance / monthlyPayment);
  if (monthlyPayment <= balance * r) return null;
  // The small epsilon keeps float noise (e.g. 360.0000001) from adding a month.
  return Math.ceil(-Math.log(1 - (r * balance) / monthlyPayment) / Math.log(1 + r) - 1e-9);
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
