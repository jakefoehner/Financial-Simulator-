import { useEffect, useState } from "react";
import { Button, Card } from "../../components/Card";
import { PercentField, SelectField, Toggle } from "../../components/fields";
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
