import { describe, expect, it } from "vitest";
import retireeJson from "../../fixtures/demo-retiree.json";
import type { TaxFacts } from "./api";
import { matches } from "./search";
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
  section7520: 0.062,
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

  it("every strategy is tagged and can be found by its title", () => {
    for (const st of strategies(facts)) {
      expect(st.tags.length, st.id).toBeGreaterThan(0);
      expect(matches(st.title, [st.title, st.summary]), st.id).toBe(true);
    }
    const charity = strategies(facts).filter((st) => matches("donate", [st.title, st.summary, st.how]));
    expect(charity.map((st) => st.id)).toContain("charity");
  });

  it("has every strategy in the app now", () => {
    expect(strategies(facts).filter((s) => s.status === "coming")).toEqual([]);
    expect(strategies(facts).find((s) => s.id === "grat")!.summary).toContain("6.2%");
  });
});
