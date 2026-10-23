import { Plus } from "lucide-react";
import { Button, EmptyState, PageHeader, RecordList } from "../components/Card";
import { NumberField, Row, SelectField, TextField } from "../components/fields";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { ageOf, currentYear, ROLE_LABELS, type Person, type Role } from "../lib/types";
import { useEditor } from "../lib/useEditor";

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
  const ed = useEditor<Person>({ save: api.upsertPerson, remove: api.deletePerson });
  const hasPrimary = people.some((p) => p.role === "primary");

  return (
    <>
      <PageHeader
        title="People"
        subtitle="You, and anyone whose money or future matters to the plan. Add children too: later, gifts and inheritance are planned around them."
        actions={
          <Button variant="primary" onClick={() => ed.open(newPerson(hasPrimary))}>
            <Plus size={16} /> Add person
          </Button>
        }
      />

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
