/**
 * Puzzle packs: the v2 packs (public/packs/v2), fetched once, decoded, cached. Every board's id is
 * its content id. Picks a random unsolved puzzle, so one left unplayed waits in the draw rather
 * than coming straight back; once all are solved, replays come at random too.
 */
import { contentId } from "../engine/content-id";
import { decodeSudoku, type SudokuPack } from "../engine/pack";
import { decodeQueens, type QueensPack } from "../engine/queens/pack";
import type { QueensPuzzle } from "../engine/queens/types";
import type { Difficulty, Puzzle } from "../engine/types";

export type Mode = "classic" | "killer" | "queens";

const cache = new Map<string, Promise<unknown[]>>();

async function fetchPack(mode: Mode, difficulty: Difficulty): Promise<unknown[]> {
  const key = `${mode}-${difficulty}`;
  let p = cache.get(key);
  if (!p) {
    // v1 decoders read v2 entries (engine/pack-v2.ts); the extra fields aren't needed to play.
    p = fetch(new URL(`packs/v2/${key}.json`, document.baseURI).href)
      .then((r) => {
        if (!r.ok) throw new Error(`pack ${key}: ${r.status}`);
        return r.json() as Promise<SudokuPack | QueensPack>;
      })
      .then((pack) => pack.puzzles as unknown[]);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export async function loadSudokuPack(mode: "classic" | "killer", difficulty: Difficulty): Promise<Puzzle[]> {
  return (await fetchPack(mode, difficulty)).map((e) => decodeSudoku(e as SudokuPack["puzzles"][number]));
}

export async function loadQueensPack(difficulty: Difficulty): Promise<QueensPuzzle[]> {
  return (await fetchPack("queens", difficulty)).map((e) => decodeQueens(e as QueensPack["puzzles"][number]));
}

/** A random puzzle not yet solved, never the one just left (`avoid`); once all are solved, any but that one. */
export function pickNext<T extends { id: string }>(list: readonly T[], solved: readonly string[], avoid?: string, random: () => number = Math.random): T | null {
  if (!list.length) return null;
  const done = new Set(solved);
  const fresh = list.filter((p) => !done.has(p.id) && p.id !== avoid);
  const pool = fresh.length ? fresh : list.filter((p) => p.id !== avoid);
  return pool.length ? pool[Math.floor(random() * pool.length)]! : list[0]!;
}

/**
 * A saved game's board under its content id, like every pack board. A game saved before the v2
 * packs carries its v1 id; renamed, it is counted once when finished (see sync/v1.ts).
 */
export function withContentId<T extends Puzzle | QueensPuzzle>(p: T): T {
  return { ...p, id: contentId(p) };
}
