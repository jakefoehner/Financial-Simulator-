import { Plus } from "lucide-react";
import { Button, EmptyState, PageHeader, RecordList } from "../components/Card";
import { NumberField, Row, SelectField, TextField } from "../components/fields";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { ageOf, currentYear, ROLE_LABELS, type Person, type Role } from "../lib/types";
import { useEditor } from "../lib/useEditor";
import { useState } from "react";

function newPerson(hasPrimary: boolean): Person {
  return {
    id: null,
    name: "",
    birthYear: currentYear() - (hasPrimary ? 30 : 60),
    role: hasPrimary ? "child" : "primary",
    lifeExpectancy: 100,
    ssMonthlyBenefit: null,
    ssClaimAge: 67,
    ssAlreadyClaiming: false,
  };
}

export default function People() {
  const people = useApp((s) => s.household!.people);
  const family = useApp((s) => s.family);
  const mutate = useApp((s) => s.mutate);
  const switchHousehold = useApp((s) => s.switchHousehold);
  const go = useApp((s) => s.go);
  const ed = useEditor<Person>({ save: api.upsertPerson, remove: api.deletePerson });
  const hasPrimary = people.some((p) => p.role === "primary");
  const [error, setError] = useState<string | null>(null);
  // Children's households are built from your own household only.
  const viewingOwn = family?.households[0]?.active ?? true;
  const householdOf = (p: Person) => family?.children.find((c) => c.personId === p.id);

  const openChild = async (p: Person) => {
    setError(null);
    try {
      const existing = householdOf(p)?.householdId;
      if (existing != null) await switchHousehold(existing);
      else await mutate(() => api.buildChildHousehold(p.id!));
      go("overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageHeader
        title="People"
        subtitle={
          viewingOwn
            ? "You, and anyone whose money or future matters to the plan. Add your children too: gifts and inheritance are planned around them, and each can have a full household of their own."
            : "This household's people: the main person, and a spouse or children if they have them."
        }
        actions={
          <Button variant="primary" onClick={() => ed.open(newPerson(hasPrimary))}>
            <Plus size={16} /> Add person
          </Button>
        }
      />

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {viewingOwn && people.some((p) => p.role === "child") && (
        <p className="mb-3 text-sm text-[var(--muted)]">
          Build a child's household to enter their own accounts, income, debts and plans. It's linked to yours, so the
          gifts and inheritance in your plans show up in their forecast.
        </p>
      )}
      {people.length === 0 ? (
        <EmptyState
          title="Start with yourself"
          body="Your age drives everything else: retirement accounts, Social Security, and how long the plan runs."
          action={
            <Button variant="primary" onClick={() => ed.open(newPerson(false))}>
              Add yourself
            </Button>
          }
        />
      ) : (
        <RecordList
          items={people}
          rowKey={(p) => p.id!}
          onSelect={ed.open}
          columns={[
            { header: "Name", cell: (p) => <span className="font-medium">{p.name}</span> },
            { header: "Relationship", cell: (p) => ROLE_LABELS[p.role] },
            { header: "Age", align: "right", cell: (p) => ageOf(p) },
            { header: "Plan runs to", align: "right", cell: (p) => `age ${p.lifeExpectancy}` },
            ...(viewingOwn && people.some((p) => p.role === "child")
              ? [
                  {
                    header: "Their own finances",
                    align: "right" as const,
                    cell: (p: Person) =>
                      p.role === "child" && p.id != null ? (
                        <button
                          className="font-medium text-accent hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openChild(p);
                          }}
                        >
                          {householdOf(p)?.householdId != null
                            ? `Open ${p.name}'s household →`
                            : `Build ${p.name}'s household →`}
                        </button>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      )}

      {ed.draft && (
        <Sheet
          title={ed.isNew ? "Add person" : `Edit ${ed.draft.name || "person"}`}
          error={ed.error}
          saving={ed.saving}
          onSave={ed.save}
          onCancel={ed.close}
          onDelete={ed.isNew ? undefined : ed.remove}
          deleteWarning="Their accounts become joint, and their income is removed."
        >
          <TextField label="Name" value={ed.draft.name} onChange={(v) => ed.set("name", v)} autoFocus />
          <Row>
            <SelectField<Role>
              label="Relationship"
              value={ed.draft.role}
              onChange={(v) => ed.set("role", v)}
              options={(Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            />
            <NumberField
              label="Birth year"
              hint={`Age ${ageOf(ed.draft)} this year`}
              value={ed.draft.birthYear}
              onChange={(v) => ed.set("birthYear", v ?? ed.draft!.birthYear)}
            />
          </Row>
          <NumberField
            label="Plan runs to age"
            hint="100 by default. Try 105 to see the “I live a very long time” picture."
            value={ed.draft.lifeExpectancy}
            onChange={(v) => ed.set("lifeExpectancy", v ?? 100)}
          />
          {(ed.draft.role === "primary" || ed.draft.role === "spouse") && (
            <p className="text-xs text-[var(--muted)]">Social Security is set on the Income page.</p>
          )}
        </Sheet>
      )}
    </>
  );
}
