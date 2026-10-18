/**
 * What's new: after an update, Settings on the home screen and the Changelog link inside it glow
 * until the player opens the changelog. Only for someone who has played: a first visit notes the
 * release quietly, since nothing is new to them.
 *
 * The mark is the newest release whose notes this browser has shown. It stays on this device (it
 * isn't synced), so each device announces its own update. Releases come from the changelog's
 * headings, not the build's `git describe`: production and the beta share storage, and the beta's
 * describe changes with every push. The mark only moves forward, so an older build can't make a
 * newer one glow again. `?whatsnew` forces the glow for one visit (to try it on the beta).
 */
import { latestRelease } from "./changelog";
import { load, loadProgress, save } from "./store";

const KEY = "seenRelease";

let release: string | null = null;
/** The mark as this visit found it: releases newer than it are the new ones. */
let since: string | null = null;
let news = false;
const listeners = new Set<() => void>();

/** Negative, zero or positive as release `a` is older than, the same as or newer than `b`. */
export function compareReleases(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** Real play, not just keys: a finished puzzle, a result, or a game started in any mode. */
function playedBefore(): boolean {
  if (loadProgress().total > 0 || load<unknown[]>("results", []).length) return true;
  return ["classic", "killer", "queens"].some((m) => load<unknown>(`game.${m}`, null) !== null);
}

/** Decide once per page load, before the first screen. */
export function initWhatsNew(force = false, current = latestRelease()): void {
  release = current;
  since = load<string | null>(KEY, null);
  news = false;
  if (!release) return;
  if (force) news = true;
  else if (since && compareReleases(since, release) >= 0) return;
  else if (!since && !playedBefore()) save(KEY, release);
  else news = true;
}

export const hasNews = (): boolean => news;

/**
 * Which of the changelog's sections (newest first; null is Unreleased, on beta builds) to tag as
 * new: those since the mark, Unreleased always among them. With no mark to go by, or forced over an
 * up-to-date one, the newest section.
 */
export function newSections(versions: readonly (string | null)[]): boolean[] {
  if (!news || !release) return versions.map(() => false);
  const mark = since;
  if (mark && compareReleases(mark, release) < 0) return versions.map((v) => v === null || compareReleases(v, mark) > 0);
  return versions.map((_, i) => i === 0);
}

/** The changelog was opened: nothing is new any more. */
export function markSeen(): void {
  const seen = load<string | null>(KEY, null);
  if (release && (!seen || compareReleases(seen, release) < 0)) save(KEY, release);
  if (!news) return;
  news = false;
  for (const fn of listeners) fn();
}

export function onWhatsNew(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
