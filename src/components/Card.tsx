import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:brightness-110",
  secondary: "border border-[var(--border)] bg-[var(--surface)] hover:bg-black/5 dark:hover:bg-white/10",
  danger: "text-red-600 hover:bg-red-500/10 dark:text-red-400",
  ghost: "text-accent hover:bg-accent/10",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted)]">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** A clickable list of records; each row opens its editor. */
export function RecordList<T>({
  items,
  rowKey,
  onSelect,
  columns,
}: {
  items: T[];
  rowKey: (item: T) => string | number;
  onSelect: (item: T) => void;
  columns: { header: string; align?: "left" | "right"; cell: (item: T) => ReactNode }[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-[var(--muted)]">
            {columns.map((c) => (
              <th
                key={c.header}
                className={`px-4 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={rowKey(item)}
              onClick={() => onSelect(item)}
              className="cursor-pointer border-t border-[var(--border)] hover:bg-black/[0.03] dark:hover:bg-white/5"
            >
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={`px-4 py-2.5 ${c.align === "right" ? "text-right tabular-nums" : "text-left"}`}
                >
                  {c.cell(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
