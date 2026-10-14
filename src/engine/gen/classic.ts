/**
 * Classic generator (v2), aimed at a band's sub-target (bands.ts). Measurements and the methods
 * that lost are in docs/generator-research.md.
 *
 * - Easy: strip a solved grid in mirrored pairs, keeping a removal only while cross-hatching (full
 *   house and hidden singles) still solves the board, no state is down to one square to fill, and
 *   the early options stay at or above the sub-target's floor.
 * - Medium and Hard: dig a minimal unique board with the exact solver. Most need more than the
 *   band's techniques, so mirrored pairs go back in where those techniques stall (adding a given
 *   never invalidates a deduction) until the board fits the target; then strip again under the same
 *   check. Medium's 2+ step sub-targets strip greedily, taking the removal that adds the most steps
 *   past singles.
 * - Expert: dig a minimal unique board and keep it when the hint engine's solve meets the band.
 *
 * Checks never use techniques that assume a unique solution, so a passing check proves uniqueness;
 * every board still ends with the hint engine's full solve (bands.ts) and an exact uniqueness check.
 */
import { CLASSIC_EASY_EARLY, CLASSIC_HARD_TIER3, CLASSIC_MEDIUM, subTargetsOf, within, type SubTarget } from "../bands";
import { exactSolve, gridToString } from "../exact";
import { digClassic, givensRecord, randomSolvedGrid } from "../generate";
import { solveLogically } from "../logical";
import { profileSudoku, type SudokuProfile } from "../profile";
import { shuffle, type Rng } from "../rng";
import { TECHNIQUES, type Technique } from "../techniques";
import type { Difficulty, Grid, Puzzle } from "../types";
import { attemptRng, mirroredGroups, search, type Candidate, type Made } from "./common";

const CLASSIC = TECHNIQUES.filter((t) => !t.killerOnly);
const CROSS_HATCH = CLASSIC.filter((t) => t.id === "full-house" || t.id === "hidden-single");
const SINGLES = CLASSIC.filter((t) => t.tier <= 1);
const POINTING = CLASSIC.filter((t) => t.tier <= 1 || t.id === "pointing" || t.id === "claiming");
const TIER_2 = CLASSIC.filter((t) => t.tier <= 2);
const TIER_3 = CLASSIC.filter((t) => t.tier <= 3 && !t.assumesUnique);

/** Below this many empty squares the early-options mean has too few states to be meaningful. */
const EARLY_FROM_EMPTY = 30;

/** Attempts per board before settling for a board that fits the band but not the aim. */
export const CLASSIC_ATTEMPTS: Record<Difficulty, number> = { easy: 200, medium: 400, hard: 400, expert: 4000 };

export type ClassicMade = Made<Puzzle, SudokuProfile>;

export function makeClassic(band: Difficulty, aim: SubTarget, seed: number, maxAttempts = CLASSIC_ATTEMPTS[band]): ClassicMade | null {
  return search(seed, aim, maxAttempts, (i) => attemptClassic(band, aim, seed, i));
}

function puzzleOf(givens: Grid, solution: Grid, id = ""): Puzzle {
  return { id, kind: "classic", cages: [], givens: givensRecord(givens), solution: gridToString(solution) };
}
const emptyCount = (g: Grid) => g.reduce((n, d) => n + (d ? 0 : 1), 0);

/** One attempt; null when it doesn't produce a board in the band. */
export function attemptClassic(band: Difficulty, aim: SubTarget, seed: number, attempt: number): Candidate<Puzzle, SudokuProfile> | null {
  const rng = attemptRng("classic", band, seed, attempt);
  const solution = randomSolvedGrid(rng);
  const givens =
    band === "easy" ? stripEasy(solution, aim, rng) : band === "expert" ? digClassic(solution, rng, { minGivens: 17 }) : fillAndStrip(band, aim, solution, rng);
  if (!givens) return null;
  const puzzle = puzzleOf(givens, solution);
  if (exactSolve(puzzle, { limit: 2 }).count !== 1) return null;
  const profile = profileSudoku(puzzle);
  return { board: puzzle, profile, fits: subTargetsOf("classic", band, profile) };
}

// --- Easy ------------------------------------------------------------------------------------------

function stripEasy(solution: Grid, aim: SubTarget, rng: Rng): Grid {
  const floor = CLASSIC_EASY_EARLY[aim][0];
  const g = Uint8Array.from(solution);
  for (const group of shuffle(rng, mirroredGroups())) {
    const saved = group.map((c) => g[c]!);
    for (const c of group) g[c] = 0;
    const p = profileSudoku(puzzleOf(g, solution), { techniques: CROSS_HATCH });
    const ok = p.solved && p.scan.min >= 2 && (emptyCount(g) < EARLY_FROM_EMPTY || p.scan.early >= floor);
    if (!ok) group.forEach((c, i) => (g[c] = saved[i]!));
  }
  return g;
}

// --- Medium and Hard --------------------------------------------------------------------------------

interface Check {
  techniques: readonly Technique[];
  /** The board fits the target on the check's own solve. */
  fits(p: SudokuProfile): boolean;
  /** Too easy to keep: filling back can only make it easier. */
  tooEasy(p: SudokuProfile): boolean;
}

function checkFor(band: Difficulty, aim: SubTarget): Check {
  if (band === "medium") {
    // Only the ceiling on steps past singles: filling back lowers that count and the greedy strip
    // raises it again; the final band check applies the floor.
    const t = CLASSIC_MEDIUM[aim];
    return {
      techniques: t.pairs ? TIER_2 : POINTING,
      fits: (p) => p.solved && p.walls >= 1 && p.walls <= 2 && p.firstWall !== null && p.firstWall <= t.wall && p.beyond < t.beyond[1],
      tooEasy: (p) => p.solved && p.walls === 0,
    };
  }
  return {
    techniques: TIER_3,
    fits: (p) => p.solved && p.tier === 3 && within(p.tiers[3]!, [CLASSIC_HARD_TIER3.breather[0], Infinity]),
    tooEasy: (p) => p.solved && p.tier < 3,
  };
}

/** Profile on the check's techniques, plus where it stalls (the board itself when it doesn't). */
function evaluate(g: Grid, solution: Grid, check: Check): { p: SudokuProfile; stall: Grid; filled: number } {
  const puzzle = puzzleOf(g, solution);
  const p = profileSudoku(puzzle, { techniques: check.techniques });
  // Where to put digits back: the stall point of the check's solve, or the first wall when solved.
  const stall = solveLogically(puzzle, { techniques: p.solved ? SINGLES : check.techniques }).state.grid;
  return { p, stall, filled: 81 - emptyCount(stall) };
}

function fillAndStrip(band: Difficulty, aim: SubTarget, solution: Grid, rng: Rng): Grid | null {
  const check = checkFor(band, aim);
  const g = digClassic(solution, rng, { minGivens: 17 });
  const groups = mirroredGroups();
  let cur = evaluate(g, solution, check);
  if (check.tooEasy(cur.p)) return null;

  // Fill: put mirrored pairs back at the stall point until the board fits the target.
  for (let guard = 0; guard < 40 && !check.fits(cur.p); guard++) {
    const options = shuffle(
      rng,
      groups.filter((grp) => grp.every((c) => !g[c]) && grp.some((c) => !cur.stall[c])),
    );
    let moved = false;
    for (const grp of options) {
      for (const c of grp) g[c] = solution[c]!;
      const next = evaluate(g, solution, check);
      const better =
        !check.tooEasy(next.p) &&
        (cur.p.solved
          ? next.p.solved && (next.p.firstWall! < cur.p.firstWall! || next.p.beyond < cur.p.beyond)
          : next.p.solved || next.filled > cur.filled);
      if (better) {
        cur = next;
        moved = true;
        break;
      }
      for (const c of grp) g[c] = 0;
    }
    if (!moved) return null;
  }
  if (!check.fits(cur.p)) return null;

  // Strip again under the same check: one plain pass, or, for Medium targets that want 2+ steps past
  // singles, repeatedly take the removal that keeps the target and adds the most steps.
  shuffle(rng, groups);
  const fitsWithout = (grp: number[]): SudokuProfile | null => {
    for (const c of grp) g[c] = 0;
    const p = profileSudoku(puzzleOf(g, solution), { techniques: check.techniques });
    for (const c of grp) g[c] = solution[c]!;
    return check.fits(p) ? p : null;
  };
  if (band === "medium" && CLASSIC_MEDIUM[aim].beyond[0] >= 2) {
    for (;;) {
      let best: { grp: number[]; beyond: number } | null = null;
      for (const grp of groups) {
        if (!grp.every((c) => g[c])) continue;
        const p = fitsWithout(grp);
        if (p && (!best || p.beyond > best.beyond)) best = { grp, beyond: p.beyond };
      }
      if (!best) break;
      for (const c of best.grp) g[c] = 0;
    }
  } else {
    for (const grp of groups) if (grp.every((c) => g[c]) && fitsWithout(grp)) for (const c of grp) g[c] = 0;
  }
  return g;
}
