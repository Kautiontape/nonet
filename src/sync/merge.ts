/**
 * Joining two copies of a player's data, key by key. Every rule is a join: the same answer in
 * any order, and merging a copy with itself changes nothing. That is what lets two devices that
 * both played while apart end up the same, with a server that only stores a file.
 *
 * Nobody plays on two devices at once, so ties are rare; where one is possible the rule still
 * picks deterministically (the smaller canonical form), so every device agrees.
 */
import { canonical, isRecord } from "./equal";
import type { Counters, Streak } from "./progress";

/** A backup's `data`: each saved value by key. */
export type Data = Record<string, unknown>;

/** Finished levels kept, newest first. */
export const RESULTS_MAX = 300;

export function merge(a: Data, b: Data): Data {
  const out: Data = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === "settings" || k === "settingsAt") continue;
    const va = a[k];
    const vb = b[k];
    const v = va === undefined ? vb : vb === undefined ? va : mergeKey(k, va, vb);
    if (v !== undefined) out[k] = v;
  }
  // Settings and their time move together, so a side can't lend its time to the other's values.
  if ([a, b].some((d) => d.settings !== undefined || d.settingsAt !== undefined)) {
    const w = settingsWinner(a, b);
    if (w.settings !== undefined) out.settings = w.settings;
    if (w.settingsAt !== undefined) out.settingsAt = w.settingsAt;
  }
  return out;
}

function mergeKey(key: string, a: unknown, b: unknown): unknown {
  switch (key) {
    case "progress":
      return mergeProgress(a, b);
    case "results":
      return mergeResults(a, b);
    case "seen":
      return unionList(a, b);
    default:
      if (key.startsWith("game.")) return laterGame(a, b);
      return smaller(a, b);
  }
}

/** The deterministic pick when nothing else decides: the smaller canonical form. */
function smaller<T>(a: T, b: T): T {
  return canonical(a) <= canonical(b) ? a : b;
}

/** Settings move as a whole: the side whose synced settings changed last supplies both the values and the time. */
function settingsWinner(a: Data, b: Data): Data {
  const ta = typeof a.settingsAt === "number" ? a.settingsAt : 0;
  const tb = typeof b.settingsAt === "number" ? b.settingsAt : 0;
  if (ta !== tb) return ta > tb ? a : b;
  const unit = (d: Data) => canonical({ settings: d.settings, settingsAt: d.settingsAt });
  return unit(a) <= unit(b) ? a : b;
}

function mergeProgress(a: unknown, b: unknown): unknown {
  if (!isRecord(a) || !isRecord(b)) return smaller(a, b);
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[k];
    const vb = b[k];
    if (va === undefined || vb === undefined) {
      out[k] = va ?? vb;
      continue;
    }
    switch (k) {
      case "solved":
        out[k] = unionLists(va, vb);
        break;
      case "best":
        out[k] = minMap(va, vb);
        break;
      case "streak":
        out[k] = laterStreak(va, vb);
        break;
      case "counters":
        out[k] = maxCounters(va, vb);
        break;
      default:
        out[k] = smaller(va, vb);
    }
  }
  return out;
}

function unionList(a: unknown, b: unknown): unknown {
  if (!Array.isArray(a) || !Array.isArray(b)) return smaller(a, b);
  const out = [...a];
  for (const v of b) if (!out.includes(v)) out.push(v);
  return out;
}

function unionLists(a: unknown, b: unknown): unknown {
  if (!isRecord(a) || !isRecord(b)) return smaller(a, b);
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? unionList(out[k], v) : v;
  return out;
}

function minMap(a: unknown, b: unknown): unknown {
  if (!isRecord(a) || !isRecord(b)) return smaller(a, b);
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = cur === undefined ? v : typeof cur === "number" && typeof v === "number" ? Math.min(cur, v) : smaller(cur, v);
  }
  return out;
}

function laterStreak(a: unknown, b: unknown): unknown {
  if (!isRecord(a) || !isRecord(b)) return smaller(a, b);
  const x = a as Partial<Streak>;
  const y = b as Partial<Streak>;
  const lx = x.last ?? "";
  const ly = y.last ?? "";
  if (lx !== ly) return lx > ly ? a : b;
  const dx = x.days ?? 0;
  const dy = y.days ?? 0;
  if (dx !== dy) return dx > dy ? a : b;
  return smaller(a, b);
}

function maxCounters(a: unknown, b: unknown): unknown {
  if (!isRecord(a) || !isRecord(b)) return smaller(a, b);
  const out: Record<string, unknown> = { ...a };
  for (const [device, v] of Object.entries(b)) {
    const cur = out[device];
    if (cur === undefined) {
      out[device] = v;
      continue;
    }
    if (!isRecord(cur) || !isRecord(v)) {
      out[device] = smaller(cur, v);
      continue;
    }
    const x = cur as Partial<Counters>;
    const y = v as Partial<Counters>;
    const hinted: Record<string, number> = { ...(x.hinted ?? {}) };
    for (const [t, n] of Object.entries(y.hinted ?? {})) hinted[t] = Math.max(hinted[t] ?? 0, n);
    out[device] = { total: Math.max(x.total ?? 0, y.total ?? 0), hinted };
  }
  return out;
}

const resultKey = (r: unknown): string => (isRecord(r) ? `${String(r.id)}@${String(r.at ?? 0)}` : canonical(r));
const resultAt = (r: unknown): number => (isRecord(r) && typeof r.at === "number" ? r.at : 0);

function mergeResults(a: unknown, b: unknown): unknown {
  if (!Array.isArray(a) || !Array.isArray(b)) return smaller(a, b);
  const byKey = new Map<string, unknown>();
  for (const r of [...a, ...b]) {
    const k = resultKey(r);
    const cur = byKey.get(k);
    byKey.set(k, cur === undefined ? r : smaller(cur, r));
  }
  return [...byKey.entries()]
    .sort(([ka, ra], [kb, rb]) => resultAt(rb) - resultAt(ra) || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .slice(0, RESULTS_MAX)
    .map(([, r]) => r);
}

/** When a game slot was last touched: a save's `savedAt`, a cleared slot's `clearedAt`. */
const gameAt = (v: unknown): number => {
  if (!isRecord(v)) return 0;
  const t = v.savedAt ?? v.clearedAt;
  return typeof t === "number" ? t : 0;
};

function laterGame(a: unknown, b: unknown): unknown {
  const ta = gameAt(a);
  const tb = gameAt(b);
  if (ta !== tb) return ta > tb ? a : b;
  return smaller(a, b);
}
