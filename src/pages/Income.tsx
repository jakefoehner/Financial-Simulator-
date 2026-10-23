import { Plus } from "lucide-react";
import { Button, Card, EmptyState, PageHeader, RecordList } from "../components/Card";
import { MoneyField, NumberField, PercentField, Row, SelectField, TextField, Toggle } from "../components/fields";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/format";
import { useApp } from "../lib/store";
import { ageOf, INCOME_KIND_LABELS, type Id, type IncomeKind, type IncomeStream, type Person } from "../lib/types";
import { useEditor } from "../lib/useEditor";

const CLAIM_AGES = [62, 63, 64, 65, 66, 67, 68, 69, 70];

function newIncome(personId: Id | null): IncomeStream {
  return {
    id: null,
    personId,
    kind: "w2",
    name: "",
    annualAmount: 0,
    growthRate: 0.03,
    startAge: null,
    endAge: null,
  };
}

export function whenLabel(i: Pick<IncomeStream, "startAge" | "endAge">): string {
  if (i.startAge == null && i.endAge == null) return "For life";
  if (i.startAge == null) return `Now until ${i.endAge}`;
  if (i.endAge == null) return `From ${i.startAge}`;
  return `${i.startAge} to ${i.endAge}`;
}

function ssLabel(p: Person): string {
  if (p.ssMonthlyBenefit == null) return "Not entered";
  if (p.ssAlreadyClaiming) return `Receiving ${formatUsd(p.ssMonthlyBenefit)}/mo`;
  return `${formatUsd(p.ssMonthlyBenefit)}/mo at full retirement age · claiming at ${p.ssClaimAge}`;
}

export default function Income() {
  const { income, people } = useApp((s) => s.household!);
  const ed = useEditor<IncomeStream>({ save: api.upsertIncome, remove: api.deleteIncome });
  const ss = useEditor<Person>({ save: api.upsertPerson, remove: api.deletePerson });
  const primaryId = people.find((p) => p.role === "primary")?.id ?? null;
  const ssPeople = people.filter((p) => p.role === "primary" || p.role === "spouse");
  const personName = (id: Id | null) => people.find((p) => p.id === id)?.name ?? "Household";

  return (
    <>
      <PageHeader
        title="Income"
        subtitle="Money coming in: paychecks, rental income, pensions, and Social Security. Investment growth and dividends come from your accounts, so don't add them here."
        actions={
          <Button variant="primary" onClick={() => ed.open(newIncome(primaryId))}>
            <Plus size={16} /> Add income
          </Button>
        }
      />

      <div className="grid gap-6">
        <Card title="Social Security">
          {ssPeople.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Add yourself on the People page first.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {ssPeople.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-3 text-[var(--muted)]">{ssLabel(p)}</span>
                  </span>
                  <Button variant="ghost" onClick={() => ss.open(p)}>
                    {p.ssMonthlyBenefit == null ? "Add" : "Edit"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {income.length === 0 ? (
          <EmptyState
            title="No other income yet"
            body="Retired and living off savings and Social Security? You can skip this."
            action={
              <Button onClick={() => ed.open(newIncome(primaryId))}>
                <Plus size={16} /> Add income
              </Button>
            }
          />
        ) : (
          <RecordList
            items={income}
            rowKey={(i) => i.id!}
            onSelect={ed.open}
            columns={[
              { header: "Name", cell: (i) => <span className="font-medium">{i.name}</span> },
              { header: "Type", cell: (i) => INCOME_KIND_LABELS[i.kind] },
              { header: "Whose", cell: (i) => personName(i.personId) },
              { header: "Ages", cell: whenLabel },
              { header: "Grows", align: "right", cell: (i) => formatPercent(i.growthRate) },
              { header: "Per year", align: "right", cell: (i) => formatUsd(i.annualAmount) },
            ]}
          />
        )}
      </div>

      {ed.draft && (
        <Sheet
          title={ed.isNew ? "Add income" : `Edit ${ed.draft.name || "income"}`}
          error={ed.error}
          saving={ed.saving}
          onSave={ed.save}
          onCancel={ed.close}
          onDelete={ed.isNew ? undefined : ed.remove}
        >
          <Row>
            <SelectField<IncomeKind>
              label="Type"
              value={ed.draft.kind}
              onChange={(k) =>
                ed.patch({
                  kind: k,
                  name:
                    ed.draft!.name === "" || ed.draft!.name === INCOME_KIND_LABELS[ed.draft!.kind]
                      ? INCOME_KIND_LABELS[k]
                      : ed.draft!.name,
                })
              }
              options={(Object.keys(INCOME_KIND_LABELS) as IncomeKind[]).map((k) => ({
                value: k,
                label: INCOME_KIND_LABELS[k],
              }))}
            />
            <SelectField<number>
              label="Whose"
              value={ed.draft.personId ?? 0}
              onChange={(v) => ed.set("personId", v === 0 ? null : v)}
              options={[...people.map((p) => ({ value: p.id!, label: p.name })), { value: 0, label: "Household" }]}
            />
          </Row>
          <TextField label="Name" value={ed.draft.name} onChange={(v) => ed.set("name", v)} />
          <Row>
            <MoneyField
              label="Per year (before tax)"
              value={ed.draft.annualAmount}
              onChange={(v) => ed.set("annualAmount", v ?? 0)}
            />
            <PercentField
              label="Grows each year"
              hint="Raises are often 3–4%. A pension without cost-of-living increases is 0%."
              value={ed.draft.growthRate}
              onChange={(v) => ed.set("growthRate", v)}
            />
          </Row>
          <Row>
            <NumberField
              label="Starts at age"
              hint="Leave blank if it has already started."
              optional
              placeholder="Already started"
              value={ed.draft.startAge}
              onChange={(v) => ed.set("startAge", v)}
            />
            <NumberField
              label="Stops at age"
              hint="Leave blank if it lasts for life."
              optional
              placeholder="For life"
              value={ed.draft.endAge}
              onChange={(v) => ed.set("endAge", v)}
            />
          </Row>
        </Sheet>
      )}

      {ss.draft && (
        <Sheet
          title={`Social Security — ${ss.draft.name}`}
          error={ss.error}
          saving={ss.saving}
          onSave={ss.save}
          onCancel={ss.close}
        >
          <Toggle
            label="Already receiving Social Security"
            checked={ss.draft.ssAlreadyClaiming}
            onChange={(v) => ss.set("ssAlreadyClaiming", v)}
          />
          {ss.draft.ssAlreadyClaiming ? (
            <MoneyField
              label="Current monthly check"
              hint="Before Medicare premiums are taken out."
              value={ss.draft.ssMonthlyBenefit}
              optional
              onChange={(v) => ss.set("ssMonthlyBenefit", v)}
            />
          ) : (
            <>
              <MoneyField
                label="Estimated monthly benefit at full retirement age"
                hint="Find it at ssa.gov/myaccount. Leave blank if you won't receive Social Security."
                value={ss.draft.ssMonthlyBenefit}
                optional
                placeholder="None"
                onChange={(v) => ss.set("ssMonthlyBenefit", v)}
              />
              <SelectField<number>
                label="Plan to start at age"
                hint="Starting at 62 means smaller checks for life; waiting until 70 means bigger ones. Results will compare ages."
                value={ss.draft.ssClaimAge}
                onChange={(v) => ss.set("ssClaimAge", v)}
                options={CLAIM_AGES.filter((a) => a >= Math.min(70, ageOf(ss.draft!))).map((a) => ({
                  value: a,
                  label: a === 67 ? "67 (full retirement age)" : String(a),
                }))}
              />
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
