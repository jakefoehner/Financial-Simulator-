import { useEffect, useState } from "react";
import { Button, Card } from "../../components/Card";
import { MoneyField, NumberField, PercentField, SelectField, Toggle } from "../../components/fields";
import { api } from "../../lib/api";
import { shallowEqual } from "../../lib/equal";
import { formatPercent } from "../../lib/format";
import { useApp } from "../../lib/store";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../../lib/types";

const SCENARIO_COUNTS = [1_000, 5_000, 10_000];

export default function AssumptionsCard({ assumptions }: { assumptions: Assumptions }) {
  const mutate = useApp((s) => s.mutate);
  const [draft, setDraft] = useState(assumptions);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(assumptions), [assumptions]);

  const dirty = !shallowEqual(draft, assumptions);
  const isDefault = shallowEqual(assumptions, DEFAULT_ASSUMPTIONS);
  const set =
    <K extends keyof Assumptions>(k: K) =>
    (v: Assumptions[K]) =>
      setDraft((d) => ({ ...d, [k]: v }));
  const save = async (a: Assumptions) => {
    setError(null);
    try {
      await mutate(() => api.saveAssumptions(a));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card title="Assumptions">
      <p className="mb-4 text-sm text-[var(--muted)]">
        Long-run yearly averages before inflation. The steady path uses them every year; the range of outcomes replays
        real history scaled to them. US stocks averaged about 10% a year from 1928 to 2025; these defaults are
        deliberately more cautious.
      </p>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save(draft);
        }}
      >
        <div className="grid grid-cols-3 gap-4">
          <PercentField label="Stocks grow" value={draft.stocksReturn} onChange={set("stocksReturn")} />
          <PercentField label="Bonds grow" value={draft.bondsReturn} onChange={set("bondsReturn")} />
          <PercentField label="Cash earns" value={draft.cashReturn} onChange={set("cashReturn")} />
          <PercentField label="Real estate grows" value={draft.realEstateGrowth} onChange={set("realEstateGrowth")} />
          <PercentField label="Inflation" value={draft.inflation} onChange={set("inflation")} />
          <PercentField
            label="Stock dividends"
            hint="Part of the stock return, taxed yearly"
            value={draft.stockDividendYield}
            onChange={set("stockDividendYield")}
          />
        </div>
        <div className="grid grid-cols-3 items-start gap-4 border-t border-[var(--border)] pt-4">
          <SelectField<number>
            label="Scenarios to run"
            hint="More scenarios give steadier odds."
            value={draft.simulations}
            onChange={set("simulations")}
            options={SCENARIO_COUNTS.map((n) => ({ value: n, label: n.toLocaleString("en-US") }))}
          />
          <div className="col-span-2 pt-5">
            <Toggle
              label="Keep inflation steady"
              hint={`Off: each scenario replays history's inflation (like the 1970s), averaging ${formatPercent(draft.inflation)}. On: a constant ${formatPercent(draft.inflation)} every year.`}
              checked={draft.steadyInflation}
              onChange={set("steadyInflation")}
            />
          </div>
        </div>

        <div className="grid gap-4 border-t border-[var(--border)] pt-4">
          <p className="text-xs font-medium text-[var(--muted)]">Estate & inheritance</p>
          <div className="grid grid-cols-3 items-start gap-4">
            <PercentField
              label="Kids' income-tax rate on inherited IRAs"
              decimals={0}
              hint="Inherited traditional IRA/401(k) money is taxed as your kids withdraw it (within 10 years). 24% is a middle-income bracket."
              value={draft.heirIncomeTaxRate}
              onChange={set("heirIncomeTaxRate")}
            />
            <PercentField
              label="Kids' capital-gains rate on gifts"
              decimals={0}
              hint="Gifts keep your cost basis, so your kids pay this on the gain when they sell. Inherited assets are stepped up instead."
              value={draft.heirCapitalGainsRate}
              onChange={set("heirCapitalGainsRate")}
            />
            <NumberField
              label="Estimate the estate at age"
              hint="Blank = the last year of the plan."
              optional
              placeholder="End of plan"
              value={draft.estateAge}
              onChange={set("estateAge")}
            />
          </div>
          <Toggle
            label="What if the estate-tax exemption is cut?"
            hint="Laws change. This lowers the $15M exemption from a year you choose, so you can see how much a cut would cost and whether giving earlier helps."
            checked={draft.exemptionCutEnabled}
            onChange={set("exemptionCutEnabled")}
          />
          {draft.exemptionCutEnabled && (
            <div className="grid grid-cols-3 gap-4">
              <MoneyField
                label="Exemption becomes (today's dollars)"
                hint="About $7M is roughly where the pre-2018 rules would be today."
                value={draft.exemptionCutAmount}
                onChange={(v) => set("exemptionCutAmount")(v ?? 0)}
              />
              <NumberField
                label="Starting in"
                value={draft.exemptionCutYear}
                onChange={(v) => set("exemptionCutYear")(v ?? draft.exemptionCutYear)}
              />
            </div>
          )}
          <Toggle
            label="What if income and capital-gains taxes rise?"
            hint="Raises every income-tax bracket and the 15% / 20% capital-gains rates from a year you choose. Useful for weighing paying tax now (Roth conversions, gifts, selling) against later."
            checked={draft.taxRiseEnabled}
            onChange={set("taxRiseEnabled")}
          />
          {draft.taxRiseEnabled && (
            <div className="grid grid-cols-3 gap-4">
              <NumberField
                label="Starting in"
                value={draft.taxRiseYear}
                onChange={(v) => set("taxRiseYear")(v ?? draft.taxRiseYear)}
              />
              <PercentField
                label="Income-tax rates go up by"
                decimals={1}
                hint="Points added to every bracket (5 = 22% becomes 27%)."
                value={draft.incomeTaxIncrease}
                onChange={set("incomeTaxIncrease")}
              />
              <PercentField
                label="Capital-gains rates go up by"
                decimals={1}
                hint="Points added to the 15% and 20% rates."
                value={draft.capitalGainsIncrease}
                onChange={set("capitalGainsIncrease")}
              />
            </div>
          )}
        </div>

        {error && <p className="text-sm text-[var(--critical)]">{error}</p>}
        <div className="flex justify-end gap-2">
          {!isDefault && <Button onClick={() => void save(DEFAULT_ASSUMPTIONS)}>Reset to defaults</Button>}
          <Button variant="primary" type="submit" disabled={!dirty}>
            Update forecast
          </Button>
        </div>
      </form>
    </Card>
  );
}
