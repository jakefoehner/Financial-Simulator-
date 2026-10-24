import { describe, expect, it } from "vitest";
import type { BackupInfo } from "./api";
import { backupContents, defaultBackupName, friendlyPath, passwordProblem, savedAtLabel } from "./backup";

const info: BackupInfo = {
  appVersion: "0.5.0",
  savedAt: "2026-10-24T14:30:00-05:00",
  formatVersion: 1,
  encrypted: false,
  householdName: "Pat",
  people: 3,
  children: 2,
  accounts: 10,
  income: 1,
  debts: 1,
  plans: 9,
  households: ["Pat"],
};

describe("backup helpers", () => {
  it("names files by household and date, without characters macOS dislikes", () => {
    expect(defaultBackupName("Smith family", new Date(2026, 9, 4))).toBe(
      "Finance Simulator – Smith family – 2026-10-04.fsim",
    );
    expect(defaultBackupName("A/B: C", new Date(2026, 0, 1))).toBe("Finance Simulator – A-B- C – 2026-01-01.fsim");
    expect(defaultBackupName("  ", new Date(2026, 0, 1))).toContain("My Household");
  });

  it("summarizes what's inside", () => {
    expect(backupContents(info)).toBe("3 people (2 children) · 10 accounts · 1 income source · 1 debt · 9 plans");
    expect(backupContents({ ...info, people: 1, children: 0, plans: 1 })).toContain("1 person · ");
  });

  it("formats the saved time, or nothing when unknown", () => {
    expect(savedAtLabel(info.savedAt)).toMatch(/^October 24, 2026 at /);
    expect(savedAtLabel("")).toBeNull();
    expect(savedAtLabel("not a date")).toBeNull();
  });

  it("shows folders readably", () => {
    expect(friendlyPath("/Users/mom/Library/Mobile Documents/com~apple~CloudDocs/Finance Simulator backups")).toBe(
      "iCloud Drive › Finance Simulator backups",
    );
    expect(friendlyPath("/Users/mom/Documents/Backups")).toBe("~/Documents/Backups");
  });

  it("checks passwords", () => {
    expect(passwordProblem("", "")).toBeNull();
    expect(passwordProblem("short", "short")).toMatch(/8 characters/);
    expect(passwordProblem("long enough", "long enougH")).toMatch(/match/);
    expect(passwordProblem("long enough", "long enough")).toBeNull();
  });
});
