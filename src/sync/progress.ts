/**
 * The stored shape of a player's progress, shared by the store (which reads and writes it) and
 * the merge (which joins two copies). Solve, hint and level counts are kept per device: two
 * devices' counts then add up, and merging takes the larger figure per device, which is exact.
 */
import { isRecord } from "./equal";
import { v1Solves } from "./v1";

export interface Counters {
  /** Puzzles finished on this device (replays count). */
  total: number;
  /** Hint steps applied per technique id. */
  hinted: Record<string, number>;
}

export interface Streak {
  /** The last day with a solve, as YYYY-MM-DD. */
  last: string;
  days: number;
}

export interface ProgressRecord {
  /** Solved puzzle ids per "mode-difficulty". */
  solved: Record<string, string[]>;
  /** Best time (ms) per "mode-difficulty". */
  best: Record<string, number>;
  streak: Streak;
  counters: Record<string, Counters>;
  /**
   * Levels finished per device, per "mode-difficulty" (replays count). Its own field, not part of
   * `counters`: 0.3 rebuilds each device's counters as `{ total, hinted }` and would drop it.
   */
  levels: Record<string, Record<string, number>>;
}

export const EMPTY_COUNTERS: Counters = { total: 0, hinted: {} };

const numberMap = (v: unknown): Record<string, number> =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number")) : {};

function readLevels(v: unknown): Record<string, Record<string, number>> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(Object.entries(v).flatMap(([device, counts]) => (isRecord(counts) ? [[device, numberMap(counts)]] : [])));
}

function readCounters(v: unknown): Record<string, Counters> {
  if (!isRecord(v)) return {};
  const out: Record<string, Counters> = {};
  for (const [device, c] of Object.entries(v)) {
    if (!isRecord(c)) continue;
    out[device] = { total: typeof c.total === "number" ? c.total : 0, hinted: numberMap(c.hinted) };
  }
  return out;
}

/**
 * A stored progress, whatever version wrote it. A record from before per-device counters kept
 * `total` and `hinted` at the top; those become this device's counts (added to any it has).
 * `legacy` says that happened, so the caller saves the record in the new shape.
 */
export function normalizeProgress(raw: unknown, deviceId: string): { progress: ProgressRecord; legacy: boolean } {
  const p = isRecord(raw) ? raw : {};
  const counters = readCounters(p.counters);
  const legacy = "total" in p || "hinted" in p;
  if (legacy) {
    const mine = counters[deviceId] ?? EMPTY_COUNTERS;
    const total = typeof p.total === "number" ? p.total : 0;
    const hinted = numberMap(p.hinted);
    counters[deviceId] = { total: mine.total + total, hinted: addCounts(mine.hinted, hinted) };
  }
  const streak = isRecord(p.streak) ? p.streak : {};
  return {
    progress: {
      solved: isRecord(p.solved) ? Object.fromEntries(Object.entries(p.solved).filter((e): e is [string, string[]] => Array.isArray(e[1]))) : {},
      best: numberMap(p.best),
      streak: { last: typeof streak.last === "string" ? streak.last : "", days: typeof streak.days === "number" ? streak.days : 0 },
      counters,
      levels: readLevels(p.levels),
    },
    legacy,
  };
}

export function addCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
}

/** Every device's counts added together: what the screens show. */
export function sumCounters(counters: Record<string, Counters>): Counters {
  let total = 0;
  let hinted: Record<string, number> = {};
  for (const c of Object.values(counters)) {
    total += c.total;
    hinted = addCounts(hinted, c.hinted);
  }
  return { total, hinted };
}

/**
 * Levels beaten per "mode-difficulty", for the level number and the solved counts: every device's
 * count, plus the v1 boards solved before levels were counted.
 */
export function levelsBeaten(p: Pick<ProgressRecord, "solved" | "levels">): Record<string, number> {
  let out: Record<string, number> = {};
  for (const [key, ids] of Object.entries(p.solved)) {
    const n = v1Solves(ids);
    if (n) out[key] = n;
  }
  for (const counts of Object.values(p.levels)) out = addCounts(out, counts);
  return out;
}
