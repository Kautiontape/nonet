/**
 * Content ids: a short, permanent name for a board that depends only on what the player sees, so
 * the same board always gets the same id however it was made, numbered or graded.
 *
 * The id is a mode letter (c, k, q) and the cyrb53 hash of a canonical string (the preimage), in
 * base 36, padded to 11 digits:
 *
 * - classic: `classic|` + the givens, 81 digits, 0 for blank.
 * - killer: `killer|` + the cage map + `|` + the sums + `|` + the givens as above. The map gives
 *   each cell its cage's label, comma-separated; cages are labelled 0, 1, 2… in order of their
 *   first cell, and the sums follow in label order. Virtual cages aren't part of the board.
 * - queens: `queens|` + n + `|` + the region of each cell, comma-separated, relabelled the same way.
 *
 * Never part of it: the old id, the seed, grade fields, the solution. Two boards that are
 * rotations or reflections of each other get different ids; Queens packs drop such twins when
 * they're built.
 *
 * This is a permanent format (progress is stored against it), pinned by golden tests.
 */
import type { QueensPuzzle } from "./queens/types";
import { puzzleKind, type Puzzle } from "./types";

/** cyrb53 by bryc (public domain): a fast 53-bit string hash. */
export function cyrb53(s: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const isQueens = (p: Puzzle | QueensPuzzle): p is QueensPuzzle => "regions" in p;

/** Labels 0, 1, 2… in order of first appearance; cells without a group stay "-". */
function relabel(groups: readonly number[]): string {
  const label = new Map<number, number>();
  return groups.map((g) => (g < 0 ? "-" : String(label.get(g) ?? label.set(g, label.size).get(g)))).join(",");
}

function givensString(p: Puzzle): string {
  const out = new Array<string>(81).fill("0");
  for (const [cell, digit] of Object.entries(p.givens ?? {})) out[Number(cell)] = String(digit);
  return out.join("");
}

/** The canonical string an id hashes. Exported for tests. */
export function contentPreimage(p: Puzzle | QueensPuzzle): string {
  if (isQueens(p)) return `queens|${p.n}|${relabel(p.regions)}`;
  if (puzzleKind(p) === "classic") return `classic|${givensString(p)}`;
  const cages = p.cages.filter((c) => !c.virtual);
  const owner = new Array<number>(81).fill(-1);
  cages.forEach((cage, i) => {
    for (const c of cage.cells) owner[c] = i;
  });
  const order: number[] = [];
  for (const k of owner) if (k >= 0 && !order.includes(k)) order.push(k);
  const sums = order.map((k) => cages[k]!.sum).join(",");
  return `killer|${relabel(owner)}|${sums}|${givensString(p)}`;
}

const PREFIX = { classic: "c", killer: "k", queens: "q" } as const;

export function contentId(p: Puzzle | QueensPuzzle): string {
  const mode = isQueens(p) ? "queens" : puzzleKind(p);
  return PREFIX[mode] + cyrb53(contentPreimage(p)).toString(36).padStart(11, "0");
}

/**
 * The same board up to rotation and reflection gets the same key: the smallest content id among
 * its eight symmetric copies. Queens pack builds use it to drop twins; it's never a board's id.
 */
export function queensSymmetryKey(p: Pick<QueensPuzzle, "n" | "regions">): string {
  const { n, regions } = p;
  const maps: ((r: number, c: number) => [number, number])[] = [
    (r, c) => [r, c],
    (r, c) => [c, n - 1 - r],
    (r, c) => [n - 1 - r, n - 1 - c],
    (r, c) => [n - 1 - c, r],
    (r, c) => [r, n - 1 - c],
    (r, c) => [n - 1 - r, c],
    (r, c) => [c, r],
    (r, c) => [n - 1 - c, n - 1 - r],
  ];
  let best = "";
  for (const f of maps) {
    const g = new Array<number>(n * n);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const [rr, cc] = f(r, c);
        g[rr * n + cc] = regions[r * n + c]!;
      }
    const id = contentId({ id: "", n, regions: g, solution: [] });
    if (!best || id < best) best = id;
  }
  return best;
}
