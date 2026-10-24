import { useState } from "react";
import { Button, Card, PageHeader } from "../components/Card";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { strategies, type Strategy } from "../lib/strategies";
import { useTaxFacts } from "../lib/useTaxFacts";

/** "Ways to pass money down": each strategy in plain English, with a way to try it. */
export default function Guide() {
  const household = useApp((s) => s.household!);
  const { mutate, go } = useApp();
  const facts = useTaxFacts();
  const [error, setError] = useState<string | null>(null);
  if (!facts) return null;

  const tryIt = async (s: Strategy) => {
    const plan = s.tryIt?.(household, facts);
    if (!plan) {
      setError("Add your children (and a brokerage account for stock gifts) first.");
      return;
    }
    setError(null);
    try {
      await mutate(() => api.saveScenario({ id: null, ...plan }));
      go("scenarios");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const all = strategies(facts);
  return (
    <>
      <PageHeader
        title="Ways to pass money down"
        subtitle="The main options in plain English, what each one does in this app, and a one-click way to try it as a plan. A planning guide, not legal or tax advice: confirm big decisions with an estate attorney or CPA."
      />
      {error && <p className="mb-4 text-sm text-[var(--critical)]">{error}</p>}
      <div className="grid gap-4">
        {all.map((s) => (
          <Card key={s.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">{s.title}</h2>
                <p className="mt-0.5 text-sm">{s.summary}</p>
              </div>
              {s.status === "coming" ? (
                <span className="shrink-0 rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
                  Coming in {s.coming}
                </span>
              ) : (
                s.tryIt && (
                  <Button variant="primary" className="shrink-0" onClick={() => tryIt(s)}>
                    Try this in a plan
                  </Button>
                )
              )}
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]">{s.how}</p>
            <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
              <List title="Good" items={s.pros} />
              <List title="Watch out" items={s.cons} />
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              <span className="font-medium text-[var(--text)]">In this app:</span> {s.inApp}
            </p>
          </Card>
        ))}
      </div>
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[var(--muted)]">{title}</p>
      <ul className="grid list-disc gap-0.5 pl-4">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
