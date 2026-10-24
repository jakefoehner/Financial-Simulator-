// Typed wrappers around Tauri commands. Keep names/shapes in sync with src-tauri/src/lib.rs.
// Every mutation returns the freshly stored Household.
import { invoke } from "@tauri-apps/api/core";
import type { ClaimAgeOutcome, Projection } from "./projection";
import type { SafeGiftRequest, SafeGiftResult, ScenarioDetail, Simulation } from "./simulation";
import type {
  Account,
  Assumptions,
  Debt,
  Holding,
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
  /** What-if plans in the first household. */
  plans: number;
  /** Every household in the file; the first is the main one. */
  households: string[];
}

export interface BackupPreview {
  needsPassword: boolean;
  info: BackupInfo | null;
}

/** Mirrors src-tauri/src/family.rs. */
export interface HouseholdEntry {
  /** null = your own (main) household. */
  id: number | null;
  name: string;
  active: boolean;
  linkedPersonId: Id | null;
  parentPlan: Id | null;
}

export interface ChildRef {
  personId: Id;
  name: string;
  householdId: number | null;
}

export interface FamilyOverview {
  households: HouseholdEntry[];
  children: ChildRef[];
  /** File name while someone else's file is open read-only. */
  viewing: string | null;
}

/** Mirrors src-tauri/src/import.rs. */
export interface ImportedAccount {
  name: string;
  numberLast4: string | null;
  holdings: Holding[];
  cash: number;
  total: number;
  account: Account;
}

export type ImportPreview =
  | { kind: "parsed"; brokerage: string; accounts: ImportedAccount[] }
  | { kind: "needsMapping"; columns: string[]; headerRow: number; sample: string[][] };

export interface ColumnMapping {
  headerRow: number;
  symbol: number | null;
  description: number | null;
  shares: number | null;
  price: number | null;
  value: number | null;
  costBasis: number | null;
  account: number | null;
}

export interface ImportChoice {
  account: Account;
  /** Update this existing account instead of adding a new one. */
  updateId: Id | null;
}

/** Money arriving in a linked child household from the parent's plan. Totals in today's dollars. */
export interface IncomingTransfer {
  year: number;
  cash: number;
  assets: number;
  assetsBasis: number;
  education: number;
  paidForYou: number;
  loanIn: number;
  loanPayment: number;
  inheritance: number;
}

export interface IncomingSummary {
  parentName: string;
  childName: string;
  plan: Id | null;
  planName: string;
  plans: { id: Id | null; name: string }[];
  years: IncomingTransfer[];
  giftsReal: number;
  educationReal: number;
  paidForYouReal: number;
  loansInReal: number;
  loanPaymentsReal: number;
  inheritanceReal: number;
  inheritanceYear: number | null;
  parentEstateAge: number;
  problem: string | null;
}

/** Where a one-household backup goes. */
export type LoadTarget =
  { kind: "everything" } | { kind: "main" } | { kind: "child"; personId: Id } | { kind: "newChild" };

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
  saveBackup: (path: string, password: string | null, scope: "family" | "household") =>
    invoke<void>("save_backup", { path, password, scope }),
  inspectBackup: (path: string, password: string | null) => invoke<BackupPreview>("inspect_backup", { path, password }),
  restoreBackup: (path: string, password: string | null, target: LoadTarget | null) =>
    invoke<Household>("restore_backup", { path, password, target }),
  getBackupSettings: () => invoke<BackupStatus>("get_backup_settings"),

  // Households: yours (id null) and each child's.
  listHouseholds: () => invoke<FamilyOverview>("list_households"),
  switchHousehold: (id: number | null) => invoke<Household>("switch_household", { id }),
  buildChildHousehold: (personId: Id) => invoke<Household>("build_child_household", { personId }),
  deleteChildHousehold: (id: number) => invoke<Household>("delete_child_household", { id }),
  setParentPlan: (plan: Id | null) => invoke<void>("set_parent_plan", { plan }),
  incomingSummary: (startYear: number) => invoke<IncomingSummary | null>("incoming_summary", { startYear }),

  // Someone else's file, read-only.
  viewBackup: (path: string, password: string | null) => invoke<Household>("view_backup", { path, password }),
  closeView: () => invoke<Household>("close_view"),

  // Brokerage imports and exports.
  readImportFile: (path: string) => invoke<ImportPreview>("read_import_file", { path }),
  readImportMapped: (path: string, mapping: ColumnMapping) =>
    invoke<ImportPreview>("read_import_mapped", { path, mapping }),
  applyImport: (choices: ImportChoice[]) => invoke<Household>("apply_import", { choices }),
  writeTextFile: (path: string, contents: string) => invoke<void>("write_text_file", { path, contents }),
  printPage: () => invoke<void>("print_page"),
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
