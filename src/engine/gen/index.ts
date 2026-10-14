/**
 * v2 puzzle generators: one board per (mode, band, seed), aimed at the seed's sub-target
 * (bands.ts). Pure and synchronous; all randomness comes from the seed through rng.ts.
 */
import { subTargetForSeed, type Mode } from "../bands";
import { contentId } from "../content-id";
import type { QueensProfile, SudokuProfile } from "../profile";
import type { QueensPuzzle } from "../queens/types";
import type { Difficulty, Puzzle } from "../types";
import { makeClassic } from "./classic";
import { makeKiller } from "./killer";
import { makeQueens } from "./queens";
import type { Made } from "./common";

export { GENERATOR_VERSION } from "./common";
export type { Made } from "./common";

export type MadeBoard = Made<Puzzle, SudokuProfile> | Made<QueensPuzzle, QueensProfile>;

/** A board for the seed, or null when no attempt fitted the band. The board's id is its content id. */
export function makeBoard(mode: Mode, band: Difficulty, seed: number): MadeBoard | null {
  const aim = subTargetForSeed(mode, band, seed);
  const made: MadeBoard | null =
    mode === "classic" ? makeClassic(band, aim, seed) : mode === "killer" ? makeKiller(band, aim, seed) : makeQueens(band, aim, seed);
  if (made) made.board.id = contentId(made.board);
  return made;
}
