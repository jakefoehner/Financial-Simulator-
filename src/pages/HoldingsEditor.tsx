import { Plus, X } from "lucide-react";
import { inputClass } from "../components/fields";
import { formatUsd } from "../lib/format";
import type { Account, Holding } from "../lib/types";

const num = (s: string): number | null => {
  const v = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

const value = (hs: Holding[]) => hs.reduce((s, h) => s + h.shares * h.price, 0);

/**
 * An account's positions (ticker, shares, cost basis). Changing them moves the balance by
 * the change in their value, so cash and anything not listed stays as entered.
 */
export function HoldingsEditor({ account: a, patch }: { account: Account; patch: (p: Partial<Account>) => void }) {
  const update = (next: Holding[]) =>
    patch({
      holdings: next,
      balance: Math.max(0, Math.round((a.balance - value(a.holdings) + value(next)) * 100) / 100),
    });
  const set = (i: number, p: Partial<Holding>) => update(a.holdings.map((h, k) => (k === i ? { ...h, ...p } : h)));
  const listed = value(a.holdings);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--muted)]">Positions (optional)</span>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-accent hover:bg-accent/10"
          onClick={() =>
            update([
              ...a.holdings,
              { ticker: "", description: "", shares: 0, price: 0, costBasis: null, priceDate: null },
            ])
          }
        >
          <Plus size={12} /> Add a position
        </button>
      </div>
      {a.holdings.length > 0 && (
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-[var(--muted)]">
            <tr>
              <th className="pb-1 text-left font-medium">Ticker</th>
              <th className="pb-1 text-left font-medium">Shares</th>
              <th className="pb-1 text-left font-medium">Price</th>
              <th className="pb-1 text-left font-medium">Cost basis</th>
              <th className="pb-1 text-right font-medium">Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {a.holdings.map((h, i) => (
              <tr key={i}>
                <td className="pr-2 pb-1">
                  <input
                    aria-label="Ticker"
                    className={`${inputClass} w-20 uppercase`}
                    value={h.ticker}
                    onChange={(e) => set(i, { ticker: e.target.value.toUpperCase().trim(), priceDate: null })}
                  />
                </td>
                <td className="pr-2 pb-1">
                  <input
                    aria-label="Shares"
                    className={`${inputClass} w-24`}
                    defaultValue={h.shares || ""}
                    onBlur={(e) => set(i, { shares: Math.max(0, num(e.target.value) ?? 0) })}
                  />
                </td>
                <td className="pr-2 pb-1">
                  <input
                    aria-label="Price"
                    title={h.priceDate ? `From Yahoo Finance, ${h.priceDate}` : "Typed in; Refresh prices fills it in"}
                    className={`${inputClass} w-24`}
                    defaultValue={h.price || ""}
                    key={`${h.ticker}-${h.price}`}
                    onBlur={(e) => set(i, { price: Math.max(0, num(e.target.value) ?? 0), priceDate: null })}
                  />
                </td>
                <td className="pr-2 pb-1">
                  <input
                    aria-label="Cost basis"
                    className={`${inputClass} w-28`}
                    placeholder="Unknown"
                    defaultValue={h.costBasis ?? ""}
                    onBlur={(e) => set(i, { costBasis: num(e.target.value) })}
                  />
                </td>
                <td className="pb-1 text-right">{formatUsd(h.shares * h.price)}</td>
                <td className="pb-1 pl-1">
                  <button
                    type="button"
                    aria-label={`Remove ${h.ticker || "position"}`}
                    className="rounded p-1 text-[var(--muted)] hover:text-[var(--critical)]"
                    onClick={() => update(a.holdings.filter((_, k) => k !== i))}
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-[var(--muted)]">
        {a.holdings.length === 0
          ? "List individual stocks or funds to keep prices current and to model single-stock risk (a big position in one company swings more than the market)."
          : `Positions total ${formatUsd(listed)}; the rest of the balance (${formatUsd(Math.max(0, a.balance - listed))}) is cash or anything not listed. Prices update from Yahoo Finance with Refresh prices.`}
      </p>
    </div>
  );
}
