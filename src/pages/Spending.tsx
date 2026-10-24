import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, Card, EmptyState, PageHeader, RecordList } from "../components/Card";
import { MoneyField, NumberField, TextField } from "../components/fields";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { formatUsd } from "../lib/format";
import { useApp } from "../lib/store";
import { currentYear, type OneTimeExpense } from "../lib/types";
import { useEditor } from "../lib/useEditor";

function newExpense(): OneTimeExpense {
  return { id: null, name: "", year: currentYear() + 1, amount: 0 };
}

export default function Spending() {
  const { info, oneTimeExpenses } = useApp((s) => s.household!);
  const mutate = useApp((s) => s.mutate);
  const ed = useEditor<OneTimeExpense>({ save: api.upsertOneTimeExpense, remove: api.deleteOneTimeExpense });
  const [error, setError] = useState<string | null>(null);

  const saveInfo = async (patch: Partial<typeof info>) => {
    setError(null);
    try {
      await mutate(() => api.saveHouseholdInfo({ ...info, ...patch }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Spending"
        subtitle="How much you spend to live, plus any big purchases you already know are coming. Everything is in today's dollars; the simulator adds inflation."
        actions={
          <Button variant="primary" onClick={() => ed.open(newExpense())}>
            <Plus size={16} /> Add one-time expense
          </Button>
        }
      />

      <div className="grid gap-6">
        <Card title="Yearly living expenses">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <MoneyField
              label="Per year"
              value={info.baseAnnualSpending}
              onChange={(v) => saveInfo({ baseAnnualSpending: v ?? 0 })}
              hint="Housing, food, travel, insurance, giving: a typical year. Leave out debt payments and income taxes; those are added for you."
            />
            <MoneyField
              label="Home property tax, per year"
              value={info.homePropertyTax}
              onChange={(v) => saveInfo({ homePropertyTax: v ?? 0 })}
              hint="Already part of your spending above. Used only to see whether itemizing your deductions beats the standard deduction."
            />
          </div>
          {info.baseAnnualSpending > 0 && (
            <p className="mt-2 text-xs text-[var(--muted)]">About {formatUsd(info.baseAnnualSpending / 12)} a month.</p>
          )}
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </Card>

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold">Big one-time expenses</h2>
          {oneTimeExpenses.length === 0 ? (
            <EmptyState
              title="Nothing planned yet"
              body="A new roof, a car, a wedding, a big trip. Add anything large enough to notice."
            />
          ) : (
            <RecordList
              items={oneTimeExpenses}
              rowKey={(x) => x.id!}
              onSelect={ed.open}
              columns={[
                { header: "What", cell: (x) => <span className="font-medium">{x.name}</span> },
                { header: "Year", cell: (x) => x.year },
                { header: "Cost (today's $)", align: "right", cell: (x) => formatUsd(x.amount) },
              ]}
            />
          )}
        </section>
      </div>

      {ed.draft && (
        <Sheet
          title={ed.isNew ? "Add one-time expense" : `Edit ${ed.draft.name || "expense"}`}
          error={ed.error}
          saving={ed.saving}
          onSave={ed.save}
          onCancel={ed.close}
          onDelete={ed.isNew ? undefined : ed.remove}
        >
          <TextField
            label="What is it?"
            value={ed.draft.name}
            onChange={(v) => ed.set("name", v)}
            placeholder="e.g. New roof"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-4">
            <NumberField label="Year" value={ed.draft.year} onChange={(v) => ed.set("year", v ?? currentYear())} />
            <MoneyField
              label="Cost in today's dollars"
              value={ed.draft.amount}
              onChange={(v) => ed.set("amount", v ?? 0)}
            />
          </div>
        </Sheet>
      )}
    </>
  );
}
