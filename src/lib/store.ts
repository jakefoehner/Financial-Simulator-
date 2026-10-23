import { create } from "zustand";
import { api } from "./api";
import type { Household } from "./types";

export type Section =
  "overview" | "people" | "accounts" | "income" | "debts" | "spending" | "scenarios" | "results" | "settings";

interface AppStore {
  section: Section;
  household: Household | null;
  /** Last load error (save errors are shown inside the sheet that caused them). */
  loadError: string | null;
  go: (s: Section) => void;
  load: () => Promise<void>;
  /** Runs a mutating command and stores the household it returns. Throws a user-facing message on failure. */
  mutate: (op: () => Promise<Household>) => Promise<void>;
}

export const useApp = create<AppStore>((set) => ({
  section: "overview",
  household: null,
  loadError: null,
  go: (section) => set({ section }),
  load: async () => {
    try {
      set({ household: await api.getHousehold(), loadError: null });
    } catch (e) {
      set({ loadError: String(e) });
    }
  },
  mutate: async (op) => {
    try {
      set({ household: await op() });
    } catch (e) {
      throw new Error(String(e));
    }
  },
}));
