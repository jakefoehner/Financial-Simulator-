import { useEffect, useId, useState, type ReactNode } from "react";
import { formatUsd, parseUsd } from "../lib/format";

export const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

/** Label + control + optional hint, laid out the same everywhere. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-medium text-[var(--muted)]">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          className={inputClass}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * Free-typed text that is parsed on blur. Shows the formatted value when not
 * editing. `null` means blank (only allowed when `optional`).
 */
function ParsedInput({
  id,
  value,
  onChange,
  format,
  parse,
  optional,
  placeholder,
  suffix,
}: {
  id: string;
  value: number | null;
  onChange: (v: number | null) => void;
  format: (v: number) => string;
  parse: (s: string) => number;
  optional?: boolean;
  placeholder?: string;
  suffix?: string;
}) {
  const shown = value == null ? "" : format(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  const commit = () => {
    setEditing(false);
    if (text.trim() === "") {
      onChange(optional ? null : 0);
      return;
    }
    const n = parse(text);
    if (Number.isNaN(n)) setText(shown);
    else onChange(n);
  };

  return (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        className={`${inputClass} ${suffix ? "pr-8" : ""}`}
        value={text}
        placeholder={placeholder}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-[var(--muted)]">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function MoneyField({
  label,
  hint,
  value,
  onChange,
  optional,
  placeholder = "$0",
}: {
  label: string;
  hint?: ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  optional?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <ParsedInput
          id={id}
          value={value}
          onChange={onChange}
          format={formatUsd}
          parse={parseUsd}
          optional={optional}
          placeholder={placeholder}
        />
      )}
    </Field>
  );
}

/** Edits a decimal rate (0.07) as a percentage (7). */
export function PercentField({
  label,
  hint,
  value,
  onChange,
  decimals = 2,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  decimals?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <ParsedInput
          id={id}
          value={value}
          onChange={(v) => onChange(v ?? 0)}
          format={(v) => formatPercentInput(v, decimals)}
          parse={(s) => Number(s.replace(/[%\s]/g, "")) / 100}
          suffix="%"
        />
      )}
    </Field>
  );
}

export function formatPercentInput(v: number, decimals: number): string {
  return String(Number((v * 100).toFixed(decimals)));
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  optional,
  placeholder,
}: {
  label: string;
  hint?: ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  optional?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <ParsedInput
          id={id}
          value={value}
          onChange={onChange}
          format={String}
          parse={(s) => (/^\s*-?\d+\s*$/.test(s) ? Number(s) : NaN)}
          optional={optional}
          placeholder={placeholder}
        />
      )}
    </Field>
  );
}

export function SelectField<T extends string | number>({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; group?: string }[];
}) {
  const groups = [...new Set(options.map((o) => o.group))];
  const render = (opts: typeof options) =>
    opts.map((o) => (
      <option key={String(o.value)} value={String(o.value)}>
        {o.label}
      </option>
    ));
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select
          id={id}
          className={inputClass}
          value={String(value)}
          onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}
        >
          {groups.length > 1 || groups[0] !== undefined
            ? groups.map((g) => (
                <optgroup key={g ?? ""} label={g ?? ""}>
                  {render(options.filter((o) => o.group === g))}
                </optgroup>
              ))
            : render(options)}
        </select>
      )}
    </Field>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${checked ? "bg-accent" : "bg-black/20 dark:bg-white/20"}`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </button>
      <span className="grid gap-0.5">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-[var(--muted)]">{hint}</span>}
      </span>
    </label>
  );
}
