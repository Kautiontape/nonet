/**
 * Shared pieces of the v2 generators (classic.ts, killer.ts, queens.ts).
 *
 * A board is made for (mode, band, seed). The seed's sub-target (bands.ts) is the aim; attempts are
 * numbered, and each one draws its randomness from (generator version, mode, band, seed, attempt),
 * so a board depends on nothing else and changing how many attempts something takes can't change
 * which sub-target a seed aims at. The first attempt that fits the aim wins; otherwise the first
 * attempt that fits the band at all, so no work is thrown away.
 */
import type { Mode, SubTarget } from "../bands";
import { hashSeed, mulberry32, type Rng } from "../rng";
import type { Difficulty } from "../types";

/** Bump when a change to any generator would make different boards for the same seed. */
export const GENERATOR_VERSION = 2;

export function attemptRng(mode: Mode, band: Difficulty, seed: number, attempt: number): Rng {
  return mulberry32(hashSeed("gen", GENERATOR_VERSION, mode, band, seed, attempt));
}

export interface Candidate<B, P> {
  board: B;
  profile: P;
  /** Sub-targets the board fits (bands.ts); empty when it isn't in the band. */
  fits: SubTarget[];
}

export interface Made<B, P> extends Candidate<B, P> {
  seed: number;
  aim: SubTarget;
  /** Attempts it took (the fallback's own attempt number when the aim wasn't met). */
  attempts: number;
}

/** Run attempts until one fits the aim; fall back to the first that fits the band. */
export function search<B, P>(
  seed: number,
  aim: SubTarget,
  maxAttempts: number,
  attempt: (i: number) => Candidate<B, P> | null,
): Made<B, P> | null {
  let fallback: Made<B, P> | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    const c = attempt(i);
    if (!c || !c.fits.length) continue;
    if (c.fits.includes(aim)) return { ...c, seed, aim, attempts: i + 1 };
    fallback ??= { ...c, seed, aim, attempts: i + 1 };
  }
  return fallback;
}

/** Mirrored cell groups for symmetric digging: 40 pairs (c, 80 − c) and the centre. */
export function mirroredGroups(): number[][] {
  const groups: number[][] = [];
  for (let c = 0; c <= 40; c++) groups.push(c === 40 ? [40] : [c, 80 - c]);
  return groups;
}
