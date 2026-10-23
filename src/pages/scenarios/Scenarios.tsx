import { ChartLine, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Card, PageHeader } from "../../components/Card";
import { ConfirmDialog } from "../../components/Sheet";
import { api } from "../../lib/api";
import { eventAge, eventSummary } from "../../lib/events";
import { formatPercent, formatUsdCompact } from "../../lib/format";
import { useApp } from "../../lib/store";
import { currentYear, type Id, type Scenario } from "../../lib/types";
import Compare, { planName } from "./Compare";
import ScenarioEditor from "./ScenarioEditor";

const MAX_COMPARE = 3;

export default function Scenarios() {
  const household = useApp((s) => s.household!);
  const { go, setPlan, mutate } = useApp();
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Scenario | null>(null);
  const [compare, setCompare] = useState<(Id | null)[]>([null]);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: number) => household.people.find((p) => p.id === id)?.name ?? "someone removed";

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
        <div className="grid gap-3 lg:grid-cols-2">
          <PlanCard
            title="Base plan"
            subtitle="Everything as you entered it, with no extra decisions."
            lines={[]}
            comparing={compare.includes(null)}
            onCompare={() => toggleCompare(null)}
            onView={() => view(null)}
            compareFull={compare.length >= MAX_COMPARE}
          />
          {household.scenarios.map((sc) => (
            <PlanCard
              key={sc.id}
              title={sc.name}
              subtitle={sc.notes}
              lines={[...sc.events]
                .sort((a, b) => eventAge(a) - eventAge(b))
                .map((e) => eventSummary(e, nameOf, formatUsdCompact, formatPercent))}
              comparing={compare.includes(sc.id)}
              onCompare={() => toggleCompare(sc.id)}
              onView={() => view(sc.id)}
              onEdit={() => setEditing(sc)}
              onDelete={() => setConfirmDelete(sc)}
              compareFull={compare.length >= MAX_COMPARE}
            />
          ))}
        </div>

        <section>
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

function PlanCard({
  title,
  subtitle,
  lines,
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
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={comparing} disabled={!comparing && compareFull} onChange={onCompare} />
          Compare
        </label>
      </div>
      {lines.length > 0 && (
        <ul className="mt-3 grid gap-1 text-sm">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
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
