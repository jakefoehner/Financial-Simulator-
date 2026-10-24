import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { highlight } from "../lib/search";
import { useApp } from "../lib/store";

/**
 * A search field for a list. `scope` names the page; its text is remembered while the app
 * is open. ⌘F focuses it and Esc clears it (when `shortcut` is on; one per screen).
 */
export function SearchBox({
  scope,
  placeholder,
  shortcut = true,
  autoFocus,
  onEnter,
}: {
  scope: string;
  placeholder: string;
  shortcut?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const query = useApp((s) => s.searches[scope] ?? "");
  const setSearch = useApp((s) => s.setSearch);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--muted)]" />
      <input
        ref={ref}
        type="search"
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setSearch(scope, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setSearch(scope, "");
          }
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 pr-16 pl-8 text-sm outline-none focus:border-accent [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          aria-label="Clear search"
          onClick={() => {
            setSearch(scope, "");
            ref.current?.focus();
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"
        >
          <X size={14} />
        </button>
      ) : (
        shortcut && (
          <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-[var(--muted)]">
            ⌘F
          </kbd>
        )
      )}
    </div>
  );
}

/** `text` with the words of `query` highlighted. */
export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-amber-300/60 px-px text-inherit dark:bg-amber-400/35">
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
