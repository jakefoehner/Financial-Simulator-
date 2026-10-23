import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatUsd, formatUsdCompact } from "../lib/format";
import type { FanRow } from "../lib/simulation";

const LEGEND = [
  { swatch: "var(--band-outer)", label: "8 in 10 scenarios fall in here" },
  { swatch: "var(--band-inner)", label: "Middle half" },
];

/** Range of spendable savings by age: 10–90th and 25–75th percentile bands plus the median. */
export function FanChart({ rows }: { rows: FanRow[] }) {
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]" aria-label="Legend">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.swatch }} />
            {l.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded" style={{ background: "var(--band-median)" }} />
          Typical (median)
        </li>
      </ul>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
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
                const r = payload[0].payload as FanRow;
                const rowsOut: [string, number][] = [
                  ["Strong (1 in 10)", r.outer[1]],
                  ["Better than typical", r.inner[1]],
                  ["Typical", r.median],
                  ["Worse than typical", r.inner[0]],
                  ["Rough (1 in 10)", r.outer[0]],
                ];
                return (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-lg">
                    <p className="mb-1 font-medium">
                      Age {r.age} · {r.year}
                    </p>
                    <table className="tabular-nums">
                      <tbody>
                        {rowsOut.map(([label, v]) => (
                          <tr key={label} className={label === "Typical" ? "font-medium" : ""}>
                            <td className="pr-3 text-[var(--muted)]">{label}</td>
                            <td className="text-right">{formatUsd(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }}
            />
            <Area
              type="linear"
              dataKey="outer"
              fill="var(--band-outer)"
              fillOpacity={1}
              stroke="none"
              isAnimationActive={false}
              activeDot={false}
            />
            <Area
              type="linear"
              dataKey="inner"
              fill="var(--band-inner)"
              fillOpacity={1}
              stroke="none"
              isAnimationActive={false}
              activeDot={false}
            />
            <Line
              type="linear"
              dataKey="median"
              stroke="var(--band-median)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "var(--band-median)", stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
