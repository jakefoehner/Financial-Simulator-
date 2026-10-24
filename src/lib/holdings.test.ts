import { describe, expect, it } from "vitest";
import retireeJson from "../../fixtures/demo-retiree.json";
import type { TickerInfo } from "./api";
import { concentrations } from "./holdings";
import type { Household } from "./types";

const info = (ticker: string, instrument: string): TickerInfo => ({
  ticker,
  name: ticker,
  instrument,
  price: 1,
  priceDate: "2026-10-23",
  fetchedAt: "2026-10-24T00:00:00Z",
  fit: null,
});

describe("concentrations", () => {
  const h = retireeJson as unknown as Household;

  it("measures single stocks against all invested money", () => {
    const [meta] = concentrations(h, [info("META", "EQUITY")]);
    expect(meta.ticker).toBe("META");
    expect(meta.value).toBeCloseTo(3000 * 642.62);
    // Invested: brokerage 9.4M + IRA 3.2M + Roth 0.65M (cash, homes and private funds aren't).
    expect(meta.share).toBeCloseTo((3000 * 642.62) / 13_250_000, 3);
  });

  it("ignores funds and tickers without a price", () => {
    expect(concentrations(h, [info("META", "ETF")])).toEqual([]);
    expect(concentrations(h, [])).toEqual([]);
  });
});
