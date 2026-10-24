import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./Card";

/**
 * A macOS-style sheet for creating/editing one record.
 * Enter submits, Escape cancels. Delete asks for confirmation inline.
 */
export function Sheet({
  title,
  error,
  saving,
  onSave,
  onCancel,
  onDelete,
  deleteLabel = "Delete",
  saveLabel = "Save",
  savingLabel = "Saving…",
  deleteWarning,
  children,
}: {
  title: string;
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Present only when editing an existing record. */
  onDelete?: () => void;
  deleteLabel?: string;
  saveLabel?: string;
  savingLabel?: string;
  deleteWarning?: string;
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-16 backdrop-blur-[2px]">
      <form
        role="dialog"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          // Blur first so a field being typed in commits its value, then save
          // on the next tick once that state update has rendered.
          (document.activeElement as HTMLElement | null)?.blur();
          setTimeout(onSave, 0);
        }}
        className="flex max-h-[calc(100vh-6rem)] w-[min(560px,92vw)] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      >
        <h2 className="border-b border-[var(--border)] px-6 py-4 text-base font-semibold">{title}</h2>
        <div className="grid gap-4 overflow-y-auto px-6 py-5">{children}</div>

        {error && (
          <p className="mx-6 mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex items-center gap-2 border-t border-[var(--border)] px-6 py-3">
          {onDelete &&
            (confirming ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-[var(--muted)]">{deleteWarning ?? "Delete this for good?"}</span>
                <Button variant="danger" onClick={onDelete} disabled={saving}>
                  Yes, delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {deleteLabel}
              </Button>
            ))}
          <div className="ml-auto flex gap-2">
            <Button onClick={onCancel}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? savingLabel : saveLabel}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** Small yes/no dialog for whole-page actions (e.g. replacing data with a demo). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-24 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        className="w-[min(420px,92vw)] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
