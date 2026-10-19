import { useState } from "react";
import Overview from "./pages/Overview";
import Placeholder from "./pages/Placeholder";
import Settings from "./pages/Settings";

type Section =
  "overview" | "people" | "accounts" | "income" | "debts" | "spending" | "scenarios" | "results" | "settings";

const NAV: { id: Section; label: string; phase?: number }[] = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "People", phase: 1 },
  { id: "accounts", label: "Accounts", phase: 1 },
  { id: "income", label: "Income", phase: 1 },
  { id: "debts", label: "Debts", phase: 1 },
  { id: "spending", label: "Spending", phase: 1 },
  { id: "scenarios", label: "Scenarios", phase: 4 },
  { id: "results", label: "Results", phase: 2 },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [section, setSection] = useState<Section>("overview");
  const current = NAV.find((n) => n.id === section)!;

  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-[var(--border)] bg-[var(--sidebar)] px-2 pt-6">
        <div className="mb-4 px-3 text-sm font-semibold tracking-tight">Finance Simulator</div>
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setSection(n.id)}
            className={`rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
              n.id === section ? "bg-accent text-white" : "hover:bg-black/5 dark:hover:bg-white/10"
            }`}
          >
            {n.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto px-10 py-8">
        {section === "overview" && <Overview />}
        {section === "settings" && <Settings />}
        {current.phase !== undefined && <Placeholder title={current.label} phase={current.phase} />}
      </main>
    </div>
  );
}
