import { ChartLine, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, PageHeader } from "../../components/Card";
import { Highlight, SearchBox } from "../../components/SearchBox";
import { ConfirmDialog } from "../../components/Sheet";
import { api } from "../../lib/api";
import { eventAge, eventSummary } from "../../lib/events";
import { formatPercent, formatUsdCompact } from "../../lib/format";
import { matches } from "../../lib/search";
import { useApp } from "../../lib/store";
import { currentYear, type Id, type Scenario } from "../../lib/types";
import Compare, { planName } from "./Compare";
import { Segmented } from "../forecast/shared";
import SafeGiftCard from "./SafeGiftCard";
import ScenarioEditor from "./ScenarioEditor";

const MAX_COMPARE = 3;

type Sort = "newest" | "az" | "kids";
type Layout = "cards" | "list";

export default function Scenarios() {
  const household = useApp((s) => s.household!);
  const { go, setPlan, mutate } = useApp();
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Scenario | null>(null);
  const [compare, setCompare] = useState<(Id | null)[]>([null]);
  const [error, setError] = useState<string | null>(null);
  const query = useApp((s) => s.searches.scenarios ?? "");
  const setSearch = useApp((s) => s.setSearch);
  const [sort, setSort] = useState<Sort>("newest");
  const [layout, setLayout] = useState<Layout>("cards");
  // What the kids receive under each plan (steady path), loaded only when sorting by it.
  const [kidsTotal, setKidsTotal] = useState<Record<string, number> | null>(null);
  useEffect(() => setKidsTotal(null), [household]);
  useEffect(() => {
    if (sort !== "kids" || kidsTotal) return;
    let cancelled = false;
    Promise.all(
      household.scenarios.map(async (sc) => {
        const p = await api.runProjection(currentYear(), sc.id);
        return [String(sc.id), p.summary.estate.familyTotalReal] as const;
      }),
    )
      .then((pairs) => !cancelled && setKidsTotal(Object.fromEntries(pairs)))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [sort, kidsTotal, household]);

  const nameOf = (id: number) => household.people.find((p) => p.id === id)?.name ?? "someone removed";
  const accountName = (id: number) => household.accounts.find((a) => a.id === id)?.name ?? "an account";

  if (editing) {
    return (
      <>
        <PageHeader
          title={editing.id == null ? "New plan" : `Edit plan: ${editing.name}`}
          subtitle="Everything you've entered stays the same; these decisions are layered on top. Ages are yours."
        />
        <ScenarioEditor
          household={household}
          scenario={editing}
          onClose={(savedId) => {
            setEditing(null);
            if (savedId != null)
              setCompare((c) => (c.includes(savedId) || c.length >= MAX_COMPARE ? c : [...c, savedId]));
          }}
        />
      </>
    );
  }

  const toggleCompare = (id: Id | null) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? c : [...c, id]));

  const view = (id: Id | null) => {
    setPlan(id);
    go("results");
  };

  const linesOf = (sc: Scenario) =>
    [...sc.events]
      .sort((a, b) => eventAge(a) - eventAge(b))
      .map((e) => eventSummary(e, nameOf, formatUsdCompact, formatPercent, accountName));
  // Plain calculation (not a hook): this runs after the editor's early return above.
  const shown = (() => {
    const found = household.scenarios.filter((sc) => matches(query, [sc.name, sc.notes, ...linesOf(sc)]));
    const by: Record<Sort, (a: Scenario, b: Scenario) => number> = {
      newest: (a, b) => (b.id ?? 0) - (a.id ?? 0),
      az: (a, b) => a.name.localeCompare(b.name),
      kids: (a, b) => (kidsTotal?.[String(b.id)] ?? 0) - (kidsTotal?.[String(a.id)] ?? 0),
    };
    return found.sort(by[sort]);
  })();
  const total = household.scenarios.length;

  return (
    <>
      <PageHeader
        title="Scenarios"
        subtitle="Try decisions before you make them: help a child buy a home, give gifts, lend money, and see how each plan changes your own security and what your kids end up with."
        actions={
          <Button variant="primary" onClick={() => setEditing({ id: null, name: "", notes: "", events: [] })}>
            <Plus size={16} /> New plan
          </Button>
        }
      />
      {error && <p className="mb-4 text-sm text-[var(--critical)]">{error}</p>}

      <div className="grid gap-5">
        <SafeGiftCard household={household} />

        {total > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-56 flex-1">
              <SearchBox scope="scenarios" placeholder="Search plans: a name, a child, “529”, “loan”, “$2M”…" />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]"
              >
                <option value="newest">Newest first</option>
                <option value="az">A–Z</option>
                <option value="kids">Most for the kids</option>
              </select>
            </label>
            <Segmented<Layout>
              value={layout}
              onChange={setLayout}
              options={[
                { id: "cards", label: "Cards" },
                { id: "list", label: "List" },
              ]}
            />
          </div>
        )}
        {query && (
          <p className="-mt-2 px-1 text-xs text-[var(--muted)]">
            {shown.length === 0 ? `No plans mention “${query}”. ` : `${shown.length} of ${total} plans. `}
            <button className="font-medium text-accent hover:underline" onClick={() => setSearch("scenarios", "")}>
              Clear
            </button>
          </p>
        )}
        {sort === "kids" && !kidsTotal && total > 0 && (
          <p className="-mt-2 px-1 text-xs text-[var(--muted)]">Working out what each plan leaves the kids…</p>
        )}

        {layout === "cards" ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <PlanCard
              title="Base plan"
              subtitle="Everything as you entered it, with no extra decisions."
              lines={[]}
              query=""
              comparing={compare.includes(null)}
              onCompare={() => toggleCompare(null)}
              onView={() => view(null)}
              compareFull={compare.length >= MAX_COMPARE}
            />
            {shown.map((sc) => (
              <PlanCard
                key={sc.id}
                title={sc.name}
                subtitle={sc.notes}
                lines={linesOf(sc)}
                query={query}
                note={sort === "kids" && kidsTotal ? kidsNote(kidsTotal[String(sc.id)]) : undefined}
                comparing={compare.includes(sc.id)}
                onCompare={() => toggleCompare(sc.id)}
                onView={() => view(sc.id)}
                onEdit={() => setEditing(sc)}
                onDelete={() => setConfirmDelete(sc)}
                compareFull={compare.length >= MAX_COMPARE}
              />
            ))}
          </div>
        ) : (
          <Card>
            <ul className="divide-y divide-[var(--border)]">
              {[null, ...shown].map((sc) => (
                <PlanRow
                  key={String(sc?.id ?? "base")}
                  title={sc ? sc.name : "Base plan"}
                  detail={
                    sc
                      ? `${sc.events.length} decision${sc.events.length === 1 ? "" : "s"}` +
                        (sort === "kids" && kidsTotal ? ` · ${kidsNote(kidsTotal[String(sc.id)])}` : "")
                      : "No extra decisions"
                  }
                  query={sc ? query : ""}
                  comparing={compare.includes(sc?.id ?? null)}
                  compareFull={compare.length >= MAX_COMPARE}
                  onCompare={() => toggleCompare(sc?.id ?? null)}
                  onView={() => view(sc?.id ?? null)}
                  onEdit={sc ? () => setEditing(sc) : undefined}
                />
              ))}
            </ul>
          </Card>
        )}

        {compare.length >= 2 && (
          <div className="sticky bottom-4 z-30 flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm shadow-lg">
            <span className="min-w-0 truncate">
              <span className="text-[var(--muted)]">Comparing </span>
              {compare.map((id) => planName(household, id)).join(" vs ")}
            </span>
            <Button
              variant="primary"
              className="shrink-0"
              onClick={() => document.getElementById("compare")?.scrollIntoView({ behavior: "smooth" })}
            >
              Show comparison ↓
            </Button>
          </div>
        )}

        <section id="compare" className="scroll-mt-6">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h2 className="text-sm font-semibold">Compare plans</h2>
            <span className="text-xs text-[var(--muted)]">
              {compare.length < 2
                ? "Check two or three plans above to compare them."
                : compare.map((id) => planName(household, id)).join(" vs ")}
            </span>
          </div>
          {compare.length >= 2 && <Compare household={household} plans={compare} startYear={currentYear()} />}
        </section>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.name}"?`}
          body="The plan and its decisions will be removed. Your accounts and other data aren't affected."
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            const id = confirmDelete.id!;
            setConfirmDelete(null);
            setCompare((c) => c.filter((x) => x !== id));
            try {
              await mutate(() => api.deleteScenario(id));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}

function kidsNote(total: number | undefined): string {
  return total == null ? "" : `kids receive about ${formatUsdCompact(total)}`;
}

/** One line per plan, for when there are many. */
function PlanRow({
  title,
  detail,
  query,
  comparing,
  compareFull,
  onCompare,
  onView,
  onEdit,
}: {
  title: string;
  detail: string;
  query: string;
  comparing: boolean;
  compareFull: boolean;
  onCompare: () => void;
  onView: () => void;
  onEdit?: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <input
        type="checkbox"
        aria-label={`Compare ${title}`}
        checked={comparing}
        disabled={!comparing && compareFull}
        onChange={onCompare}
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">
          <Highlight text={title} query={query} />
        </span>
        <span className="ml-2 text-xs text-[var(--muted)]">{detail}</span>
      </span>
      <Button variant="ghost" onClick={onView}>
        <ChartLine size={14} /> Forecast
      </Button>
      {onEdit && (
        <Button variant="ghost" onClick={onEdit}>
          <Pencil size={14} /> Edit
        </Button>
      )}
    </li>
  );
}

function PlanCard({
  title,
  subtitle,
  lines,
  query,
  note,
  comparing,
  compareFull,
  onCompare,
  onView,
  onEdit,
  onDelete,
}: {
  title: string;
  subtitle: string;
  lines: string[];
  query: string;
  note?: string;
  comparing: boolean;
  compareFull: boolean;
  onCompare: () => void;
  onView: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            <Highlight text={title} query={query} />
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              <Highlight text={subtitle} query={query} />
            </p>
          )}
          {note && <p className="mt-1 text-xs font-medium text-accent">{note}</p>}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={comparing} disabled={!comparing && compareFull} onChange={onCompare} />
          Compare
        </label>
      </div>
      {lines.length > 0 && (
        <ul className="mt-3 grid gap-1 text-sm">
          {lines.map((l, i) => (
            <li key={i}>
              <Highlight text={l} query={query} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex gap-1">
        <Button variant="ghost" onClick={onView}>
          <ChartLine size={14} /> See forecast
        </Button>
        {onEdit && (
          <Button variant="ghost" onClick={onEdit}>
            <Pencil size={14} /> Edit
          </Button>
        )}
        {onDelete && (
          <Button variant="danger" onClick={onDelete} className="ml-auto">
            <Trash2 size={14} /> Delete
          </Button>
        )}
      </div>
    </Card>
  );
}
