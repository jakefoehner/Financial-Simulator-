import { create } from "zustand";
import { api } from "./api";
import type { Household, Id } from "./types";

export type Section =
  "overview" | "people" | "accounts" | "income" | "debts" | "spending" | "scenarios" | "guide" | "results" | "settings";

interface AppStore {
  section: Section;
  household: Household | null;
  /** The plan the Forecast shows: a scenario id, or null for the base plan. */
  plan: Id | null;
  /** Last load error (save errors are shown inside the sheet that caused them). */
  loadError: string | null;
  /** Set by the File menu or the Settings card; BackupDialogs runs the flow. */
  backupRequest: "save" | "open" | null;
  requestBackup: (r: "save" | "open" | null) => void;
  go: (s: Section) => void;
  setPlan: (plan: Id | null) => void;
  load: () => Promise<void>;
  /** Runs a mutating command and stores the household it returns. Throws a user-facing message on failure. */
  mutate: (op: () => Promise<Household>) => Promise<void>;
}

/** Falls back to the base plan if the selected scenario was deleted. */
function validPlan(h: Household, plan: Id | null): Id | null {
  return plan != null && h.scenarios.some((s) => s.id === plan) ? plan : null;
}

export const useApp = create<AppStore>((set, get) => ({
  section: "overview",
  household: null,
  plan: null,
  loadError: null,
  backupRequest: null,
  requestBackup: (backupRequest) => set({ backupRequest }),
  go: (section) => set({ section }),
  setPlan: (plan) => set({ plan }),
  load: async () => {
    try {
      const household = await api.getHousehold();
      set({ household, plan: validPlan(household, get().plan), loadError: null });
    } catch (e) {
      set({ loadError: String(e) });
    }
  },
  mutate: async (op) => {
    try {
      const household = await op();
      set({ household, plan: validPlan(household, get().plan) });
    } catch (e) {
      throw new Error(String(e));
    }
  },
}));
