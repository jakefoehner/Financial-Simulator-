import { describe, expect, it } from "vitest";
import { shallowEqual } from "./equal";

describe("shallowEqual", () => {
  it("ignores key order", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
  it("detects changed or missing values", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(shallowEqual<Record<string, number>>({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
