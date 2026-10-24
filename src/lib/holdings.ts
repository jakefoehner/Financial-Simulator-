// Positions across accounts: how concentrated the household is in single stocks.
import type { TickerInfo } from "./api";
import type { Household } from "./types";

/** Account types whose money counts as investments (not homes, private funds or cash at the bank). */
const INVESTED = new Set([
  "taxable",
  "crypto",
  "rsu",
  "espp",
  "options",
  "llc_interest",
  "trad_401k",
  "roth_401k",
  "trad_ira",
  "roth_ira",
  "hsa",
  "pension",
  "plan_529",
]);

export interface Concentration {
  ticker: string;
  value: number;
  /** Share of all invested money. */
  share: number;
  fit: TickerInfo["fit"];
}

/** Single stocks (per the price service) by size, largest first. */
export function concentrations(h: Household, tickers: TickerInfo[]): Concentration[] {
  const invested = h.accounts.filter((a) => INVESTED.has(a.accountType)).reduce((s, a) => s + a.balance, 0);
  if (invested <= 0) return [];
  const byTicker = new Map<string, number>();
  for (const a of h.accounts) {
    for (const p of a.holdings ?? []) {
      const t = p.ticker.toUpperCase();
      if (t) byTicker.set(t, (byTicker.get(t) ?? 0) + p.shares * p.price);
    }
  }
  return [...byTicker.entries()]
    .flatMap(([ticker, value]) => {
      const info = tickers.find((x) => x.ticker === ticker);
      return info?.instrument === "EQUITY" ? [{ ticker, value, share: value / invested, fit: info.fit }] : [];
    })
    .sort((a, b) => b.value - a.value);
}
