import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { activeHousehold, useApp } from "../lib/store";

/**
 * Whose finances are on screen: yours, or one of your children's households.
 * Children get a household from your People page ("Build Sam's household").
 */
export function HouseholdSwitcher() {
  const family = useApp((s) => s.family);
  const switchHousehold = useApp((s) => s.switchHousehold);
  const go = useApp((s) => s.go);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const active = activeHousehold(family);
  if (!family || !active) return null;
  const [mine, ...children] = family.households;
  const unbuilt = family.children.filter((c) => c.householdId == null);

  const pick = async (id: number | null) => {
    setOpen(false);
    setError(null);
    try {
      await switchHousehold(id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div ref={ref} className="relative mb-4 px-1">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-sm shadow-sm"
      >
        <span className="min-w-0">
          <span className="block text-[11px] text-[var(--muted)]">
            {active.id == null ? "Your household" : "Child's household"}
          </span>
          <span className="block truncate font-medium">{active.name}</span>
        </span>
        <ChevronDown size={14} className="shrink-0 text-[var(--muted)]" />
      </button>
      {error && <p className="mt-1 px-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {open && (
        <div
          role="listbox"
          className="absolute inset-x-1 top-full z-40 mt-1 grid gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
        >
          {[mine, ...children].map((h) => (
            <button
              key={String(h.id)}
              role="option"
              aria-selected={h.active}
              onClick={() => void pick(h.id)}
              className={`flex items-center justify-between rounded-md px-3 py-1.5 text-left text-sm ${
                h.active ? "bg-accent text-white" : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              <span className="truncate">{h.name}</span>
              <span className={`text-[11px] ${h.active ? "text-white/80" : "text-[var(--muted)]"}`}>
                {h.id == null ? "You" : h.linkedPersonId != null ? "Linked" : ""}
              </span>
            </button>
          ))}
          {unbuilt.length > 0 && (
            <button
              onClick={() => {
                setOpen(false);
                void switchHousehold(null).then(() => go("people"));
              }}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-accent hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Plus size={14} /> Build a child's household
            </button>
          )}
        </div>
      )}
    </div>
  );
}
