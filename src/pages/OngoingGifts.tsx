import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, Card } from "../components/Card";
import { api } from "../lib/api";
import { eventAge, eventSummary, eventTitle, newEvent } from "../lib/events";
import { formatPercent, formatUsdCompact } from "../lib/format";
import { useApp } from "../lib/store";
import { ageOf, giftableInKind, type Event, type EventType } from "../lib/types";
import { useTaxFacts } from "../lib/useTaxFacts";
import { EventSheet } from "./scenarios/EventSheet";

/** The kinds of giving that can be ongoing (part of every plan). */
const ONGOING_TYPES: EventType[] = ["cash_gift", "give_mix", "pay_tuition_medical", "fund529", "charity_gift"];

/**
 * Gifts you already give (e.g. the yearly maximum to each child, $2,000 a month): part of
 * the base plan and of every scenario, counted as gifts rather than spending.
 */
export default function OngoingGifts() {
  const household = useApp((s) => s.household!);
  const mutate = useApp((s) => s.mutate);
  const facts = useTaxFacts();
  const [editing, setEditing] = useState<{ index: number | null; event: Event } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kids = household.people.filter((p) => p.role === "child");
  const primary = household.people.find((p) => p.role === "primary");
  const giftAccounts = household.accounts.filter((a) => giftableInKind(a.accountType));
  const nameOf = (id: number) => household.people.find((p) => p.id === id)?.name ?? "someone removed";
  const accountName = (id: number) => household.accounts.find((a) => a.id === id)?.name ?? "an account";
  const ongoing = household.ongoing ?? [];

  const save = async (events: Event[]) => {
    setError(null);
    try {
      await mutate(() => api.saveOngoing(events));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const start = (type: EventType) => {
    if (!facts) return;
    setChoosing(false);
    const age = primary ? ageOf(primary) : 60;
    let event = newEvent(type, {
      firstChild: kids[0]?.id ?? null,
      firstGiftAccount: giftAccounts[0]?.id ?? null,
      age,
      facts,
    });
    // Ongoing gifts start now and keep going.
    if (event.type === "cash_gift")
      event = { ...event, fromAge: age, years: Math.max(1, (primary?.lifeExpectancy ?? 100) - age) };
    setEditing({ index: null, event });
  };

  return (
    <Card
      title="Gifts you already give"
      actions={
        <Button onClick={() => setChoosing((c) => !c)} disabled={!facts || kids.length === 0}>
          <Plus size={14} /> Add a gift
        </Button>
      }
    >
      <p className="mb-3 text-sm text-[var(--muted)]">
        Regular gifts you make now, like the yearly maximum to each child or a monthly allowance. They're part of your
        base plan and every scenario, and counted as gifts (for the gift-tax limits and what each child receives).{" "}
        <strong className="font-medium text-[var(--text)]">Leave them out of your yearly spending above.</strong>
      </p>
      {kids.length === 0 && <p className="text-sm text-[var(--muted)]">Add your children on the People page first.</p>}
      {choosing && (
        <div className="mb-3 flex flex-wrap gap-2">
          {ONGOING_TYPES.map((t) => (
            <Button key={t} variant="ghost" onClick={() => start(t)}>
              {eventTitle(t)}
            </Button>
          ))}
        </div>
      )}
      {ongoing.length > 0 && (
        <ul className="grid gap-2">
          {ongoing
            .map((event, index) => ({ event, index }))
            .sort((a, b) => eventAge(a.event) - eventAge(b.event))
            .map(({ event, index }) => (
              <li key={index}>
                <button
                  onClick={() => setEditing({ index, event })}
                  className="w-full rounded-lg border border-[var(--border)] px-4 py-2.5 text-left text-sm transition hover:border-accent"
                >
                  {eventSummary(event, nameOf, formatUsdCompact, formatPercent, accountName)}
                </button>
              </li>
            ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-[var(--critical)]">{error}</p>}
      {editing && facts && (
        <EventSheet
          initial={editing.event}
          isNew={editing.index == null}
          kids={kids}
          giftAccounts={giftAccounts}
          facts={facts}
          onDone={(e) =>
            void save(editing.index == null ? [...ongoing, e] : ongoing.map((x, i) => (i === editing.index ? e : x)))
          }
          onRemove={editing.index != null ? () => void save(ongoing.filter((_, i) => i !== editing.index)) : undefined}
          onCancel={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
