// Typed wrappers around Tauri commands. Keep names/shapes in sync with src-tauri/src/lib.rs.
// Every mutation returns the freshly stored Household.
import { invoke } from "@tauri-apps/api/core";
import type { ClaimAgeOutcome, Projection } from "./projection";
import type { SafeGiftRequest, SafeGiftResult, ScenarioDetail, Simulation } from "./simulation";
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

/** Mirrors src-tauri/src/backup.rs `BackupInfo`: what's in a backup file. */
export interface BackupInfo {
  appVersion: string;
  /** RFC 3339; empty for a bare household file. */
  savedAt: string;
  formatVersion: number;
  encrypted: boolean;
  householdName: string;
  people: number;
  children: number;
  accounts: number;
  income: number;
  debts: number;
  plans: number;
}

export interface BackupPreview {
  needsPassword: boolean;
  info: BackupInfo | null;
}

export interface BackupSettings {
  autoBackup: boolean;
  backupFolder: string | null;
  lastAutoBackup: string | null;
}

export interface BackupStatus {
  settings: BackupSettings;
  lastError: string | null;
  suggestedFolder: string;
}

/** Current-law gift/estate figures and family-loan minimum rates (from engine/tax_tables). */
export interface TaxFacts {
  taxYear: number;
  annualExclusion: number;
  exemption: number;
  afrMonth: string;
  afrShortTerm: number;
  afrMidTerm: number;
  afrLongTerm: number;
  /** IRS §7520 rate: values GRAT annuities. */
  section7520: number;
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
  safeGift: (startYear: number, scenario: Id | null, request: SafeGiftRequest) =>
    invoke<SafeGiftResult>("safe_gift", { startYear, scenario, request }),
  scenarioDetail: (startYear: number, pathIndex: number, scenario: Id | null = null) =>
    invoke<ScenarioDetail>("scenario_detail", { startYear, pathIndex, scenario }),
  loadDemo: (which: DemoName) => invoke<Household>("load_demo", { which }),
  clearHousehold: () => invoke<Household>("clear_household"),

  // Backups (`.fsim`). `password` null or "" = no password.
  saveBackup: (path: string, password: string | null) => invoke<void>("save_backup", { path, password }),
  inspectBackup: (path: string, password: string | null) => invoke<BackupPreview>("inspect_backup", { path, password }),
  restoreBackup: (path: string, password: string | null) => invoke<Household>("restore_backup", { path, password }),
  getBackupSettings: () => invoke<BackupStatus>("get_backup_settings"),
  saveBackupSettings: (settings: BackupSettings) => invoke<BackupStatus>("save_backup_settings", { settings }),

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
