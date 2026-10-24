import { describe, expect, it } from "vitest";
import retireeJson from "../../fixtures/demo-retiree.json";
import { accountsCsv, toCsv } from "./csv";
import type { Household } from "./types";

describe("csv", () => {
  it("quotes only what needs it and rounds money to cents", () => {
    expect(toCsv([["a", 'say "hi"', "x,y", 1.239, null, 3]])).toBe('a,"say ""hi""","x,y",1.24,,3\n');
    expect(toCsv([["line\nbreak"]])).toBe('"line\nbreak"\n');
  });

  it("exports every account and its positions", () => {
    const h = { ...(retireeJson as unknown as Household) };
    h.accounts = h.accounts.map((a, i) => ({
      ...a,
      holdings:
        i === 0
          ? [
              {
                ticker: "META",
                description: "Meta Platforms",
                shares: 10,
                price: 600,
                costBasis: 1000,
                priceDate: null,
              },
            ]
          : [],
    }));
    const text = accountsCsv(h);
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("Account,Type,Owner,Balance,Cost basis,Stocks %,Bonds %,Cash %,Yearly contribution");
    expect(lines).toHaveLength(1 + h.accounts.length + 3);
    expect(lines.at(-1)).toBe("Taxable brokerage,META,Meta Platforms,10,600,6000,1000");
  });
});
