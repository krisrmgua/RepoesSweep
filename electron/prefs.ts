import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { prefsPath } from "./paths";
import { SCAN_CHOICES, type Prefs } from "./types";

const SECTIONS = ["Out of date", "Cleanup", "Remote branches"];

export const DEFAULT_PREFS: Prefs = {
  greenForPassing: true,
  showRemoteBranches: true,
  showOnlyMyRemoteBranches: true,
  rememberExpanded: false,
  expandedSections: [],
  scanMinutes: 10,
  openAtLogin: true,
};

function sanitize(input: Partial<Prefs>, base: Prefs): Prefs {
  const out: Prefs = { ...base };
  for (const key of [
    "greenForPassing",
    "showRemoteBranches",
    "showOnlyMyRemoteBranches",
    "rememberExpanded",
    "openAtLogin",
  ] as const) {
    const value = input[key];
    if (typeof value === "boolean") out[key] = value;
  }
  if (Array.isArray(input.expandedSections)) {
    out.expandedSections = input.expandedSections.filter((s) => SECTIONS.includes(s));
  }
  if (typeof input.scanMinutes === "number" && SCAN_CHOICES.includes(input.scanMinutes)) {
    out.scanMinutes = input.scanMinutes;
  }
  return out;
}

/**
 * The Swift app kept prefs in UserDefaults under com.kris.repos. On the first
 * Electron launch on macOS, carry those values over once.
 */
function fromSwiftDefaults(): Partial<Prefs> {
  if (process.platform !== "darwin") return {};
  const read = (key: string): string | undefined => {
    try {
      return execFileSync("/usr/bin/defaults", ["read", "com.kris.repos", key], {
        encoding: "utf8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return undefined;
    }
  };
  const bool = (key: string): boolean | undefined => {
    const v = read(key);
    return v === "1" ? true : v === "0" ? false : undefined;
  };
  const minutes = Number(read("repos.scanMinutes"));
  const out: Partial<Prefs> = {
    greenForPassing: bool("repos.greenForPassing"),
    showRemoteBranches: bool("repos.showRemoteBranches"),
    showOnlyMyRemoteBranches: bool("repos.showOnlyMyRemoteBranches"),
    rememberExpanded: bool("repos.rememberExpanded"),
  };
  if (Number.isFinite(minutes)) out.scanMinutes = minutes;
  return out;
}

export class PrefsStore {
  private data: Prefs;
  private listeners = new Set<(prev: Prefs, next: Prefs) => void>();

  constructor() {
    this.data = this.load();
  }

  private load(): Prefs {
    try {
      const raw = JSON.parse(fs.readFileSync(prefsPath(), "utf8")) as Partial<Prefs>;
      return sanitize(raw, DEFAULT_PREFS);
    } catch {
      const migrated = sanitize(fromSwiftDefaults(), DEFAULT_PREFS);
      this.write(migrated);
      return migrated;
    }
  }

  private write(prefs: Prefs): void {
    try {
      fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      // prefs are best-effort; the app keeps running with in-memory values
    }
  }

  get(): Prefs {
    return structuredClone(this.data);
  }

  update(partial: Partial<Prefs>): Prefs {
    const prev = this.data;
    this.data = sanitize(partial, prev);
    this.write(this.data);
    for (const listener of this.listeners) listener(prev, this.get());
    return this.get();
  }

  onChange(listener: (prev: Prefs, next: Prefs) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
