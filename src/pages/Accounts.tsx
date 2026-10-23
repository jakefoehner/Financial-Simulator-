import { Plus } from "lucide-react";
import { Button, EmptyState, PageHeader, RecordList } from "../components/Card";
import { MoneyField, PercentField, Row, SelectField, TextField } from "../components/fields";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { formatUsd } from "../lib/format";
import { useApp } from "../lib/store";
import {
  ACCOUNT_GROUPS,
  ACCOUNT_TYPE_LABELS,
  defaultAllocation,
  hasAllocation,
  hasEmployerMatch,
  takesContributions,
  tracksCostBasis,
  type Account,
  type AccountType,
  type Id,
  type Person,
} from "../lib/types";
import { useEditor } from "../lib/useEditor";

const MIX_PRESETS: { label: string; stocks: number; bonds: number }[] = [
  { label: "All stocks", stocks: 1, bonds: 0 },
  { label: "80 / 20", stocks: 0.8, bonds: 0.2 },
  { label: "60 / 40", stocks: 0.6, bonds: 0.4 },
  { label: "40 / 60", stocks: 0.4, bonds: 0.6 },
];

function newAccount(ownerId: Id | null): Account {
  return {
    id: null,
    name: "",
    accountType: "taxable",
    ownerId,
    balance: 0,
    costBasis: null,
    ...defaultAllocation("taxable"),
    annualContribution: 0,
    employerMatch: 0,
    notes: "",
  };
}

/** Switching type resets fields that don't apply, so hidden values never reach the engine. */
export function withType(a: Account, t: AccountType): Account {
  const typeLabelAsName = a.name === "" || a.name === ACCOUNT_TYPE_LABELS[a.accountType];
  return {
    ...a,
    accountType: t,
    name: typeLabelAsName ? ACCOUNT_TYPE_LABELS[t] : a.name,
    ...(hasAllocation(t) === hasAllocation(a.accountType) && hasAllocation(t) ? {} : defaultAllocation(t)),
    costBasis: tracksCostBasis(t) ? a.costBasis : null,
    annualContribution: takesContributions(t) ? a.annualContribution : 0,
    employerMatch: hasEmployerMatch(t) ? a.employerMatch : 0,
  };
}

function ownerName(people: Person[], id: Id | null): string {
  return people.find((p) => p.id === id)?.name ?? "Joint";
}

function mixLabel(a: Account): string {
  if (!hasAllocation(a.accountType)) return "—";
  const pct = (v: number) => Math.round(v * 100);
  return `${pct(a.stocksPct)} / ${pct(a.bondsPct)} / ${pct(a.cashPct)}`;
}

export default function Accounts() {
  const { accounts, people } = useApp((s) => s.household!);
  const ed = useEditor<Account>({ save: api.upsertAccount, remove: api.deleteAccount });
  const primaryId = people.find((p) => p.role === "primary")?.id ?? null;
  const total = accounts.reduce((s, a) => s + a.balance, 0);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Everything you own: bank accounts, investments, retirement accounts, and property. Balances are what they're worth today."
        actions={
          <Button variant="primary" onClick={() => ed.open(newAccount(primaryId))}>
            <Plus size={16} /> Add account
          </Button>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          body="Add your biggest accounts first. You can always come back for the small ones."
          action={
            <Button variant="primary" onClick={() => ed.open(newAccount(primaryId))}>
              Add an account
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6">
          {ACCOUNT_GROUPS.map((g) => {
            const items = accounts.filter((a) => g.types.some((t) => t.type === a.accountType));
            if (items.length === 0) return null;
            const subtotal = items.reduce((s, a) => s + a.balance, 0);
            return (
              <section key={g.label}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold">{g.label}</h2>
                  <span className="text-sm text-[var(--muted)] tabular-nums">{formatUsd(subtotal)}</span>
                </div>
                <RecordList
                  items={items}
                  rowKey={(a) => a.id!}
                  onSelect={ed.open}
                  columns={[
                    { header: "Name", cell: (a) => <span className="font-medium">{a.name}</span> },
                    { header: "Type", cell: (a) => ACCOUNT_TYPE_LABELS[a.accountType] },
                    { header: "Owner", cell: (a) => ownerName(people, a.ownerId) },
                    { header: "Stocks / bonds / cash", align: "right", cell: mixLabel },
                    { header: "Balance", align: "right", cell: (a) => formatUsd(a.balance) },
                  ]}
                />
              </section>
            );
          })}
          <p className="px-1 text-right text-sm">
            Total <span className="ml-2 font-semibold tabular-nums">{formatUsd(total)}</span>
          </p>
        </div>
      )}

      {ed.draft && (
        <Sheet
          title={ed.isNew ? "Add account" : `Edit ${ed.draft.name || "account"}`}
          error={ed.error}
          saving={ed.saving}
          onSave={ed.save}
          onCancel={ed.close}
          onDelete={ed.isNew ? undefined : ed.remove}
          deleteWarning="Loans linked to it stay, but are unlinked."
        >
          <AccountForm draft={ed.draft} people={people} set={ed.set} patch={ed.patch} />
        </Sheet>
      )}
    </>
  );
}

function AccountForm({
  draft: a,
  people,
  set,
  patch,
}: {
  draft: Account;
  people: Person[];
  set: <K extends keyof Account>(k: K, v: Account[K]) => void;
  patch: (p: Partial<Account>) => void;
}) {
  const total = a.stocksPct + a.bondsPct + a.cashPct;
  const totalOk = Math.abs(total - 1) < 0.001;

  return (
    <>
      <Row>
        <SelectField<AccountType>
          label="Type"
          value={a.accountType}
          onChange={(t) => patch(withType(a, t))}
          options={ACCOUNT_GROUPS.flatMap((g) =>
            g.types.map((t) => ({ value: t.type, label: t.label, group: g.label })),
          )}
        />
        <SelectField<number>
          label="Owner"
          value={a.ownerId ?? 0}
          onChange={(v) => set("ownerId", v === 0 ? null : v)}
          options={[...people.map((p) => ({ value: p.id!, label: p.name })), { value: 0, label: "Joint / household" }]}
        />
      </Row>
      <TextField label="Name" value={a.name} onChange={(v) => set("name", v)} placeholder="e.g. Schwab brokerage" />
      <Row>
        <MoneyField
          label={a.accountType === "real_estate" ? "Current value" : "Balance"}
          value={a.balance}
          onChange={(v) => set("balance", v ?? 0)}
        />
        {tracksCostBasis(a.accountType) && (
          <MoneyField
            label="Cost basis (optional)"
            hint="What you paid. Used for capital-gains tax when sold."
            value={a.costBasis}
            optional
            placeholder="Unknown"
            onChange={(v) => set("costBasis", v)}
          />
        )}
      </Row>

      {hasAllocation(a.accountType) && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--muted)]">Investment mix</span>
            <div className="flex gap-1">
              {MIX_PRESETS.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  className="rounded px-2 py-0.5 text-xs text-accent hover:bg-accent/10"
                  onClick={() => patch({ stocksPct: m.stocks, bondsPct: m.bonds, cashPct: 0 })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <PercentField label="Stocks" decimals={0} value={a.stocksPct} onChange={(v) => set("stocksPct", v)} />
            <PercentField label="Bonds" decimals={0} value={a.bondsPct} onChange={(v) => set("bondsPct", v)} />
            <PercentField label="Cash" decimals={0} value={a.cashPct} onChange={(v) => set("cashPct", v)} />
          </div>
          <p className={`text-xs ${totalOk ? "text-[var(--muted)]" : "text-red-600 dark:text-red-400"}`}>
            {totalOk
              ? "Adds up to 100%. Not sure? A target-date or “balanced” fund is often about 60 / 40."
              : `Adds up to ${Math.round(total * 100)}% — needs to be 100%.`}
          </p>
        </div>
      )}

      {takesContributions(a.accountType) && (
        <Row>
          <MoneyField
            label="You add per year"
            value={a.annualContribution}
            onChange={(v) => set("annualContribution", v ?? 0)}
          />
          {hasEmployerMatch(a.accountType) && (
            <MoneyField
              label="Employer adds per year"
              value={a.employerMatch}
              onChange={(v) => set("employerMatch", v ?? 0)}
            />
          )}
        </Row>
      )}

      <TextField label="Notes" value={a.notes} onChange={(v) => set("notes", v)} placeholder="Optional" />
    </>
  );
}
