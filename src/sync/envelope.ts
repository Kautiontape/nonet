/**
 * The envelope a backup file and the cloud copy share: every saved value by key, under a header
 * that says what it is and which version of the app wrote it.
 */
import { isRecord } from "./equal";
import { sumCounters } from "./progress";

export interface Backup {
  app: "nonet";
  version: number;
  /** When it was made (ISO 8601). */
  exported: string;
  /** Each saved value by its key (without the store's prefix). */
  data: Record<string, unknown>;
}

/** 1: everything as saved. 2: progress keeps counts per device; a cleared game leaves a tombstone. */
export const BACKUP_VERSION = 2;

export function makeEnvelope(data: Record<string, unknown>, now = new Date()): Backup {
  return { app: "nonet", version: BACKUP_VERSION, exported: now.toISOString(), data };
}

/**
 * Read an envelope's text. "newer" when a later version of the app wrote it (the caller must
 * leave it alone), null when it isn't one at all.
 */
export function readEnvelope(text: string): Backup | "newer" | null {
  let b: unknown;
  try {
    b = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(b) || b.app !== "nonet" || typeof b.version !== "number" || !isRecord(b.data)) return null;
  if (b.version > BACKUP_VERSION) return "newer";
  return { app: "nonet", version: b.version, exported: typeof b.exported === "string" ? b.exported : "", data: b.data };
}

/** Read a backup file's text: null if it isn't a backup this version can restore. */
export function parseBackup(text: string): Backup | null {
  const b = readEnvelope(text);
  return b === "newer" ? null : b;
}

/** Total solves recorded in a backup, if it has any progress (either version's shape). */
export function backupSolved(b: Backup): number {
  const p = b.data.progress;
  if (!isRecord(p)) return 0;
  let total = typeof p.total === "number" ? p.total : 0;
  if (isRecord(p.counters)) {
    const counters = Object.fromEntries(
      Object.entries(p.counters)
        .filter((e): e is [string, Record<string, unknown>] => isRecord(e[1]))
        .map(([d, c]) => [d, { total: typeof c.total === "number" ? c.total : 0, hinted: {} }]),
    );
    total += sumCounters(counters).total;
  }
  return total;
}
