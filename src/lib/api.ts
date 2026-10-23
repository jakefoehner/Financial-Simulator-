// Typed wrappers around Tauri commands. Keep names/shapes in sync with src-tauri/src/lib.rs.
// Every mutation returns the freshly stored Household.
import { invoke } from "@tauri-apps/api/core";
import type { ClaimAgeOutcome, Projection } from "./projection";
import type { ScenarioDetail, Simulation } from "./simulation";
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
  Scenario,
} from "./types";

export interface AppInfo {
  appVersion: string;
  engineVersion: string;
  dbPath: string;
  schemaVersion: number;
}

export type DemoName = "retiree" | "early_career";

/** Current-law gift/estate figures and family-loan minimum rates (from engine/tax_tables). */
export interface TaxFacts {
  taxYear: number;
  annualExclusion: number;
  exemption: number;
  afrMonth: string;
  afrShortTerm: number;
  afrMidTerm: number;
  afrLongTerm: number;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getHousehold: () => invoke<Household>("get_household"),
  saveHouseholdInfo: (info: HouseholdInfo) => invoke<Household>("save_household_info", { info }),
  saveAssumptions: (assumptions: Assumptions) => invoke<Household>("save_assumptions", { assumptions }),
  taxFacts: () => invoke<TaxFacts>("tax_facts"),
  saveScenario: (scenario: Scenario) => invoke<Household>("save_scenario", { scenario }),
  deleteScenario: (id: Id) => invoke<Household>("delete_scenario", { id }),

  // `scenario` is a plan id; null = the base plan.
  runProjection: (startYear: number, scenario: Id | null = null) =>
    invoke<Projection>("run_projection", { startYear, scenario }),
  compareClaimAges: (startYear: number, scenario: Id | null = null) =>
    invoke<ClaimAgeOutcome[]>("compare_claim_ages", { startYear, scenario }),
  runSimulation: (startYear: number, scenario: Id | null = null) =>
    invoke<Simulation>("run_simulation", { startYear, scenario }),
  scenarioDetail: (startYear: number, pathIndex: number, scenario: Id | null = null) =>
    invoke<ScenarioDetail>("scenario_detail", { startYear, pathIndex, scenario }),
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
