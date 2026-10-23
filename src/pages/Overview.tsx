import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Card, PageHeader } from "../components/Card";
import { ConfirmDialog } from "../components/Sheet";
import { api, type DemoName } from "../lib/api";
import { formatUsd, formatUsdCompact } from "../lib/format";
import { useApp } from "../lib/store";
import { isEmpty, setupSteps, summarize } from "../lib/summary";

const DEMOS: { id: DemoName; title: string; body: string }[] = [
  {
    id: "retiree",
    title: "Retired in Texas",
    body: "Single, 58, about $16.5M across brokerage, IRAs, a home, and a rental. Two adult children and three example gifting plans.",
  },
  {
    id: "early_career",
    title: "Early career",
    body: "28, salaried, with a 401(k) match, Roth IRA, student and car loans, and a wedding coming up.",
  },
];

export default function Overview() {
  const household = useApp((s) => s.household!);
  const { go, mutate } = useApp();
  const [pendingDemo, setPendingDemo] = useState<DemoName | null>(null);
  const [error, setError] = useState<string | null>(null);

  const empty = isEmpty(household);
  const steps = setupSteps(household);
  const s = summarize(household);

  const loadDemo = async (which: DemoName) => {
    setPendingDemo(null);
    setError(null);
    try {
      await mutate(() => api.loadDemo(which));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageHeader
        title={empty ? "Welcome" : household.info.name}
        subtitle={
          empty
            ? "Let's build a picture of where you are today. It takes about ten minutes, and nothing leaves this Mac."
            : "Where things stand today. Forecasts and what-if scenarios come next."
        }
      />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid gap-5">
        {!empty && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Net worth" value={s.netWorth} emphasis />
            <Stat label="Savings & investments" value={s.investable} />
            <Stat label="Real estate" value={s.realEstate} />
            <Stat label="Debts" value={s.totalDebts} />
          </div>
        )}

        {!empty && (
          <Card title="This year">
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <Flow label="Income coming in" value={s.currentAnnualIncome} />
              <Flow label="Living expenses" value={s.annualSpending} />
              <Flow label="Debt payments" value={s.annualDebtPayments} />
            </dl>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Before taxes and investment growth. The forecast will add both.
            </p>
          </Card>
        )}

        {steps.some((st) => !st.done) && (
          <Card title={empty ? "Get started" : "Finish setting up"}>
            <ol className="divide-y divide-[var(--border)]">
              {steps.map((st, i) => (
                <li key={st.id}>
                  <button
                    onClick={() => go(st.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:text-accent"
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        st.done ? "bg-green-500 text-white" : "border border-[var(--border)] text-[var(--muted)]"
                      }`}
                    >
                      {st.done ? <Check size={14} /> : i + 1}
                    </span>
                    <span className={st.done ? "text-[var(--muted)] line-through" : ""}>{st.label}</span>
                    <ChevronRight size={16} className="ml-auto text-[var(--muted)]" />
                  </button>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <Card title={empty ? "Or explore a demo first" : "Demo households"}>
          <p className="mb-3 text-sm text-[var(--muted)]">
            Made-up households to look around with. {!empty && "Loading one replaces everything you've entered."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {DEMOS.map((d) => (
              <button
                key={d.id}
                onClick={() => (empty ? loadDemo(d.id) : setPendingDemo(d.id))}
                className="rounded-lg border border-[var(--border)] p-4 text-left transition hover:border-accent hover:bg-accent/5"
              >
                <p className="text-sm font-medium">{d.title}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{d.body}</p>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {pendingDemo && (
        <ConfirmDialog
          title="Replace your data with the demo?"
          body="Everything you've entered (people, accounts, income, debts, and spending) will be replaced. This can't be undone."
          confirmLabel="Replace"
          danger
          onConfirm={() => loadDemo(pendingDemo)}
          onCancel={() => setPendingDemo(null)}
        />
      )}
    </>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p
        className={`mt-1 font-semibold tracking-tight tabular-nums ${emphasis ? "text-2xl" : "text-xl"}`}
        title={formatUsd(value)}
      >
        {formatUsdCompact(value)}
      </p>
    </div>
  );
}

function Flow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5 text-base font-medium tabular-nums">{formatUsd(value)}</dd>
    </div>
  );
}
