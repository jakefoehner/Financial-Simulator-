import { Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatPercent } from "../lib/format";
import { DATA_SOURCES, methodSummary, scaledStockReturn, THRESHOLDS } from "../lib/simulation";
import type { Assumptions } from "../lib/types";
import { Button } from "./Card";

/**
 * Always-visible explanation of how the range of outcomes is built, with a
 * "How this works" panel holding the full reasoning. Keep this in sync with
 * README "How the forecast works" and engine/src/history.rs.
 */
export function MethodNote({ assumptions, scenarios }: { assumptions: Assumptions; scenarios: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-start gap-2 rounded-lg bg-accent/5 px-3 py-2 text-xs text-[var(--muted)]">
        <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <p>
          {methodSummary(assumptions, scenarios, formatPercent)}{" "}
          <button className="font-medium text-accent hover:underline" onClick={() => setOpen(true)}>
            How this works
          </button>
        </p>
      </div>
      {open && <MethodPanel assumptions={assumptions} onClose={() => setOpen(false)} />}
    </>
  );
}

function MethodPanel({ assumptions: a, onClose }: { assumptions: Assumptions; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pct = formatPercent;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-12 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-label="How the range of outcomes works"
        className="flex max-h-[calc(100vh-5rem)] w-[min(640px,92vw)] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold">How the range of outcomes works</h2>
          <button aria-label="Close" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-4 overflow-y-auto px-6 py-5 text-sm leading-relaxed">
          <Section title="Real market history, reshuffled">
            Each scenario strings together real years from 1928–2025, like the 1931 crash, 1970s inflation, the 1990s
            boom, and 2008, picked at random in runs of 5 consecutive years. Multi-year slumps such as 1929–32 or
            2000–02 stay intact. Crashes land in different places in different scenarios, which shows how much the
            timing matters: a crash in your first years of retirement does more damage than one at 90.
          </Section>
          <Section title={`Scaled to your Assumptions (${pct(a.stocksReturn)} stocks)`}>
            US stocks actually grew about 10% a year over that period. Every replayed year is scaled down by the same
            proportion so the long-run average matches your Assumptions: {pct(a.stocksReturn)} stocks,{" "}
            {pct(a.bondsReturn)} bonds, {pct(a.cashReturn)} cash, {pct(a.realEstateGrowth)} real estate. Crashes keep
            their size: 2008's −37% becomes {pct(scaledStockReturn(-0.3655, a.stocksReturn), 0)}. Why scale down? Most
            long-term forecasts for the coming decade are below past averages, real accounts pay fees, the US was the
            best-performing market of the last century, and when you are deciding how much to give away, being too
            optimistic is the costly mistake. To see unadjusted history, set stocks to 10%.
          </Section>
          <Section title="Inflation">
            {a.steadyInflation
              ? `Inflation is held at a steady ${pct(a.inflation)} a year in every scenario (you turned this on in Assumptions).`
              : `Inflation is replayed from the same years as the markets, so a 1970s stretch brings 1970s-style price increases, scaled so it averages ${pct(a.inflation)} a year. Spending, Social Security, and tax brackets all rise with it.`}
          </Section>
          <Section title='What "1 in 10" means'>
            "Rough markets" is the scenario that did worse than 9 out of 10 others; "typical" is the middle one. The
            shaded band shows where 8 in 10 scenarios land at each age. "Money lasts" means every year's spending,
            taxes, and debt payments were paid. "Living off growth & income" means you ended with at least as much
            spendable savings as today, after inflation.
          </Section>
          <Section title="Limits to keep in mind">
            No single year can be worse than the worst in history (1931: stocks −43.8%). It's US history only. All
            stocks move with the overall market for now; individual stocks, which swing more, will get their own risk
            model later. Taxes follow current federal law, adjusted for inflation.
          </Section>
          <Section title="How results are colored and flagged">
            "Chance the money lasts" shows a check at {pct(THRESHOLDS.moneyLasts.good, 0)} or more, a caution sign from{" "}
            {pct(THRESHOLDS.moneyLasts.caution, 0)}, and an alert below that. "Chance you live off growth & income" is a
            stricter goal, so it shows a check at {pct(THRESHOLDS.livesOffGrowth.good, 0)} or more and a caution sign
            from {pct(THRESHOLDS.livesOffGrowth.caution, 0)}. When you zoom in on a scenario, a year is flagged as a big
            stock drop when stocks fall {pct(-THRESHOLDS.crash, 0)} or more, and as high inflation when prices rise{" "}
            {pct(THRESHOLDS.highInflation, 0)} or more (both after scaling to your Assumptions).
          </Section>
          <Section title="The data">
            Market returns: {DATA_SOURCES.returns}: {DATA_SOURCES.returnsSeries}, 1928–2025. Inflation:{" "}
            {DATA_SOURCES.inflation}. {DATA_SOURCES.checks} {DATA_SOURCES.quirk}
          </Section>
        </div>
        <div className="flex justify-end border-t border-[var(--border)] px-6 py-3">
          <Button variant="primary" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <p className="text-[var(--muted)]">{children}</p>
    </section>
  );
}
