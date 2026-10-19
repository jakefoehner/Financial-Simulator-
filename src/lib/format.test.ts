import { describe, expect, it } from "vitest";
import { formatUsd, formatUsdCompact, parseUsd } from "./format";

describe("formatUsd", () => {
  it("rounds to whole dollars with separators", () => {
    expect(formatUsd(1234567.89)).toBe("$1,234,568");
  });
});

describe("formatUsdCompact", () => {
  it.each([
    [900, "$900"],
    [850_000, "$850K"],
    [1_200_000, "$1.2M"],
    [3_000_000, "$3M"],
    [125_000_000, "$125M"],
    [-2_500_000, "-$2.5M"],
  ])("%d -> %s", (n, s) => {
    expect(formatUsdCompact(n)).toBe(s);
  });
});

describe("parseUsd", () => {
  it.each([
    ["$1,250,000", 1_250_000],
    ["1.2m", 1_200_000],
    ["850k", 850_000],
    [" 42 ", 42],
  ])("%s -> %d", (s, n) => {
    expect(parseUsd(s)).toBe(n);
  });

  it("returns NaN for garbage", () => {
    expect(parseUsd("abc")).toBeNaN();
  });
});
