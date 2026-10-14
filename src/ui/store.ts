/**
 * Local persistence. Everything lives in this browser only; every access is guarded because
 * storage can be unavailable (private windows, blocked site data) and the game must still work.
 */
// From the game's first name, Cage Coach. Kept so existing saves and stats survive the rename.
const PREFIX = "cagecoach.";

// Set by a restore. The page is about to load again, and nothing the old page still holds (a
// game's autosave, the cached settings) may write over the backup before it goes.
let frozen = false;

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  if (frozen) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: keep playing */
  }
}

export function remove(key: string): void {
  if (frozen) return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export interface Progress {
  /** Solved puzzle ids per "mode-difficulty". */
  solved: Record<string, string[]>;
  /** Best time (ms) per "mode-difficulty". */
  best: Record<string, number>;
  /** Hint steps applied per technique id (for the Learn screen). */
  hinted: Record<string, number>;
  /** Total puzzles solved. */
  total: number;
  /** Consecutive days with a solve. */
  streak: { last: string; days: number };
}

export function loadProgress(): Progress {
  const p = load<Partial<Progress>>("progress", {});
  return {
    solved: p.solved ?? {},
    best: p.best ?? {},
    hinted: p.hinted ?? {},
    total: p.total ?? 0,
    streak: p.streak ?? { last: "", days: 0 },
  };
}

export function saveProgress(p: Progress): void {
  save("progress", p);
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
  p.total++;
  const today = todayKey();
  if (p.streak.last !== today) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    p.streak = { last: today, days: p.streak.last === todayKey(y) ? p.streak.days + 1 : 1 };
  }
  saveProgress(p);
  return p;
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

const RESULTS_MAX = 300;

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
  p.hinted[technique] = (p.hinted[technique] ?? 0) + 1;
  saveProgress(p);
}

/** Show a one-time tip: returns true the first time a key is seen. */
export function firstTime(key: string): boolean {
  const seen = load<string[]>("seen", []);
  if (seen.includes(key)) return false;
  save("seen", [...seen, key]);
  return true;
}

/** A backup file: everything saved in this browser, under a header that says what it is. */
export interface Backup {
  app: "nonet";
  version: number;
  /** When it was made (ISO 8601). */
  exported: string;
  /** Each saved value by its key (without the prefix). */
  data: Record<string, unknown>;
}

const BACKUP_VERSION = 1;

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

export function makeBackup(now = new Date()): Backup {
  const data: Record<string, unknown> = {};
  for (const k of savedKeys()) {
    const v = load<unknown>(k, undefined);
    if (v !== undefined) data[k] = v;
  }
  return { app: "nonet", version: BACKUP_VERSION, exported: now.toISOString(), data };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read a backup file's text: null if it isn't a backup this version can restore. */
export function parseBackup(text: string): Backup | null {
  let b: unknown;
  try {
    b = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(b) || b.app !== "nonet" || typeof b.version !== "number" || b.version > BACKUP_VERSION || !isRecord(b.data)) return null;
  return { app: "nonet", version: b.version, exported: typeof b.exported === "string" ? b.exported : "", data: b.data };
}

/** Total solves recorded in a backup, if it has any progress. */
export function backupSolved(b: Backup): number {
  const p = b.data.progress;
  return isRecord(p) && typeof p.total === "number" ? p.total : 0;
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
