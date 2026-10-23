// Typed wrappers around Tauri commands. Keep names/shapes in sync with src-tauri/src/lib.rs.
// Every mutation returns the freshly stored Household.
import { invoke } from "@tauri-apps/api/core";
import type { ClaimAgeOutcome, Projection } from "./projection";
import type {
  Account,
  Assumptions,
  Debt,
  Household,
  HouseholdInfo,
  Id,
  IncomeStream,
  OneTimeExpense,
  Person,
} from "./types";

export interface AppInfo {
  appVersion: string;
  engineVersion: string;
  dbPath: string;
  schemaVersion: number;
}

export type DemoName = "retiree" | "early_career";

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getHousehold: () => invoke<Household>("get_household"),
  saveHouseholdInfo: (info: HouseholdInfo) => invoke<Household>("save_household_info", { info }),
  saveAssumptions: (assumptions: Assumptions) => invoke<Household>("save_assumptions", { assumptions }),
  runProjection: (startYear: number) => invoke<Projection>("run_projection", { startYear }),
  compareClaimAges: (startYear: number) => invoke<ClaimAgeOutcome[]>("compare_claim_ages", { startYear }),
  loadDemo: (which: DemoName) => invoke<Household>("load_demo", { which }),
  clearHousehold: () => invoke<Household>("clear_household"),

  upsertPerson: (person: Person) => invoke<Household>("upsert_person", { person }),
  deletePerson: (id: Id) => invoke<Household>("delete_person", { id }),
  upsertAccount: (account: Account) => invoke<Household>("upsert_account", { account }),
  deleteAccount: (id: Id) => invoke<Household>("delete_account", { id }),
  upsertIncome: (income: IncomeStream) => invoke<Household>("upsert_income", { income }),
  deleteIncome: (id: Id) => invoke<Household>("delete_income", { id }),
  upsertDebt: (debt: Debt) => invoke<Household>("upsert_debt", { debt }),
  deleteDebt: (id: Id) => invoke<Household>("delete_debt", { id }),
  upsertOneTimeExpense: (expense: OneTimeExpense) => invoke<Household>("upsert_one_time_expense", { expense }),
  deleteOneTimeExpense: (id: Id) => invoke<Household>("delete_one_time_expense", { id }),
};
