import {
  BookOpen,
  ChartLine,
  CreditCard,
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
import Accounts from "./pages/Accounts";
import Debts from "./pages/Debts";
import Guide from "./pages/Guide";
import Income from "./pages/Income";
import Overview from "./pages/Overview";
import People from "./pages/People";
import Settings from "./pages/Settings";
import Results from "./pages/Results";
import Scenarios from "./pages/scenarios/Scenarios";
import Spending from "./pages/Spending";
import { useApp, type Section } from "./lib/store";

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
  [{ id: "settings", label: "Settings", icon: SettingsIcon }],
];

const PAGES: Record<Section, () => React.JSX.Element | null> = {
  overview: Overview,
  people: People,
  accounts: Accounts,
  income: Income,
  debts: Debts,
  spending: Spending,
  results: Results,
  scenarios: Scenarios,
  guide: Guide,
  settings: Settings,
};

export default function App() {
  const { section, go, household, loadError, load } = useApp();

  useEffect(() => {
    void load();
  }, [load]);

  const Page = PAGES[section];

  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] px-2 pt-6">
        <div className="mb-4 px-3 text-sm font-semibold tracking-tight">Finance Simulator</div>
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
          {loadError ? (
            <p className="text-sm text-red-600 dark:text-red-400">Couldn't open your data: {loadError}</p>
          ) : !household ? null : (
            <Page />
          )}
        </div>
      </main>
    </div>
  );
}
