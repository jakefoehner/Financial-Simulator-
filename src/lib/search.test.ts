import { describe, expect, it } from "vitest";
import { highlight, matches, normalize, words } from "./search";

describe("search", () => {
  it("normalizes case, accents and money", () => {
    expect(normalize("Café")).toBe("cafe");
    expect(normalize("$2,000,000")).toBe("2000000");
    expect(normalize("$2M")).toBe("2000000");
    expect(normalize("$1.5m gift")).toBe("1500000 gift");
    expect(normalize("$150K")).toBe("150000");
    expect(words("  Help   SAM ")).toEqual(["help", "sam"]);
  });

  it("needs every word, somewhere", () => {
    const plan = ["Help Sam with a down payment", "Age 59 · Help Sam buy a home: $150K gift"];
    expect(matches("sam", plan)).toBe(true);
    expect(matches("sam 150k", plan)).toBe(true);
    expect(matches("sam jordan", plan)).toBe(false);
    expect(matches("", plan)).toBe(true);
  });

  it("matches everyday words through synonyms", () => {
    expect(matches("house", ["Help a child buy a home"])).toBe(true);
    expect(matches("college", ["Fund a 529 for a child"])).toBe(true);
    expect(matches("trust", ["Use GRATs (annuity trusts)"])).toBe(true);
    expect(matches("donate", ["Give to charity"])).toBe(true);
    expect(matches("2m", ["Put $2,000,000 in a GRAT"])).toBe(true);
  });

  it("highlights matched words", () => {
    expect(highlight("Help Sam buy", "sam")).toEqual([
      { text: "Help ", match: false },
      { text: "Sam", match: true },
      { text: " buy", match: false },
    ]);
    expect(highlight("abc", "")).toEqual([{ text: "abc", match: false }]);
  });
});
