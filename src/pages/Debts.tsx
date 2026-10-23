import { Plus } from "lucide-react";
import { Button, EmptyState, PageHeader, RecordList } from "../components/Card";
import { MoneyField, PercentField, Row, SelectField, TextField } from "../components/fields";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/format";
import { useApp } from "../lib/store";
import { monthsToPayoff } from "../lib/summary";
import { ACCOUNT_TYPE_LABELS, DEBT_KIND_LABELS, type Debt, type DebtKind } from "../lib/types";
import { useEditor } from "../lib/useEditor";

function newDebt(): Debt {
  return {
    id: null,
    name: "",
    kind: "mortgage",
    balance: 0,
    interestRate: 0.06,
    monthlyPayment: 0,
    accountId: null,
    notes: "",
  };
}

export function payoffLabel(d: Pick<Debt, "balance" | "interestRate" | "monthlyPayment">): string {
  const m = monthsToPayoff(d.balance, d.interestRate, d.monthlyPayment);
  if (m == null) return "Never at this payment";
  if (m === 0) return "Paid off";
  const years = Math.floor(m / 12);
  const months = m % 12;
  if (years === 0) return `${months} mo`;
  return months === 0 ? `${years} yr` : `${years} yr ${months} mo`;
}

export default function Debts() {
  const { debts, accounts } = useApp((s) => s.household!);
  const ed = useEditor<Debt>({ save: api.upsertDebt, remove: api.deleteDebt });
  const total = debts.reduce((s, d) => s + d.balance, 0);
  const monthly = debts.reduce((s, d) => s + d.monthlyPayment, 0);

  return (
    <>
      <PageHeader
        title="Debts"
        subtitle="Mortgages, loans, and credit cards. The simulator pays these down every year from your income and savings."
        actions={
          <Button variant="primary" onClick={() => ed.open(newDebt())}>
            <Plus size={16} /> Add debt
          </Button>
        }
      />

      {debts.length === 0 ? (
        <EmptyState title="No debts" body="Nothing owed? Great — there's nothing to add here." />
      ) : (
        <div className="grid gap-3">
          <RecordList
            items={debts}
            rowKey={(d) => d.id!}
            onSelect={ed.open}
            columns={[
              { header: "Name", cell: (d) => <span className="font-medium">{d.name}</span> },
              { header: "Type", cell: (d) => DEBT_KIND_LABELS[d.kind] },
              { header: "Rate", align: "right", cell: (d) => formatPercent(d.interestRate, 3) },
              { header: "Monthly", align: "right", cell: (d) => formatUsd(d.monthlyPayment) },
              { header: "Paid off in", align: "right", cell: payoffLabel },
              { header: "Balance", align: "right", cell: (d) => formatUsd(d.balance) },
            ]}
          />
          <p className="px-1 text-right text-sm">
            <span className="text-[var(--muted)]">{formatUsd(monthly)}/mo</span>
            <span className="ml-6">Total</span>
            <span className="ml-2 font-semibold tabular-nums">{formatUsd(total)}</span>
          </p>
        </div>
      )}

      {ed.draft && (
        <Sheet
          title={ed.isNew ? "Add debt" : `Edit ${ed.draft.name || "debt"}`}
          error={ed.error}
          saving={ed.saving}
          onSave={ed.save}
          onCancel={ed.close}
          onDelete={ed.isNew ? undefined : ed.remove}
        >
          <Row>
            <SelectField<DebtKind>
              label="Type"
              value={ed.draft.kind}
              onChange={(k) =>
                ed.patch({
                  kind: k,
                  name:
                    ed.draft!.name === "" || ed.draft!.name === DEBT_KIND_LABELS[ed.draft!.kind]
                      ? DEBT_KIND_LABELS[k]
                      : ed.draft!.name,
                })
              }
              options={(Object.keys(DEBT_KIND_LABELS) as DebtKind[]).map((k) => ({
                value: k,
                label: DEBT_KIND_LABELS[k],
              }))}
            />
            <TextField label="Name" value={ed.draft.name} onChange={(v) => ed.set("name", v)} />
          </Row>
          <Row>
            <MoneyField label="Amount owed" value={ed.draft.balance} onChange={(v) => ed.set("balance", v ?? 0)} />
            <PercentField
              label="Interest rate"
              decimals={3}
              value={ed.draft.interestRate}
              onChange={(v) => ed.set("interestRate", v)}
            />
          </Row>
          <MoneyField
            label="Monthly payment"
            hint={
              ed.draft.balance > 0 && ed.draft.monthlyPayment > 0
                ? `At this payment: ${payoffLabel(ed.draft).toLowerCase()}.`
                : "Principal and interest only (leave out escrow for taxes and insurance)."
            }
            value={ed.draft.monthlyPayment}
            onChange={(v) => ed.set("monthlyPayment", v ?? 0)}
          />
          {accounts.length > 0 && (
            <SelectField<number>
              label="Secured by (optional)"
              hint="Link a mortgage to its property so equity is tracked correctly."
              value={ed.draft.accountId ?? 0}
              onChange={(v) => ed.set("accountId", v === 0 ? null : v)}
              options={[
                { value: 0, label: "Nothing" },
                ...accounts.map((a) => ({ value: a.id!, label: `${a.name} (${ACCOUNT_TYPE_LABELS[a.accountType]})` })),
              ]}
            />
          )}
          <TextField label="Notes" value={ed.draft.notes} onChange={(v) => ed.set("notes", v)} placeholder="Optional" />
        </Sheet>
      )}
    </>
  );
}
