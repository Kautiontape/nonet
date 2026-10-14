/**
 * Queens generator (v2), aimed at a band's sub-target (bands.ts). Each attempt plants queens, grows
 * a region around each with the band's region style, repairs the layout until it has one solution
 * (queens/generate.ts), and profiles the hint engine's solve. The sub-target picks the board size;
 * how often the board stops you and how many contradictions it needs decide whether it fits.
 */
import { QUEENS_SIZES, subTargetsOf, type SubTarget } from "../bands";
import { profileQueens, type QueensProfile } from "../profile";
import { generateQueens, STYLE_FOR_DIFFICULTY } from "../queens/generate";
import type { QueensPuzzle } from "../queens/types";
import { hashSeed, pick } from "../rng";
import type { Difficulty } from "../types";
import { attemptRng, search, type Candidate, type Made } from "./common";

/** Attempts per board before settling for a board that fits the band but not the aim. */
export const QUEENS_ATTEMPTS: Record<Difficulty, number> = { easy: 400, medium: 2000, hard: 4000, expert: 4000 };

export type QueensMade = Made<QueensPuzzle, QueensProfile>;

export function makeQueens(band: Difficulty, aim: SubTarget, seed: number, maxAttempts = QUEENS_ATTEMPTS[band]): QueensMade | null {
  return search(seed, aim, maxAttempts, (i) => attemptQueens(band, aim, seed, i));
}

/** One attempt; null when the layout can't be made unique or the board isn't in the band. */
export function attemptQueens(band: Difficulty, aim: SubTarget, seed: number, attempt: number): Candidate<QueensPuzzle, QueensProfile> | null {
  const rng = attemptRng("queens", band, seed, attempt);
  const n = pick(rng, QUEENS_SIZES[band][aim]);
  const puzzle = generateQueens({ n, seed: hashSeed(Math.floor(rng() * 2 ** 32)), style: STYLE_FOR_DIFFICULTY[band] });
  if (!puzzle) return null;
  const profile = profileQueens(puzzle, { scan: false });
  const fits = subTargetsOf("queens", band, profile);
  return fits.length ? { board: puzzle, profile, fits } : null;
}
