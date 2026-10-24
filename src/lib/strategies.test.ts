import { describe, expect, it } from "vitest";
import retireeJson from "../../fixtures/demo-retiree.json";
import type { TaxFacts } from "./api";
import { strategies } from "./strategies";
import type { Household } from "./types";

const facts: TaxFacts = {
  taxYear: 2026,
  annualExclusion: 19_000,
  exemption: 15_000_000,
  afrMonth: "2026-11",
  afrShortTerm: 0.0467,
  afrMidTerm: 0.0508,
  afrLongTerm: 0.0552,
};
const retiree = retireeJson as unknown as Household;

describe("strategies", () => {
  it("shows current figures in the text", () => {
    const annual = strategies(facts).find((s) => s.id === "annual")!;
    expect(annual.summary).toContain("$19K");
    expect(strategies(facts).find((s) => s.id === "loan")!.summary).toContain("5.52%");
  });

  it("every in-app 'Try this' builds a plan for the demo household", () => {
    for (const s of strategies(facts).filter((x) => x.status === "in_app" && x.tryIt)) {
      const plan = s.tryIt!(retiree, facts);
      expect(plan, s.id).not.toBeNull();
      expect(plan!.events.length, s.id).toBeGreaterThan(0);
    }
  });

  it("marks future strategies as coming", () => {
    const coming = strategies(facts)
      .filter((s) => s.status === "coming")
      .map((s) => s.id);
    expect(coming).toEqual(["charity", "education", "llc", "grat"]);
  });
});
