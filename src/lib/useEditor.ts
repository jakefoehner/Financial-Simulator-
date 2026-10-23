import { useCallback, useRef, useState } from "react";
import { useApp } from "./store";
import type { Household, Id } from "./types";

/**
 * State for a create/edit sheet: a draft copy of one record plus save/delete
 * wired to the app store. `draft === null` means the sheet is closed.
 */
export function useEditor<T extends { id: Id | null }>(ops: {
  save: (item: T) => Promise<Household>;
  remove: (id: Id) => Promise<Household>;
}) {
  const mutate = useApp((s) => s.mutate);
  const [draft, setDraft] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Save reads the latest draft through a ref, because the sheet calls it on
  // the tick after a field's final blur/commit (see Sheet's onSubmit).
  const latest = useRef(draft);
  latest.current = draft;

  const open = useCallback((item: T) => {
    setDraft(structuredClone(item));
    setError(null);
  }, []);
  const close = useCallback(() => setDraft(null), []);

  const set = <K extends keyof T>(key: K, value: T[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const patch = (p: Partial<T>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const run = async (op: () => Promise<Household>) => {
    setSaving(true);
    setError(null);
    try {
      await mutate(op);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return {
    draft,
    isNew: draft?.id == null,
    error,
    saving,
    open,
    close,
    set,
    patch,
    save: () => {
      const d = latest.current;
      if (d) void run(() => ops.save(d));
    },
    remove: () => {
      const id = latest.current?.id;
      if (id != null) void run(() => ops.remove(id));
    },
  };
}
