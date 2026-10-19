const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatUsd(value: number): string {
  return usd.format(Math.round(value));
}

/** Compact form for KPI tiles and axes: $1.2M, $850K, $900. */
export function formatUsdCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}$${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${trim(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function trim(n: number): string {
  return n >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, "");
}

/** Parse user-typed money like "$1,250,000" or "1.2m". Returns NaN when unparseable. */
export function parseUsd(input: string): number {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[$,\s]/g, "");
  const m = s.match(/^(-?\d*\.?\d+)([kmb])?$/);
  if (!m) return NaN;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2] as "k" | "m" | "b"] ?? 1;
  return Number(m[1]) * mult;
}
