// Display helpers for backup files (`.fsim`). The format itself is in src-tauri/src/backup.rs.
import type { BackupInfo } from "./api";

export const BACKUP_EXTENSION = "fsim";
export const BACKUP_FILTERS = [{ name: "Finance Simulator backup", extensions: [BACKUP_EXTENSION] }];

/** "Finance Simulator – Smith family – 2026-10-24.fsim", safe for a file name. */
export function defaultBackupName(householdName: string, today: Date = new Date()): string {
  const name = householdName.replace(/[/\\:*?"<>|]/g, "-").trim() || "My Household";
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return `Finance Simulator – ${name} – ${date}.${BACKUP_EXTENSION}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 people (2 children) · 10 accounts · 4 income sources · 1 debt · 9 plans". */
export function backupContents(i: BackupInfo): string {
  const people =
    plural(i.people, "person", "people") + (i.children > 0 ? ` (${plural(i.children, "child", "children")})` : "");
  return [
    people,
    plural(i.accounts, "account"),
    plural(i.income, "income source"),
    plural(i.debts, "debt"),
    plural(i.plans, "plan"),
  ].join(" · ");
}

/** "October 24, 2026 at 2:30 PM", or null when unknown. */
export function savedAtLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} at ${time}`;
}

/** Why a password can't be used yet, or null when it's fine (empty = no password). */
export function passwordProblem(password: string, again: string): string | null {
  if (password === "") return null;
  if (password.length < 8) return "Use at least 8 characters.";
  if (password !== again) return "The two passwords don't match.";
  return null;
}

/** "iCloud Drive › Finance Simulator backups" or "~/Documents/Backups": a readable folder path. */
export function friendlyPath(path: string): string {
  const icloud = path.match(/^\/Users\/[^/]+\/Library\/Mobile Documents\/com~apple~CloudDocs(\/.*)?$/);
  if (icloud) return ["iCloud Drive", ...(icloud[1] ?? "").split("/").filter(Boolean)].join(" › ");
  return path.replace(/^\/Users\/[^/]+/, "~");
}
