import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { SelectField, TextField } from "../components/fields";
import { Sheet } from "../components/Sheet";
import { api, type ColumnMapping, type ImportPreview, type ImportedAccount } from "../lib/api";
import { formatUsd } from "../lib/format";
import { useApp } from "../lib/store";
import { ACCOUNT_TYPE_LABELS, type Account, type AccountType, type Id } from "../lib/types";

type Row = { include: boolean; updateId: Id | null; account: Account; source: ImportedAccount };

const FIELDS: { key: keyof Omit<ColumnMapping, "headerRow">; label: string; required?: boolean }[] = [
  { key: "symbol", label: "Ticker / symbol", required: true },
  { key: "shares", label: "Shares" },
  { key: "value", label: "Market value" },
  { key: "price", label: "Price" },
  { key: "costBasis", label: "Cost basis" },
  { key: "description", label: "Description" },
  { key: "account", label: "Account (if the file has several)" },
];

/** Imports accounts and positions from a brokerage export (Schwab, Fidelity, Vanguard, Merrill, Morgan Stanley, or the template). */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const accounts = useApp((s) => s.household!.accounts);
  const mutate = useApp((s) => s.mutate);
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pick the file as soon as the sheet opens.
  useEffect(() => {
    void (async () => {
      try {
        const p = await open({
          multiple: false,
          directory: false,
          filters: [{ name: "Spreadsheet (CSV)", extensions: ["csv", "txt"] }],
        });
        if (typeof p !== "string") return onClose();
        setPath(p);
        show(await api.readImportFile(p));
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const show = (p: ImportPreview) => {
    setPreview(p);
    if (p.kind === "needsMapping") {
      setMapping({
        headerRow: p.headerRow,
        symbol: null,
        description: null,
        shares: null,
        price: null,
        value: null,
        costBasis: null,
        account: null,
      });
      return;
    }
    setRows(
      p.accounts.map((a) => {
        // Suggest updating an account with the same name or account-number ending.
        const match = accounts.find(
          (x) =>
            x.name.toLowerCase() === a.name.toLowerCase() || (a.numberLast4 != null && x.name.includes(a.numberLast4)),
        );
        return { include: true, updateId: match?.id ?? null, account: a.account, source: a };
      }),
    );
  };

  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const run = async (op: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await op();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!preview) {
    return error ? (
      <Sheet title="Import from a file" error={error} saving={false} saveLabel="OK" onSave={onClose} onCancel={onClose}>
        <p className="text-sm">Couldn't read that file.</p>
      </Sheet>
    ) : null;
  }

  if (preview.kind === "needsMapping" && mapping) {
    const options = [
      { value: -1, label: "(not in this file)" },
      ...preview.columns.map((c, i) => ({ value: i, label: c || `Column ${i + 1}` })),
    ];
    return (
      <Sheet
        title="Which column is which?"
        error={error}
        saving={busy}
        saveLabel="Continue"
        onCancel={onClose}
        onSave={() =>
          run(async () => {
            if (mapping.symbol == null) throw new Error("Pick the ticker column.");
            if (mapping.value == null && mapping.shares == null) throw new Error("Pick the market value or shares.");
            show(await api.readImportMapped(path!, mapping));
          })
        }
      >
        <p className="text-sm text-[var(--muted)]">
          This file's layout isn't one we recognize yet. Tell us which column holds what. (Schwab, Fidelity, Vanguard,
          Merrill and Morgan Stanley position exports are read automatically.)
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <SelectField<number>
              key={f.key}
              label={f.label + (f.required ? " *" : "")}
              value={mapping[f.key] ?? -1}
              onChange={(v) => setMapping({ ...mapping, [f.key]: v < 0 ? null : v })}
              options={options}
            />
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] text-xs">
          <table className="w-full">
            <thead>
              <tr>
                {preview.columns.map((c, i) => (
                  <th key={i} className="px-2 py-1 text-left font-medium whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((r, i) => (
                <tr key={i} className="border-t border-[var(--border)]">
                  {r.map((c, k) => (
                    <td key={k} className="px-2 py-1 whitespace-nowrap text-[var(--muted)]">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sheet>
    );
  }

  if (preview.kind !== "parsed") return null;
  const chosen = rows.filter((r) => r.include);
  return (
    <Sheet
      title={`Import from ${preview.brokerage === "Other" || preview.brokerage === "Template" ? "a file" : preview.brokerage}`}
      error={error}
      saving={busy}
      saveLabel={`Import ${chosen.length} account${chosen.length === 1 ? "" : "s"}`}
      savingLabel="Importing…"
      onCancel={onClose}
      onSave={() =>
        run(async () => {
          if (chosen.length === 0) throw new Error("Pick at least one account to import.");
          await mutate(() => api.applyImport(chosen.map((r) => ({ account: r.account, updateId: r.updateId }))));
          onClose();
        })
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm">No positions were found in this file.</p>
      ) : (
        <>
          <p className="text-sm text-[var(--muted)]">
            Check each account, then import. Updating an existing account replaces its balance, cost basis, mix and
            positions, and keeps its name, owner and contributions.
          </p>
          {rows.map((r, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-[var(--border)] p-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={r.include} onChange={(e) => set(i, { include: e.target.checked })} />
                  {r.source.name}
                </span>
                <span className="tabular-nums">{formatUsd(r.source.total)}</span>
              </label>
              {r.include && (
                <>
                  <SelectField<number>
                    label="Save as"
                    value={r.updateId ?? 0}
                    onChange={(v) => set(i, { updateId: v === 0 ? null : v })}
                    options={[
                      { value: 0, label: "A new account" },
                      ...accounts.map((a) => ({ value: a.id!, label: `Update “${a.name}”` })),
                    ]}
                  />
                  {r.updateId == null && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        label="Name"
                        value={r.account.name}
                        onChange={(name) => set(i, { account: { ...r.account, name } })}
                      />
                      <SelectField<AccountType>
                        label="Type"
                        value={r.account.accountType}
                        onChange={(accountType) => set(i, { account: { ...r.account, accountType } })}
                        options={(
                          [
                            "taxable",
                            "trad_ira",
                            "roth_ira",
                            "trad_401k",
                            "roth_401k",
                            "hsa",
                            "plan_529",
                            "checking",
                            "savings",
                          ] as AccountType[]
                        ).map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t] }))}
                      />
                    </div>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-[var(--muted)]">
                      {r.source.holdings.length} position{r.source.holdings.length === 1 ? "" : "s"}
                      {r.source.cash > 0 ? ` + ${formatUsd(r.source.cash)} cash` : ""} ·{" "}
                      {Math.round(r.account.stocksPct * 100)}% stocks / {Math.round(r.account.bondsPct * 100)}% bonds /{" "}
                      {Math.round(r.account.cashPct * 100)}% cash
                    </summary>
                    <table className="mt-2 w-full tabular-nums">
                      <tbody>
                        {r.source.holdings.map((h, k) => (
                          <tr key={k} className="border-t border-[var(--border)]">
                            <td className="py-1 font-medium">{h.ticker || "—"}</td>
                            <td className="py-1 text-[var(--muted)]">{h.description}</td>
                            <td className="py-1 text-right">{h.shares.toLocaleString("en-US")} sh</td>
                            <td className="py-1 text-right">{formatUsd(h.shares * h.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </Sheet>
  );
}
