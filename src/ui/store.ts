/**
 * Local persistence. Everything is saved in this browser (sync copies it elsewhere, see
 * `./sync.ts`); every access is guarded because storage can be unavailable (private windows,
 * blocked site data) and the game must still work.
 */
import type { Difficulty } from "../engine/types";
import type { Mode } from "../game/packs";
import { backupSolved, BACKUP_VERSION, makeEnvelope, parseBackup, type Backup } from "../sync/envelope";
import { RESULTS_MAX } from "../sync/merge";
import { EMPTY_COUNTERS, levelsBeaten, normalizeProgress, sumCounters, type ProgressRecord } from "../sync/progress";

export { backupSolved, BACKUP_VERSION, parseBackup, type Backup };

// From the game's first name, Cage Coach. Kept so existing saves and stats survive the rename.
const PREFIX = "cagecoach.";

// Set by a restore. The page is about to load again, and nothing the old page still holds (a
// game's autosave, the cached settings) may write over the backup before it goes.
let frozen = false;

type ChangeListener = (key: string) => void;
const listeners = new Set<ChangeListener>();

/** Called with the key after every `save` and `remove`, but not after a `saveQuiet`. */
export function onChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  if (frozen) return false;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    /* storage full or unavailable: keep playing */
    return false;
  }
}

export function save(key: string, value: unknown): void {
  if (write(key, value)) for (const fn of listeners) fn(key);
}

/** Save without telling listeners: for what sync brings in, so a pull never sets off a push. */
export function saveQuiet(key: string, value: unknown): void {
  write(key, value);
}

export function remove(key: string): void {
  if (frozen) return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    return;
  }
  for (const fn of listeners) fn(key);
}

let device: string | null = null;

/**
 * This browser's id, made once: progress counts are kept per device so that two devices' counts
 * add up. Left out of backups, so a restored backup counts as a new device from then on.
 */
export function deviceId(): string {
  if (device) return device;
  device = load<string | null>("device", null);
  if (!device) {
    device = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
    save("device", device);
  }
  return device;
}

/** Keys that describe this browser, not the player: never in a backup. */
const DEVICE_ONLY = new Set(["device"]);

/** The stored record plus the sums the screens show. */
export interface Progress extends ProgressRecord {
  /** Total puzzles solved, every device added up. */
  total: number;
  /** Hint steps applied per technique id, every device added up (for the Learn screen). */
  hinted: Record<string, number>;
  /** Levels beaten per "mode-difficulty", every device added up: the next level's number less one. */
  beaten: Record<string, number>;
}

const withSums = (p: ProgressRecord): Progress => ({ ...p, ...sumCounters(p.counters), beaten: levelsBeaten(p) });

export function loadProgress(): Progress {
  const { progress, legacy } = normalizeProgress(load<unknown>("progress", null), deviceId());
  // A record from before per-device counters is written once in the new shape.
  if (legacy) saveProgress(progress);
  return withSums(progress);
}

export function saveProgress(p: ProgressRecord): void {
  const { solved, best, streak, counters, levels } = p;
  save("progress", { solved, best, streak, counters, levels });
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function recordSolve(mode: string, difficulty: string, id: string, ms: number): Progress {
  const p = loadProgress();
  const key = `${mode}-${difficulty}`;
  const list = p.solved[key] ?? [];
  if (!list.includes(id)) list.push(id);
  p.solved[key] = list;
  if (!p.best[key] || ms < p.best[key]!) p.best[key] = ms;
  const mine = p.counters[deviceId()] ?? EMPTY_COUNTERS;
  p.counters[deviceId()] = { ...mine, total: mine.total + 1 };
  const levels = p.levels[deviceId()] ?? {};
  p.levels[deviceId()] = { ...levels, [key]: (levels[key] ?? 0) + 1 };
  const today = todayKey();
  if (p.streak.last !== today) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    p.streak = { last: today, days: p.streak.last === todayKey(y) ? p.streak.days + 1 : 1 };
  }
  saveProgress(p);
  return withSums(p);
}

/** One finished level, as the results banner and the Scores screen show it. */
export interface ResultEntry {
  mode: string;
  difficulty: string;
  id: string;
  level: number;
  time: number;
  mistakes: number;
  hints: number;
  /** No mistakes and no hints. */
  perfect: boolean;
  /** Beat the best time for this mode and difficulty. */
  record: boolean;
  /** The first solve at this mode and difficulty. */
  first: boolean;
  /** The best time before this solve, if there was one. */
  prevBest?: number;
  /** When it was solved (ms since the epoch). */
  at: number;
}

/** Finished levels, newest first. */
export function loadResults(): ResultEntry[] {
  return load<ResultEntry[]>("results", []);
}

/** Record a solved level: progress (solved list, best time, streak) plus the results history. */
export function finishPuzzle(
  r: Pick<ResultEntry, "mode" | "difficulty" | "id" | "level" | "time" | "mistakes" | "hints">,
  now = Date.now(),
): ResultEntry {
  const prevBest = loadProgress().best[`${r.mode}-${r.difficulty}`];
  recordSolve(r.mode, r.difficulty, r.id, r.time);
  const entry: ResultEntry = {
    ...r,
    perfect: r.mistakes === 0 && r.hints === 0,
    record: prevBest !== undefined && r.time < prevBest,
    first: prevBest === undefined,
    ...(prevBest !== undefined ? { prevBest } : {}),
    at: now,
  };
  save("results", [entry, ...loadResults()].slice(0, RESULTS_MAX));
  return entry;
}

export function recordHint(technique: string): void {
  const p = loadProgress();
  const mine = p.counters[deviceId()] ?? EMPTY_COUNTERS;
  p.counters[deviceId()] = { total: mine.total, hinted: { ...mine.hinted, [technique]: (mine.hinted[technique] ?? 0) + 1 } };
  saveProgress(p);
}

export interface SavedGame<S = unknown> {
  difficulty: Difficulty;
  /** Pack entry of the puzzle being played (so resuming never depends on pack contents). */
  entry: unknown;
  state: S;
  /** When it was last saved (ms since the epoch); saves from before sync have none. */
  savedAt?: number;
}

/** What a finished or abandoned game leaves in its slot, so another device's older save can't bring it back. */
export interface ClearedGame {
  clearedAt: number;
}

export function loadSaved<S>(mode: Mode): SavedGame<S> | null {
  const v = load<Partial<SavedGame<S>> | ClearedGame | null>(`game.${mode}`, null);
  return v && "state" in v && v.state !== undefined ? (v as SavedGame<S>) : null;
}
export function storeSaved(mode: Mode, game: SavedGame, now = Date.now()): void {
  save(`game.${mode}`, { ...game, savedAt: now });
}
export function clearSaved(mode: Mode, now = Date.now()): void {
  save(`game.${mode}`, { clearedAt: now } satisfies ClearedGame);
}

/** Show a one-time tip: returns true the first time a key is seen. */
export function firstTime(key: string): boolean {
  const seen = load<string[]>("seen", []);
  if (seen.includes(key)) return false;
  save("seen", [...seen, key]);
  return true;
}

/** Every key saved in this browser, without the prefix. Listed at runtime, so new keys come along. */
function savedKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
    }
  } catch {
    /* unavailable: nothing saved */
  }
  return keys;
}

/** A backup file: everything saved in this browser about the player, under a header that says what it is. */
export function makeBackup(now = new Date()): Backup {
  const data: Record<string, unknown> = {};
  for (const k of savedKeys()) {
    if (DEVICE_ONLY.has(k)) continue;
    const v = load<unknown>(k, undefined);
    if (v !== undefined) data[k] = v;
  }
  return makeEnvelope(data, now);
}

/**
 * Replace everything saved with a backup's contents (keys it doesn't have are dropped, not kept).
 * After it, nothing more is saved: the caller loads the page again. False if storage refused.
 */
export function restoreBackup(b: Backup): boolean {
  try {
    for (const k of savedKeys()) localStorage.removeItem(PREFIX + k);
    for (const [k, v] of Object.entries(b.data)) localStorage.setItem(PREFIX + k, JSON.stringify(v));
  } catch {
    return false;
  }
  frozen = true;
  return true;
}
