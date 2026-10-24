import {
  BookOpen,
  ChartLine,
  CreditCard,
  FolderInput,
  GitBranch,
  House,
  Landmark,
  Receipt,
  Settings as SettingsIcon,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { BackupDialogs } from "./components/BackupDialogs";
import { HouseholdSwitcher } from "./components/HouseholdSwitcher";
import Accounts from "./pages/Accounts";
import Debts from "./pages/Debts";
import Guide from "./pages/Guide";
import Income from "./pages/Income";
import Overview from "./pages/Overview";
import People from "./pages/People";
import Settings from "./pages/Settings";
import Report from "./pages/Report";
import Results from "./pages/Results";
import SaveLoad from "./pages/SaveLoad";
import Scenarios from "./pages/scenarios/Scenarios";
import Spending from "./pages/Spending";
import { api } from "./lib/api";
import { activeHousehold, useApp, type Section } from "./lib/store";

const NAV: { id: Section; label: string; icon: LucideIcon }[][] = [
  [{ id: "overview", label: "Overview", icon: House }],
  [
    { id: "people", label: "People", icon: Users },
    { id: "accounts", label: "Accounts", icon: Landmark },
    { id: "income", label: "Income", icon: Wallet },
    { id: "debts", label: "Debts", icon: CreditCard },
    { id: "spending", label: "Spending", icon: Receipt },
  ],
  [
    { id: "results", label: "Forecast", icon: ChartLine },
    { id: "scenarios", label: "Scenarios", icon: GitBranch },
    { id: "guide", label: "Giving guide", icon: BookOpen },
  ],
  [
    { id: "data", label: "Save & load", icon: FolderInput },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ],
];

const PAGES: Record<Section, () => React.JSX.Element | null> = {
  overview: Overview,
  people: People,
  accounts: Accounts,
  income: Income,
  debts: Debts,
  spending: Spending,
  results: Results,
  report: Report,
  scenarios: Scenarios,
  guide: Guide,
  data: SaveLoad,
  settings: Settings,
};

export default function App() {
  const { section, go, household, family, loadError, load, switchHousehold, mutate } = useApp();

  useEffect(() => {
    void load().then(async () => {
      // Keep positions current: prices older than 12 hours are refreshed in the background.
      if (!useApp.getState().household?.accounts.some((a) => a.holdings.length > 0)) return;
      try {
        const status = await api.refreshPrices(false);
        if (status.updated.length > 0) await load();
      } catch {
        // Offline is fine: the last prices stay.
      }
    });
  }, [load]);

  const Page = PAGES[section];
  const active = activeHousehold(family);
  const main = family?.households[0];

  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] px-2 pt-6">
        <div className="mb-3 px-3 text-sm font-semibold tracking-tight">Finance Simulator</div>
        <HouseholdSwitcher />
        {NAV.map((group, gi) => (
          <div key={gi} className="mb-3 flex flex-col gap-0.5">
            {group.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                  n.id === section ? "bg-accent text-white" : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <n.icon size={16} strokeWidth={1.75} className={n.id === section ? "" : "text-[var(--muted)]"} />
                {n.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-5xl">
          {family?.viewing && (
            <div className="no-print mb-5 flex items-center justify-between gap-4 rounded-lg bg-amber-500/15 px-4 py-2 text-sm">
              <span>
                <strong className="font-semibold">Viewing “{family.viewing}” (read-only).</strong>{" "}
                <span className="text-[var(--muted)]">Look around freely; nothing here can be changed or saved.</span>
              </span>
              <span className="flex shrink-0 gap-3">
                <button
                  className="font-medium text-accent hover:underline"
                  onClick={async () => {
                    await mutate(api.closeView);
                    useApp.getState().requestBackup("open");
                  }}
                >
                  Load it as my own…
                </button>
                <button className="font-medium text-accent hover:underline" onClick={() => void mutate(api.closeView)}>
                  Close
                </button>
              </span>
            </div>
          )}
          {active && active.id != null && main && (
            <div className="no-print mb-5 flex items-center justify-between gap-4 rounded-lg bg-accent/10 px-4 py-2 text-sm">
              <span>
                <strong className="font-semibold">{active.name}'s household.</strong>{" "}
                <span className="text-[var(--muted)]">
                  {active.linkedPersonId != null
                    ? `Linked to ${main.name}'s plan: gifts and inheritance from it show up in this forecast.`
                    : "Not linked to anyone's plan."}
                </span>
              </span>
              <button
                className="shrink-0 font-medium text-accent hover:underline"
                onClick={() => void switchHousehold(null)}
              >
                Back to {main.name}
              </button>
            </div>
          )}
          {loadError ? (
            <p className="text-sm text-red-600 dark:text-red-400">Couldn't open your data: {loadError}</p>
          ) : !household ? null : (
            <Page />
          )}
        </div>
      </main>
      <BackupDialogs />
    </div>
  );
}
