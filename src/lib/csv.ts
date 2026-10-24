// CSV exports (accounts and holdings, the year-by-year forecast), for spreadsheets.
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import type { Projection } from "./projection";
import { ACCOUNT_TYPE_LABELS, type Household } from "./types";

type Cell = string | number | null | undefined;

function cell(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Rows to CSV text (RFC 4180 quoting, numbers rounded to cents). */
export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

/** Every account, then every position, in one sheet. */
export function accountsCsv(h: Household): string {
  const owner = (id: number | null) => h.people.find((p) => p.id === id)?.name ?? "Joint";
  const rows: Cell[][] = [
    ["Account", "Type", "Owner", "Balance", "Cost basis", "Stocks %", "Bonds %", "Cash %", "Yearly contribution"],
    ...h.accounts.map((a) => [
      a.name,
      ACCOUNT_TYPE_LABELS[a.accountType],
      owner(a.ownerId),
      a.balance,
      a.costBasis,
      Math.round(a.stocksPct * 100),
      Math.round(a.bondsPct * 100),
      Math.round(a.cashPct * 100),
      a.annualContribution,
    ]),
  ];
  const positions = h.accounts.flatMap((a) =>
    a.holdings.map((p) => [a.name, p.ticker, p.description, p.shares, p.price, p.shares * p.price, p.costBasis]),
  );
  if (positions.length > 0) {
    rows.push([], ["Account", "Ticker", "Description", "Shares", "Price", "Value", "Cost basis"], ...positions);
  }
  return toCsv(rows);
}

/** The steady path year by year, in each year's dollars and today's. */
export function forecastCsv(p: Projection): string {
  return toCsv([
    [
      "Year",
      "Age",
      "Earned income",
      "Other income",
      "Social Security",
      "Withdrawals",
      "Spending",
      "Taxes",
      "Gifts",
      "Charity",
      "Spendable savings",
      "Net worth",
      "Net worth (today's dollars)",
    ],
    ...p.years.map((y) => [
      y.year,
      y.age,
      y.earnedIncome,
      y.otherIncome,
      y.socialSecurity,
      y.withdrawals + y.requiredDistributions,
      y.spending + y.oneTimeExpenses + y.debtPayments,
      y.taxes,
      y.gifts,
      y.charity,
      y.balances.cash + y.balances.taxable + y.balances.taxDeferred + y.balances.taxFree,
      y.netWorth,
      y.netWorth / y.priceLevel,
    ]),
  ]);
}

/** Asks where to save, then writes the CSV. Returns the path, or null if cancelled. */
export async function saveCsv(defaultName: string, contents: string): Promise<string | null> {
  const path = await save({ defaultPath: defaultName, filters: [{ name: "Spreadsheet (CSV)", extensions: ["csv"] }] });
  if (!path) return null;
  await api.writeTextFile(path, contents);
  return path;
}
