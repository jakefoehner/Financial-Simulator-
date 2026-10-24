import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, Card, EmptyState } from "../../components/Card";
import { TextField } from "../../components/fields";
import { api } from "../../lib/api";
import { EVENT_CHOICES, eventAge, eventSummary, newEvent } from "../../lib/events";
import { formatPercent, formatUsdCompact } from "../../lib/format";
import { useApp } from "../../lib/store";
import { ageOf, giftableInKind, type Event, type EventType, type Household, type Scenario } from "../../lib/types";
import { useTaxFacts } from "../../lib/useTaxFacts";
import { EventSheet } from "./EventSheet";

/** Edit one plan: its name, notes, and timeline of decisions. Saved all at once. */
export default function ScenarioEditor({
  household,
  scenario,
  onClose,
}: {
  household: Household;
  scenario: Scenario;
  onClose: (savedId?: number) => void;
}) {
  const mutate = useApp((s) => s.mutate);
  const facts = useTaxFacts();
  const [draft, setDraft] = useState<Scenario>(structuredClone(scenario));
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null; event: Event } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const kids = household.people.filter((p) => p.role === "child");
  const giftAccounts = household.accounts.filter((a) => giftableInKind(a.accountType));
  const accountName = (id: number) => household.accounts.find((a) => a.id === id)?.name ?? "an account";
  const primary = household.people.find((p) => p.role === "primary");
  const nextAge = primary ? ageOf(primary) + 1 : 60;
  const nameOf = (id: number) => household.people.find((p) => p.id === id)?.name ?? "someone removed";
  const ordered = draft.events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => eventAge(a.event) - eventAge(b.event));

  const start = (type: EventType) => {
    if (!facts) return;
    setChoosing(false);
    setEditing({
      index: null,
      event: newEvent(type, {
        firstChild: kids[0]?.id ?? null,
        firstGiftAccount: giftAccounts[0]?.id ?? null,
        age: nextAge,
        facts,
      }),
    });
  };

  const commit = (e: Event) => {
    setDraft((d) => {
      const events = [...d.events];
      if (editing?.index == null) events.push(e);
      else events[editing.index] = e;
      return { ...d, events };
    });
    setEditing(null);
  };

  const remove = (index: number) => {
    setDraft((d) => ({ ...d, events: d.events.filter((_, i) => i !== index) }));
    setEditing(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const before = new Set(household.scenarios.map((s) => s.id));
      await mutate(() => api.saveScenario({ ...draft, name: draft.name.trim() || "Untitled plan" }));
      const after = useApp.getState().household!.scenarios;
      const saved = draft.id ?? after.find((s) => !before.has(s.id))?.id ?? undefined;
      onClose(saved ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const needsKids = kids.length === 0;

  return (
    <div className="grid gap-5">
      <Card>
        <div className="grid gap-4">
          <TextField
            label="Plan name"
            value={draft.name}
            onChange={(name) => setDraft((d) => ({ ...d, name }))}
            placeholder="e.g. Help Sam with a down payment"
            autoFocus={scenario.id == null}
          />
          <TextField
            label="Notes (optional)"
            value={draft.notes}
            onChange={(notes) => setDraft((d) => ({ ...d, notes }))}
            placeholder="What you're trying to figure out"
          />
        </div>
      </Card>

      <Card
        title="Decisions, in order"
        actions={
          <Button variant="primary" onClick={() => setChoosing((c) => !c)} disabled={!facts}>
            <Plus size={16} /> Add a decision
          </Button>
        }
      >
        {needsKids && (
          <p className="mb-3 text-sm text-[var(--muted)]">
            Gifts, home help, and loans need your children listed on the People page.
          </p>
        )}
        {choosing && (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {EVENT_CHOICES.map((c) => {
              const disabled =
                (needsKids && ["home_help", "cash_gift", "family_loan", "gift_assets"].includes(c.type)) ||
                (c.type === "gift_assets" && giftAccounts.length === 0);
              return (
                <button
                  key={c.type}
                  onClick={() => start(c.type)}
                  disabled={disabled}
                  className="rounded-lg border border-[var(--border)] p-3 text-left transition hover:border-accent disabled:opacity-40"
                >
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{c.blurb}</p>
                </button>
              );
            })}
          </div>
        )}
        {ordered.length === 0 ? (
          <EmptyState
            title="No decisions yet"
            body="Add what you're considering: helping with a down payment, yearly gifts, a family loan, and more. Everything else stays as you entered it."
          />
        ) : (
          <ol className="grid gap-2">
            {ordered.map(({ event, index }) => (
              <li key={index}>
                <button
                  onClick={() => setEditing({ index, event })}
                  className="w-full rounded-lg border border-[var(--border)] px-4 py-3 text-left text-sm transition hover:border-accent"
                >
                  {eventSummary(event, nameOf, formatUsdCompact, formatPercent, accountName)}
                </button>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {error && <p className="text-sm text-[var(--critical)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => onClose()}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save plan"}
        </Button>
      </div>

      {editing && facts && (
        <EventSheet
          initial={editing.event}
          isNew={editing.index == null}
          kids={kids}
          giftAccounts={giftAccounts}
          facts={facts}
          onDone={commit}
          onRemove={editing.index != null ? () => remove(editing.index!) : undefined}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
