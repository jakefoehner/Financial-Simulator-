import { Download, Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, EmptyState, PageHeader, RecordList } from "../components/Card";
import { MoneyField, NumberField, PercentField, Row, SelectField, TextField, Toggle } from "../components/fields";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { formatUsd } from "../lib/format";
import { useApp } from "../lib/store";
import {
  ACCOUNT_GROUPS,
  ACCOUNT_TYPE_LABELS,
  defaultAllocation,
  defaultPrivateTerms,
  hasAllocation,
  isPrivate,
  hasEmployerMatch,
  takesContributions,
  tracksCostBasis,
  type Account,
  type AccountType,
  type Id,
  type Person,
  type PrivateTerms,
} from "../lib/types";
import { useEditor } from "../lib/useEditor";
import { accountsCsv, saveCsv } from "../lib/csv";
import { ImportSheet } from "./ImportSheet";
import { HoldingsEditor } from "./HoldingsEditor";
import { concentrations } from "../lib/holdings";
import type { TickerInfo } from "../lib/api";
import { RefreshCw } from "lucide-react";

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
    private: null,
    holdings: [],
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
    // Private types carry payout terms; keep them if the type didn't change, else start from typical terms.
    private: isPrivate(t) ? (a.accountType === t && a.private ? a.private : defaultPrivateTerms(t)) : null,
  };
}

function ownerName(people: Person[], id: Id | null): string {
  return people.find((p) => p.id === id)?.name ?? "Joint";
}

function mixLabel(a: Account): string {
  if (a.private) {
    const p = a.private;
    const cash = p.cashYield > 0 ? `${Number((p.cashYield * 100).toFixed(1))}% cash · ` : "";
    return p.exitYear ? `${cash}pays out ${p.exitYear} at ${p.exitMultiple}×` : `${cash}held`;
  }
  if (!hasAllocation(a.accountType)) return "—";
  const pct = (v: number) => Math.round(v * 100);
  return `${pct(a.stocksPct)} / ${pct(a.bondsPct)} / ${pct(a.cashPct)}`;
}

export default function Accounts() {
  const { accounts, people } = useApp((s) => s.household!);
  const ed = useEditor<Account>({ save: api.upsertAccount, remove: api.deleteAccount });
  const primaryId = people.find((p) => p.role === "primary")?.id ?? null;
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const household = useApp((s) => s.household!);
  const importRequest = useApp((s) => s.importRequest);
  const setImportRequest = useApp((s) => s.setImportRequest);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const mutate = useApp((s) => s.mutate);
  const hasHoldings = accounts.some((a) => a.holdings.length > 0);
  useEffect(() => {
    api
      .tickerInfo()
      .then(setTickers)
      .catch(() => {});
  }, [household]);

  const refresh = async () => {
    setRefreshing(true);
    setNote(null);
    try {
      const status = await api.refreshPrices(true);
      setTickers(status.tickers);
      await mutate(api.getHousehold);
      setNote(
        (status.updated.length > 0 ? `Updated ${status.updated.join(", ")}.` : "Nothing to update.") +
          (status.failed.length > 0 ? ` Couldn't update: ${status.failed.join("; ")}.` : ""),
      );
    } catch (e) {
      setNote(String(e));
    } finally {
      setRefreshing(false);
    }
  };
  const concentrated = concentrations(household, tickers).filter((c) => c.share >= 0.1);
  const lastPrice = tickers
    .map((t) => t.priceDate)
    .sort()
    .at(-1);
  useEffect(() => {
    if (importRequest) {
      setImportRequest(false);
      setImporting(true);
    }
  }, [importRequest, setImportRequest]);

  const exportCsv = async () => {
    setNote(null);
    try {
      const path = await saveCsv(`${household.info.name} – accounts.csv`, accountsCsv(household));
      if (path) setNote(`Saved to ${path}`);
    } catch (e) {
      setNote(String(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Everything you own: bank accounts, investments, retirement accounts, and property. Balances are what they're worth today."
        actions={
          <>
            {hasHoldings && (
              <Button variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
                <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> Refresh prices
              </Button>
            )}
            <Button onClick={() => setImporting(true)}>
              <Upload size={16} /> Import from a file…
            </Button>
            {accounts.length > 0 && (
              <Button variant="ghost" onClick={() => void exportCsv()}>
                <Download size={16} /> Export…
              </Button>
            )}
            <Button variant="primary" onClick={() => ed.open(newAccount(primaryId))}>
              <Plus size={16} /> Add account
            </Button>
          </>
        }
      />
      {note && <p className="mb-3 text-xs text-[var(--muted)] select-text">{note}</p>}
      {hasHoldings && lastPrice && !note && (
        <p className="mb-3 text-xs text-[var(--muted)]">Prices from Yahoo Finance, as of {lastPrice}.</p>
      )}
      {concentrated.map((c) => (
        <div key={c.ticker} className="mb-4 rounded-lg bg-amber-500/10 px-4 py-3 text-sm">
          <strong className="font-semibold">
            Concentrated: {Math.round(c.share * 100)}% of your investments is in {c.ticker}
          </strong>{" "}
          <span className="text-[var(--muted)]">
            ({formatUsd(c.value)}).{" "}
            {c.fit
              ? `Over ${c.fit.years} years it moved about ${c.fit.beta.toFixed(1)}× the market and swung about ${Math.round(c.fit.ownVol * 100)}% a year on its own (worst year: ${c.fit.worstYear}, ${Math.round(c.fit.worstReturn * 100)}%).`
              : "A single company swings more than the market."}{" "}
            The range of outcomes includes this risk; the steady path doesn't.
          </span>
        </div>
      ))}
      {importing && <ImportSheet onClose={() => setImporting(false)} />}

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          body="Add your biggest accounts first, or import them from a brokerage's positions file (Schwab, Fidelity, Vanguard, Merrill, Morgan Stanley). You can always come back for the small ones."
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
                    {
                      header: "Name",
                      cell: (a) => (
                        <span>
                          <span className="font-medium">{a.name}</span>
                          {a.holdings.length > 0 && (
                            <span className="ml-2 text-xs text-[var(--muted)]">
                              {a.holdings.length} position{a.holdings.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </span>
                      ),
                    },
                    { header: "Type", cell: (a) => ACCOUNT_TYPE_LABELS[a.accountType] },
                    { header: "Owner", cell: (a) => ownerName(people, a.ownerId) },
                    {
                      header: g.label === "Private investments" ? "Terms" : "Stocks / bonds / cash",
                      align: "right",
                      cell: mixLabel,
                    },
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

/** Payout terms for private funds and startups. */
function PrivateFields({
  account: a,
  terms: p,
  onChange,
}: {
  account: Account;
  terms: PrivateTerms;
  onChange: (p: PrivateTerms) => void;
}) {
  const set = (patch: Partial<PrivateTerms>) => onChange({ ...p, ...patch });
  const startup = a.accountType === "startup";
  return (
    <div className="grid gap-4 rounded-lg border border-[var(--border)] p-4">
      {!startup && (
        <Row>
          <PercentField
            label="Cash paid out each year"
            hint="As a share of what you invested (e.g. 8%)."
            value={p.cashYield}
            onChange={(cashYield) => set({ cashYield })}
          />
          <PercentField
            label="Taxable share of payouts"
            decimals={0}
            hint={
              a.accountType === "real_estate_fund"
                ? "Real estate funds are often partly sheltered by depreciation; 50% is a common estimate. Check your K-1."
                : "Private credit interest is usually fully taxable."
            }
            value={p.taxableShare}
            onChange={(taxableShare) => set({ taxableShare })}
          />
        </Row>
      )}
      <Row>
        <NumberField
          label="Sells / pays back in (year)"
          optional
          placeholder="Held for the whole plan"
          hint="Blank if it has no planned exit."
          value={p.exitYear}
          onChange={(exitYear) => set({ exitYear })}
        />
        <NumberField
          label={startup ? "Expected payout (× invested, on average)" : "Payout at exit (× invested)"}
          hint={
            startup
              ? "Across all your startups together. Each scenario draws winners and losers: most return less than invested, a few many times more."
              : "1.5 means it sells for 1.5× what you put in. Private credit usually returns 1×."
          }
          value={p.exitMultiple}
          onChange={(v) => set({ exitMultiple: v ?? p.exitMultiple })}
          decimal
        />
      </Row>
      {startup && (
        <Row>
          <NumberField
            label="Number of companies"
            hint="More companies means a smoother result."
            value={p.companies}
            onChange={(v) => set({ companies: Math.max(1, v ?? 1) })}
          />
          <div className="pt-5">
            <Toggle
              label="May qualify for QSBS"
              hint="Section 1202 can make gains on qualifying startup stock held 3–5+ years tax-free (limits apply). Confirm with your CPA."
              checked={p.qsbs}
              onChange={(qsbs) => set({ qsbs })}
            />
          </div>
        </Row>
      )}
      <p className="text-xs text-[var(--muted)]">
        Counted in your net worth and estate, but never sold to pay bills before it pays out.
      </p>
    </div>
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
          label={a.accountType === "real_estate" || isPrivate(a.accountType) ? "Current value" : "Balance"}
          value={a.balance}
          onChange={(v) => set("balance", v ?? 0)}
        />
        {tracksCostBasis(a.accountType) && (
          <MoneyField
            label={isPrivate(a.accountType) ? "Amount invested" : "Cost basis (optional)"}
            hint={
              isPrivate(a.accountType)
                ? "What you put in. Payouts and the exit multiple are based on this."
                : "What you paid. Used for capital-gains tax when sold."
            }
            value={a.costBasis}
            optional
            placeholder="Unknown"
            onChange={(v) => set("costBasis", v)}
          />
        )}
      </Row>

      {isPrivate(a.accountType) && a.private && (
        <PrivateFields account={a} terms={a.private} onChange={(p) => set("private", p)} />
      )}

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

      {hasAllocation(a.accountType) && <HoldingsEditor account={a} patch={patch} />}

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
