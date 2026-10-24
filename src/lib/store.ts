import { create } from "zustand";
import { api, type FamilyOverview } from "./api";
import type { Household, Id } from "./types";

export type Section =
  | "overview"
  | "people"
  | "accounts"
  | "income"
  | "debts"
  | "spending"
  | "scenarios"
  | "guide"
  | "results"
  | "data"
  | "settings";

export type BackupRequest = "save" | "saveOne" | "open";

interface AppStore {
  section: Section;
  /** The household being viewed (yours or a child's). */
  household: Household | null;
  /** Your household and the children's, for the switcher. */
  family: FamilyOverview | null;
  /** The plan the Forecast shows: a scenario id, or null for the base plan. */
  plan: Id | null;
  /** Last load error (save errors are shown inside the sheet that caused them). */
  loadError: string | null;
  /** Set by the File menu or the Save & load page; BackupDialogs runs the flow.
   *  "saveOne" = just the household being viewed. */
  backupRequest: BackupRequest | null;
  requestBackup: (r: BackupRequest | null) => void;
  go: (s: Section) => void;
  setPlan: (plan: Id | null) => void;
  load: () => Promise<void>;
  /** Runs a mutating command and stores the household it returns. Throws a user-facing message on failure. */
  mutate: (op: () => Promise<Household>) => Promise<void>;
  /** View another household (`null` = yours). */
  switchHousehold: (id: number | null) => Promise<void>;
  /** Search text per list ("scenarios", "decisions", "guide"), kept while the app is open. */
  searches: Record<string, string>;
  setSearch: (scope: string, text: string) => void;
}

/** Falls back to the base plan if the selected scenario was deleted. */
function validPlan(h: Household, plan: Id | null): Id | null {
  return plan != null && h.scenarios.some((s) => s.id === plan) ? plan : null;
}

/** The household being viewed, from the family list. */
export function activeHousehold(f: FamilyOverview | null) {
  return f?.households.find((h) => h.active) ?? null;
}

export const useApp = create<AppStore>((set, get) => ({
  section: "overview",
  household: null,
  family: null,
  plan: null,
  loadError: null,
  backupRequest: null,
  searches: {},
  setSearch: (scope, text) => set({ searches: { ...get().searches, [scope]: text } }),
  requestBackup: (backupRequest) => set({ backupRequest }),
  go: (section) => set({ section }),
  setPlan: (plan) => set({ plan }),
  load: async () => {
    try {
      const [household, family] = await Promise.all([api.getHousehold(), api.listHouseholds()]);
      set({ household, family, plan: validPlan(household, get().plan), loadError: null });
    } catch (e) {
      set({ loadError: String(e) });
    }
  },
  mutate: async (op) => {
    try {
      const household = await op();
      // Names, links and which household is open can all change; refresh the list too.
      const family = await api.listHouseholds();
      set({ household, family, plan: validPlan(household, get().plan) });
    } catch (e) {
      throw new Error(String(e));
    }
  },
  switchHousehold: async (id) => {
    const household = await api.switchHousehold(id);
    const family = await api.listHouseholds();
    // Plans belong to a household, so start the new one on its base plan.
    set({ household, family, plan: null });
  },
}));
