import { useState } from "react";
import { Button, Card, PageHeader } from "../components/Card";
import { Highlight, SearchBox } from "../components/SearchBox";
import { api } from "../lib/api";
import { matches } from "../lib/search";
import { useApp } from "../lib/store";
import { STRATEGY_TAGS, strategies, type Strategy, type StrategyTag } from "../lib/strategies";
import { useTaxFacts } from "../lib/useTaxFacts";

/** "Ways to pass money down": each strategy in plain English, with a way to try it. */
export default function Guide() {
  const household = useApp((s) => s.household!);
  const { mutate, go } = useApp();
  const query = useApp((s) => s.searches.guide ?? "");
  const setSearch = useApp((s) => s.setSearch);
  const facts = useTaxFacts();
  const [error, setError] = useState<string | null>(null);
  const [tag, setTag] = useState<StrategyTag | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
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
  const shown = all.filter(
    (s) =>
      (tag == null || s.tags.includes(tag)) &&
      matches(query, [s.title, s.summary, s.how, s.inApp, ...s.pros, ...s.cons]),
  );
  // While searching, open the cards so the matches are visible.
  const isOpen = (s: Strategy) => query.trim() !== "" || open.has(s.id);
  const allOpen = shown.every(isOpen);
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader
        title="Ways to pass money down"
        subtitle="The main options in plain English, what each one does in this app, and a one-click way to try it as a plan. A planning guide, not legal or tax advice: confirm big decisions with an estate attorney or CPA."
      />
      {error && <p className="mb-4 text-sm text-[var(--critical)]">{error}</p>}

      <div className="mb-4 grid gap-3">
        <SearchBox scope="guide" placeholder="Search the guide: “basis”, “college”, “trust”, “estate tax”…" />
        <div className="flex flex-wrap items-center gap-2">
          {[{ id: null, label: "All" } as const, ...STRATEGY_TAGS].map((t) => (
            <button
              key={String(t.id)}
              onClick={() => setTag(t.id)}
              aria-pressed={tag === t.id}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                tag === t.id ? "border-accent bg-accent text-white" : "border-[var(--border)] hover:border-accent"
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            className="ml-auto text-xs font-medium text-accent hover:underline"
            onClick={() => setOpen(allOpen ? new Set() : new Set(all.map((s) => s.id)))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
        {shown.length > 1 && (
          <nav aria-label="On this page" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
            <span>On this page:</span>
            {shown.map((s) => (
              <button
                key={s.id}
                className="text-accent hover:underline"
                onClick={() => document.getElementById(`strategy-${s.id}`)?.scrollIntoView({ behavior: "smooth" })}
              >
                {s.title}
              </button>
            ))}
          </nav>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Nothing in the guide matches{query ? ` “${query}”` : ""}
          {tag ? ` under ${STRATEGY_TAGS.find((t) => t.id === tag)?.label}` : ""}.{" "}
          <button
            className="font-medium text-accent hover:underline"
            onClick={() => {
              setSearch("guide", "");
              setTag(null);
            }}
          >
            Show everything
          </button>
        </p>
      ) : (
        <div className="grid gap-4">
          {shown.map((s) => (
            <div key={s.id} id={`strategy-${s.id}`} className="scroll-mt-6">
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold">
                      <Highlight text={s.title} query={query} />
                    </h2>
                    <p className="mt-0.5 text-sm">
                      <Highlight text={s.summary} query={query} />
                    </p>
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
                {isOpen(s) ? (
                  <>
                    <p className="mt-3 text-sm text-[var(--muted)]">
                      <Highlight text={s.how} query={query} />
                    </p>
                    <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
                      <List title="Good" items={s.pros} query={query} />
                      <List title="Watch out" items={s.cons} query={query} />
                    </div>
                    <p className="mt-3 text-xs text-[var(--muted)]">
                      <span className="font-medium text-[var(--text)]">In this app:</span>{" "}
                      <Highlight text={s.inApp} query={query} />
                    </p>
                    {!query && (
                      <button
                        className="mt-2 text-xs font-medium text-accent hover:underline"
                        onClick={() => toggle(s.id)}
                      >
                        Less
                      </button>
                    )}
                  </>
                ) : (
                  <button className="mt-2 text-xs font-medium text-accent hover:underline" onClick={() => toggle(s.id)}>
                    More: how it works, pros and cons
                  </button>
                )}
              </Card>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function List({ title, items, query }: { title: string; items: string[]; query: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[var(--muted)]">{title}</p>
      <ul className="grid list-disc gap-0.5 pl-4">
        {items.map((i) => (
          <li key={i}>
            <Highlight text={i} query={query} />
          </li>
        ))}
      </ul>
    </div>
  );
}
