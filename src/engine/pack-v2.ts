/**
 * v2 packs (public/packs/v2/{mode}-{band}.json), written by scripts/generate-pack.ts. Each entry is
 * the v1 encoding (pack.ts, queens/pack.ts) plus what v2 adds: the content id as `id`, the seed and
 * generator version that reproduce it (`makeBoard(mode, band, seed)` at that version), its
 * sub-target, and a profile summary. v1 decoders read v2 entries; they ignore the extra fields.
 */
import type { Mode, SubTarget } from "./bands";
import { contentId } from "./content-id";
import type { MadeBoard } from "./gen";
import { decodeSudoku, encodeSudoku, type SudokuPackEntry } from "./pack";
import type { QueensProfile, SudokuProfile } from "./profile";
import { decodeQueens, encodeQueens, type QueensPackEntry } from "./queens/pack";
import type { QueensPuzzle } from "./queens/types";
import type { Difficulty, Puzzle } from "./types";

export type SubTargetCode = "b" | "s" | "x";
export const SUB_TARGET_CODE: Record<SubTarget, SubTargetCode> = { breather: "b", standard: "s", stretch: "x" };
export const SUB_TARGET_OF_CODE: Record<SubTargetCode, SubTarget> = { b: "breather", s: "standard", x: "stretch" };

/** A few profile numbers, for the picker and for reports; the full profile can be recomputed. */
export interface ProfileSummary {
  /** Walls, first wall (open squares or cells), steps past the basics, tier-4+ steps, hardest step. */
  w: number;
  fw: number | null;
  b: number;
  a: number;
  h: string | null;
  /** Classic: early options (1 decimal) and tier-3 steps. */
  e?: number;
  t3?: number;
  /** Killer: 45-rule steps, of them over 2+ houses, one-cell cages. */
  i?: number;
  im?: number;
  f?: number;
  /** Queens: contradiction steps. */
  c?: number;
}

interface V2Fields {
  seed: number;
  gv: number;
  st: SubTargetCode;
  p: ProfileSummary;
}
export type SudokuEntryV2 = SudokuPackEntry & V2Fields;
export type QueensEntryV2 = QueensPackEntry & V2Fields;
export type EntryV2 = SudokuEntryV2 | QueensEntryV2;

export interface PackV2 {
  version: 2;
  mode: Mode;
  difficulty: Difficulty;
  /** Generator version of the newest entries; each entry also records its own. */
  generator: number;
  puzzles: EntryV2[];
}

export function summarize(profile: SudokuProfile | QueensProfile): ProfileSummary {
  const s: ProfileSummary = { w: profile.walls, fw: profile.firstWall, b: profile.beyond, a: profile.advanced, h: profile.hardest };
  if (profile.mode === "queens") s.c = profile.counts["contradiction"] ?? 0;
  else if (profile.mode === "classic") {
    s.e = Math.round(profile.scan.early * 10) / 10;
    s.t3 = profile.tiers[3]!;
  } else {
    s.i = profile.innies.single + profile.innies.multi;
    s.im = profile.innies.multi;
    s.f = profile.cages?.sizes[1] ?? 0;
  }
  return s;
}

/** The pack entry for a made board; its id is the content id of the entry as decoded. */
export function encodeV2(mode: Mode, band: Difficulty, made: MadeBoard, sub: SubTarget, gv: number): EntryV2 {
  const p = made.profile;
  const meta = { seed: made.seed, difficulty: band, tier: p.tier, rating: p.rating, techniques: p.techniques, steps: p.steps };
  const extra: V2Fields = { seed: made.seed, gv, st: SUB_TARGET_CODE[sub], p: summarize(p) };
  if (mode === "queens") {
    const board = made.board as QueensPuzzle;
    const e = encodeQueens({ ...board, meta }) as QueensEntryV2;
    Object.assign(e, extra);
    e.id = contentId(decodeQueens(e));
    return e;
  }
  const board = made.board as Puzzle;
  const e = encodeSudoku({ ...board, meta }) as SudokuEntryV2;
  Object.assign(e, extra);
  e.id = contentId(decodeSudoku(e));
  return e;
}

export function decodeV2(mode: Mode, e: EntryV2): Puzzle | QueensPuzzle {
  return mode === "queens" ? decodeQueens(e as QueensEntryV2) : decodeSudoku(e as SudokuEntryV2);
}
