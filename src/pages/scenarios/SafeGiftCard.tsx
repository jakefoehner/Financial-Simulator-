import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card } from "../../components/Card";
import { NumberField } from "../../components/fields";
import { api } from "../../lib/api";
import { formatUsd, formatUsdCompact } from "../../lib/format";
import { safeGiftSentence, type SafeGiftResult } from "../../lib/simulation";
import { useApp } from "../../lib/store";
import { currentYear, type Household, type Id } from "../../lib/types";
import { Segmented } from "../forecast/shared";
import { planName } from "./Compare";

const TARGETS = [0.9, 0.95, 0.98];

/** "How much can I safely give?" — the largest gift that keeps her odds at a target. */
export default function SafeGiftCard({ household }: { household: Household }) {
  const mutate = useApp((s) => s.mutate);
  const [from, setFrom] = useState<Id | null>(null);
  const [mode, setMode] = useState<"now" | "yearly">("now");
  const [years, setYears] = useState(10);
  const [target, setTarget] = useState(0.95);
  const [result, setResult] = useState<SafeGiftResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const kids = household.people.filter((p) => p.role === "child");
  const primary = household.people.find((p) => p.role === "primary");
  const endAge = primary?.lifeExpectancy ?? 100;

  useEffect(() => {
    if (kids.length === 0 || !primary) return;
    let cancelled = false;
    setBusy(true);
    setSaved(false);
    setError(null);
    api
      .safeGift(currentYear(), from, { yearly: mode === "yearly", years, target })
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // `household` changes after every edit; rerun so the answer stays current.
  }, [household, from, mode, years, target, kids.length, primary]);

  if (!primary) return null;
  if (kids.length === 0) {
    return (
      <Card title="How much can you safely give?">
        <p className="text-sm text-[var(--muted)]">Add your children on the People page to see this.</p>
      </Card>
    );
  }

  const makePlan = async () => {
    if (!result || !result.achievable || result.maxPerChild <= 0) return;
    const base = from == null ? [] : (household.scenarios.find((s) => s.id === from)?.events ?? []);
    const amount = formatUsdCompact(result.maxPerChild);
    await mutate(() =>
      api.saveScenario({
        id: null,
        name: result.yearly ? `Give ${amount} a year to each child` : `Give ${amount} to each child now`,
        notes: `From "How much can you safely give?" at a ${Math.round(target * 100)}% target, starting from ${planName(household, from)}. Gifts are cash from savings; edit the plan to give stock instead.`,
        events: [
          ...base,
          {
            type: "cash_gift",
            to: null,
            amount: result.maxPerChild,
            fromAge: result.age,
            years: result.yearly ? result.years : 1,
            maxAnnualExclusion: false,
          },
        ],
      }),
    );
    setSaved(true);
  };

  const zero = result?.curve[0];
  // Zoom the odds axis to where the curve and target are (e.g. 80–100%), in 5-point steps.
  const low = result
    ? Math.max(0, Math.floor((Math.min(result.target, ...result.curve.map((p) => p.moneyLasts)) - 0.05) * 20) / 20)
    : 0;
  return (
    <Card title="How much can you safely give?">
      <div className="mb-4 flex flex-wrap items-end gap-4 text-sm">
        <Segmented<"now" | "yearly">
          value={mode}
          onChange={setMode}
          options={[
            { id: "now", label: "One gift now" },
            { id: "yearly", label: "Every year" },
          ]}
        />
        {mode === "yearly" && (
          <div className="w-28">
            <NumberField
              label="For (years)"
              value={years}
              onChange={(v) => setYears(Math.min(40, Math.max(1, v ?? 10)))}
            />
          </div>
        )}
        <label className="grid gap-1 text-xs text-[var(--muted)]">
          Keep a chance of the money lasting of
          <select
            className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm text-[var(--text)]"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          >
            {TARGETS.map((t) => (
              <option key={t} value={t}>
                {Math.round(t * 100)}%
              </option>
            ))}
          </select>
        </label>
        {household.scenarios.length > 0 && (
          <label className="grid gap-1 text-xs text-[var(--muted)]">
            On top of
            <select
              className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm text-[var(--text)]"
              value={from ?? 0}
              onChange={(e) => setFrom(Number(e.target.value) || null)}
            >
              <option value={0}>Base plan</option>
              {household.scenarios.map((s) => (
                <option key={s.id} value={s.id!}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <p className="text-sm text-[var(--critical)]">{error}</p>}
      {busy && !result && <p className="text-sm text-[var(--muted)]">Working it out…</p>}
      {result && (
        <div className={busy ? "opacity-60 transition" : "transition"}>
          <p className="text-lg font-semibold tracking-tight">{safeGiftSentence(result, formatUsdCompact, endAge)}</p>
          {result.achievable && zero && result.maxPerChild > 0 && (
            <p className="mt-1 text-sm text-[var(--muted)]">
              At that amount, your kids would receive about {formatUsdCompact(result.atMax.familyTotalP50)} in all
              (typical markets) instead of {formatUsdCompact(zero.familyTotalP50)}, and estate tax falls from{" "}
              {formatUsdCompact(zero.estateTaxP50)} to {formatUsdCompact(result.atMax.estateTaxP50)}. Your chance the
              money lasts goes from {Math.round(result.baseMoneyLasts * 100)}% to{" "}
              {Math.round(result.atMax.moneyLasts * 100)}%.
            </p>
          )}

          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.curve} margin={{ top: 8, right: 8, bottom: 12, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis
                  dataKey="perChild"
                  type="number"
                  domain={[0, "dataMax"]}
                  tickFormatter={formatUsdCompact}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--axis)" }}
                  label={{
                    value: result.yearly ? "Gift to each child, each year" : "Gift to each child now",
                    position: "insideBottom",
                    offset: -8,
                    fill: "var(--muted)",
                    fontSize: 11,
                  }}
                  height={36}
                />
                <YAxis
                  domain={[low, 1]}
                  tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <ReferenceLine y={result.target} stroke="var(--muted)" strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as SafeGiftResult["curve"][number];
                    return (
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-lg tabular-nums">
                        <p className="mb-1 font-medium">{formatUsd(p.perChild)} to each child</p>
                        <p>Chance your money lasts: {Math.round(p.moneyLasts * 100)}%</p>
                        <p className="text-[var(--muted)]">
                          Kids receive (typical): {formatUsdCompact(p.familyTotalP50)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="moneyLasts"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--series-1)", stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Chance your money lasts, by gift size. The dashed line is your target. Gifts here are cash split evenly
            between your children; it runs your full range of market scenarios on {planName(household, from)}.
          </p>

          {result.achievable && result.maxPerChild > 0 && (
            <div className="mt-3 flex items-center justify-end gap-3">
              {saved && <span className="text-xs text-[var(--muted)]">Saved as a new plan below.</span>}
              <Button variant="primary" onClick={makePlan} disabled={saved}>
                Make this a plan
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
