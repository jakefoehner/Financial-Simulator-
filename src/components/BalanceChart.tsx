import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatUsd, formatUsdCompact } from "../lib/format";
import { BALANCE_SERIES, type BalanceRow } from "../lib/projection";

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];

/** Stacked area of what the household owns, by tax treatment, across ages. */
export function BalanceChart({ rows }: { rows: BalanceRow[] }) {
  // Only show bands the household actually has, but keep each band's color fixed.
  const present = BALANCE_SERIES.map((s, i) => ({ ...s, color: COLORS[i] })).filter((s) =>
    rows.some((r) => r[s.key] > 0.5),
  );

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]" aria-label="Legend">
        {present.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5" title={s.hint}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis
              dataKey="age"
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--axis)" }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={formatUsdCompact}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as BalanceRow;
                return (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-lg">
                    <p className="mb-1 font-medium">
                      Age {r.age} · {r.year}
                    </p>
                    <table className="tabular-nums">
                      <tbody>
                        {[...present].reverse().map((s) => (
                          <tr key={s.key}>
                            <td className="pr-3">
                              <span
                                className="mr-1.5 inline-block h-2 w-2 rounded-sm"
                                style={{ background: s.color }}
                              />
                              <span className="text-[var(--muted)]">{s.label}</span>
                            </td>
                            <td className="text-right">{formatUsd(r[s.key])}</td>
                          </tr>
                        ))}
                        {r.debt > 0.5 && (
                          <tr>
                            <td className="pr-3 text-[var(--muted)]">Debts</td>
                            <td className="text-right">−{formatUsd(r.debt)}</td>
                          </tr>
                        )}
                        <tr className="border-t border-[var(--border)] font-medium">
                          <td className="pt-1 pr-3">Net worth</td>
                          <td className="pt-1 text-right">{formatUsd(r.netWorth)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              }}
            />
            {present.map((s) => (
              <Area
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.label}
                stackId="balances"
                fill={s.color}
                fillOpacity={1}
                // A surface-colored stroke is the 2px gap between stacked bands.
                stroke="var(--surface)"
                strokeWidth={2}
                isAnimationActive={false}
                activeDot={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
