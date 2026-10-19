// Typed wrappers around Tauri commands. Keep names/shapes in sync with src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  appVersion: string;
  engineVersion: string;
  dbPath: string;
  schemaVersion: number;
}

export interface Household {
  name: string;
  state: string;
  flatStateRate: number;
  updatedAt: string;
}

export type HouseholdUpdate = Partial<Pick<Household, "name" | "state" | "flatStateRate">>;

export interface Allocation {
  stocks: number;
  bonds: number;
  cash: number;
}

// Engine structs are snake_case on the Rust side.
export interface YearRow {
  year_index: number;
  start_balance: number;
  withdrawal: number;
  growth: number;
  end_balance: number;
  end_balance_real: number;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getHousehold: () => invoke<Household>("get_household"),
  updateHousehold: (update: HouseholdUpdate) => invoke<Household>("update_household", { update }),
  previewProjection: (startBalance: number, allocation: Allocation, annualSpend: number, years: number) =>
    invoke<YearRow[]>("preview_projection", { startBalance, allocation, annualSpend, years }),
};
