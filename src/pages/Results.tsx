import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, PageHeader } from "../components/Card";
import type { DollarMode } from "../lib/projection";
import { useApp } from "../lib/store";
import { currentYear } from "../lib/types";
import AssumptionsCard from "./forecast/AssumptionsCard";
import RangeView from "./forecast/RangeView";
import { DollarToggle, Segmented } from "./forecast/shared";
import SteadyPath from "./forecast/SteadyPath";

type View = "range" | "steady";

export default function Results() {
  const household = useApp((s) => s.household!);
  const { go, plan, setPlan } = useApp();
  const [view, setView] = useState<View>("range");
  const [mode, setMode] = useState<DollarMode>("today");
  const [error, setError] = useState<string | null>(null);
  const onError = useCallback((e: string) => setError(e), []);
  const startYear = currentYear();

  // A new edit or a different plan gets a fresh attempt.
  useEffect(() => setError(null), [household, plan]);

  const needsPerson = household.people.every((p) => p.role !== "primary");
  if (needsPerson || error) {
    return (
      <>
        <PageHeader title="Forecast" />
        <EmptyState
          title={needsPerson ? "Add yourself first" : "Couldn't run the forecast"}
          body={needsPerson ? "Your age drives the whole forecast." : error!}
          action={needsPerson ? <Button onClick={() => go("people")}>Go to People</Button> : undefined}
        />
      </>
    );
  }

  const planName = plan == null ? "Base plan" : household.scenarios.find((s) => s.id === plan)?.name;

  return (
    <>
      <PageHeader
        title="Forecast"
        subtitle={
          (plan == null ? "" : `Plan: ${planName}. `) +
          (view === "range"
            ? "Thousands of possible futures built from real market history, with federal taxes paid along the way."
            : "One steady path: your Assumptions every single year, with federal taxes paid along the way.")
        }
        actions={
          <>
            {household.scenarios.length > 0 && (
              <select
                aria-label="Plan"
                value={plan ?? 0}
                onChange={(e) => setPlan(Number(e.target.value) || null)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
              >
                <option value={0}>Base plan</option>
                {household.scenarios.map((s) => (
                  <option key={s.id} value={s.id!}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <Segmented<View>
              value={view}
              onChange={setView}
              options={[
                { id: "range", label: "Range of outcomes" },
                { id: "steady", label: "Steady path" },
              ]}
            />
            <DollarToggle mode={mode} onChange={setMode} />
          </>
        }
      />
      <div className="grid gap-5">
        {view === "range" ? (
          <RangeView household={household} startYear={startYear} mode={mode} plan={plan} onError={onError} />
        ) : (
          <SteadyPath household={household} startYear={startYear} mode={mode} plan={plan} onError={onError} />
        )}
        <div id="assumptions">
          <AssumptionsCard assumptions={household.assumptions} />
        </div>
      </div>
    </>
  );
}
