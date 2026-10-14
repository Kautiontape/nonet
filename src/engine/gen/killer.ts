/**
 * Killer generator (v2), aimed at a band's sub-target (bands.ts). Measurements and the methods that
 * lost are in docs/generator-research.md.
 *
 * 1. Lay out cages over a random solved grid: Easy cage sizes for Easy, Medium sizes above it.
 * 2. Repair: solve with the band's techniques; where the solve stalls, split a stalled cage, picked
 *    at random with weight growing with its open candidates. One-cell cages may appear here (2- and
 *    3-cell cages can only split one off); above Easy they are merged away again in step 3.
 * 3. Harden: merge two neighbouring cages (no repeated digit, within the size cap and guard) when
 *    the board still solves with the band's techniques and moves toward the target. Merges that
 *    absorb a one-cell cage come first. Easy stretch boards merge until no merge keeps them in band.
 * 4. Check the board on the hint engine's full solve (bands.ts).
 *
 * A complete logical solve with no uniqueness-assuming technique (killer has none) proves the board
 * has one solution, so no exact search is needed.
 */
import {
  filledBeforeWall,
  KILLER_EASY_FREEBIES,
  KILLER_EXPERT_ADVANCED,
  KILLER_EXPERT_SIX_CELL,
  KILLER_HARD_INNIES,
  KILLER_MEDIUM,
  KILLER_MEDIUM_OPENER,
  subTargetsOf,
  type SubTarget,
} from "../bands";
import { popcount } from "../combos";
import { gridToString } from "../exact";
import { cagesFromCells, connectedSplits, partitionCages, randomSolvedGrid, type PartitionOptions } from "../generate";
import { solveLogically } from "../logical";
import { profileSudoku, type SudokuProfile } from "../profile";
import { KILLER_CONFIG } from "../puzzles";
import { pickWeighted, shuffle, type Rng } from "../rng";
import { TECHNIQUES, type Technique } from "../techniques";
import { inniesSingle } from "../techniques/innies";
import type { CellId, Difficulty, Grid, Puzzle } from "../types";
import { attemptRng, search, type Candidate, type Made } from "./common";

const KILLER = TECHNIQUES.filter((t) => !t.classicOnly);
const CHECK: Record<Difficulty, readonly Technique[]> = {
  easy: KILLER.filter((t) => t.tier <= 2),
  medium: KILLER.filter((t) => t.tier <= 2 || t === inniesSingle),
  hard: KILLER.filter((t) => t.tier <= 3),
  expert: KILLER,
};
/** Merge rounds, and merge candidates tried per round. */
const ROUNDS = 60;
const TRIES = 10;

/** Attempts per board before settling for a board that fits the band but not the aim. */
export const KILLER_ATTEMPTS: Record<Difficulty, number> = { easy: 100, medium: 200, hard: 200, expert: 600 };

export type KillerMade = Made<Puzzle, SudokuProfile>;

export function makeKiller(band: Difficulty, aim: SubTarget, seed: number, maxAttempts = KILLER_ATTEMPTS[band]): KillerMade | null {
  return search(seed, aim, maxAttempts, (i) => attemptKiller(band, aim, seed, i));
}

const NEIGHBOURS: CellId[][] = Array.from({ length: 81 }, (_, c) => {
  const r = Math.floor(c / 9);
  const k = c % 9;
  const out: CellId[] = [];
  if (r) out.push(c - 9);
  if (r < 8) out.push(c + 9);
  if (k) out.push(c - 1);
  if (k < 8) out.push(c + 1);
  return out;
});
const digitsOf = (cells: readonly CellId[], sol: Grid) => cells.reduce((m, c) => m | (1 << sol[c]!), 0);
const ones = (lists: readonly CellId[][]) => lists.filter((l) => l.length === 1).length;
const innies = (p: SudokuProfile) => p.innies.single + p.innies.multi;

interface Plan {
  layout: PartitionOptions;
  /** Largest cage a merge may make. */
  maxSize: number;
  /** Most 6-cell cages a merge may leave. */
  maxSix: number;
  /** One-cell cages allowed while laying out and repairing, and at the end. */
  repairOnes: number;
  finalOnes: number;
  /** Target reached on the check's own solve. */
  done(p: SudokuProfile, lists: readonly CellId[][]): boolean;
  /** `next` is at least as far along as `prev`. */
  progress(prev: SudokuProfile, next: SudokuProfile): boolean;
  /** Keep merging until no merge is accepted (Easy stretch). */
  mergeToEnd: boolean;
}

function planFor(band: Difficulty, aim: SubTarget): Plan {
  const medium = KILLER_CONFIG.medium;
  const fromMedium = { sizeWeights: medium.sizeWeights, maxSize: medium.maxSize, compactness: medium.compactness };
  if (band === "easy") {
    const easy = KILLER_CONFIG.easy;
    const most = KILLER_EASY_FREEBIES[aim][1] - 1;
    return {
      layout: { sizeWeights: easy.sizeWeights, maxSize: easy.maxSize, compactness: easy.compactness },
      maxSize: easy.maxSize,
      maxSix: Infinity,
      repairOnes: most,
      finalOnes: most,
      done: () => aim !== "stretch",
      progress: (_prev, next) => next.solved,
      mergeToEnd: aim === "stretch",
    };
  }
  if (band === "medium") {
    const t = KILLER_MEDIUM[aim];
    const finalOnes = t.freebies[1] - 1;
    return {
      layout: fromMedium,
      maxSize: medium.maxSize,
      maxSix: Infinity,
      // Breathers keep the one-cell cages repair makes (up to their limit); the others merge them away.
      repairOnes: finalOnes > 0 ? finalOnes : 81,
      finalOnes,
      done: (p, lists) =>
        innies(p) >= t.innies[0] && innies(p) < t.innies[1] && filledBeforeWall(p) <= KILLER_MEDIUM_OPENER && ones(lists) <= finalOnes,
      progress: (prev, next) => next.solved && innies(next) >= innies(prev) && innies(next) < t.innies[1],
      mergeToEnd: false,
    };
  }
  if (band === "hard") {
    const [least, most] = KILLER_HARD_INNIES[aim];
    return {
      layout: fromMedium,
      maxSize: 6,
      maxSix: Infinity,
      repairOnes: 81,
      finalOnes: 0,
      done: (p, lists) =>
        (p.innies.multi > 0 || p.tiers[3]! > innies(p)) && p.walls >= 3 && innies(p) >= least && ones(lists) === 0,
      // A merge may not jump past the aim's ceiling: that board would only fit a harder sub-target.
      progress: (prev, next) => next.solved && next.tier >= prev.tier && next.beyond >= prev.beyond && innies(next) < most,
      mergeToEnd: false,
    };
  }
  const [least, most] = KILLER_EXPERT_ADVANCED[aim];
  return {
    layout: fromMedium,
    maxSize: 6,
    maxSix: KILLER_EXPERT_SIX_CELL,
    repairOnes: 81,
    finalOnes: 0,
    done: (p, lists) => p.advanced >= least && ones(lists) === 0,
    progress: (prev, next) =>
      next.solved && next.advanced < most && (next.tier > prev.tier || (next.tier === prev.tier && next.advanced >= prev.advanced)),
    mergeToEnd: false,
  };
}

const puzzleOf = (lists: CellId[][], sol: Grid): Puzzle => ({
  id: "",
  kind: "killer",
  cages: cagesFromCells(lists, sol),
  solution: gridToString(sol),
});

/** One attempt; null when it doesn't produce a board in the band. */
export function attemptKiller(band: Difficulty, aim: SubTarget, seed: number, attempt: number): Candidate<Puzzle, SudokuProfile> | null {
  const rng = attemptRng("killer", band, seed, attempt);
  const plan = planFor(band, aim);
  const check = CHECK[band];
  const sol = randomSolvedGrid(rng);
  let lists = partitionCages(sol, rng, plan.layout);
  if (!absorbOnes(lists, sol, plan.repairOnes, plan.layout.maxSize)) return null;

  const evaluate = (l: CellId[][]) => profileSudoku(puzzleOf(l, sol), { techniques: check, scan: false });
  let prof = evaluate(lists);
  for (let i = 0; i < 40 && !prof.solved; i++) {
    if (!splitStalled(lists, sol, check, plan.repairOnes, rng)) return null;
    prof = evaluate(lists);
  }
  if (!prof.solved) return null;

  for (let round = 0; round < ROUNDS && (plan.mergeToEnd || !plan.done(prof, lists)); round++) {
    let accepted = false;
    for (const pair of mergeMoves(lists, sol, plan.maxSize, rng).slice(0, TRIES)) {
      const next = merge(lists, pair);
      if (next.filter((l) => l.length >= 6).length > plan.maxSix) continue;
      const p2 = evaluate(next);
      if (plan.progress(prof, p2)) {
        lists = next;
        prof = p2;
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  if (ones(lists) > plan.finalOnes) return null;

  const puzzle = puzzleOf(lists, sol);
  const profile = profileSudoku(puzzle, { scan: false });
  return { board: puzzle, profile, fits: subTargetsOf("killer", band, profile) };
}

/** Fold one-cell cages beyond `allowed` into a neighbouring cage; false if one can't be folded. */
function absorbOnes(lists: CellId[][], sol: Grid, allowed: number, maxSize: number): boolean {
  for (let i = 0; i < lists.length && ones(lists) > allowed; i++) {
    if (lists[i]!.length !== 1) continue;
    const c = lists[i]![0]!;
    const owner = ownerOf(lists);
    const into = NEIGHBOURS[c]!.map((x) => owner[x]!).find(
      (o) => o !== i && lists[o]!.length < maxSize && !(digitsOf(lists[o]!, sol) & (1 << sol[c]!)),
    );
    if (into === undefined) return false;
    lists[into]!.push(c);
    lists.splice(i, 1);
    i = -1;
  }
  return ones(lists) <= allowed;
}

function ownerOf(lists: readonly CellId[][]): Int16Array {
  const o = new Int16Array(81);
  lists.forEach((l, i) => l.forEach((c) => (o[c] = i)));
  return o;
}

/** Split a cage the check's solve is stuck on; false when no split is allowed. */
function splitStalled(lists: CellId[][], sol: Grid, check: readonly Technique[], allowedOnes: number, rng: Rng): boolean {
  const st = solveLogically(puzzleOf(lists, sol), { techniques: check }).state;
  const options: { index: number; weight: number }[] = [];
  lists.forEach((cells, index) => {
    if (cells.length < 2) return;
    let open = 0;
    for (const c of cells) if (!st.grid[c]) open += popcount(st.cand[c]!) - 1;
    if (open > 0) options.push({ index, weight: open * open });
  });
  const have = ones(lists);
  while (options.length) {
    const choice = pickWeighted(
      rng,
      options,
      options.map((o) => o.weight),
    );
    const splits = connectedSplits(lists[choice.index]!).filter(
      ([a, b]) => have + (a.length === 1 ? 1 : 0) + (b.length === 1 ? 1 : 0) <= allowedOnes,
    );
    if (splits.length) {
      const [a, b] = splits[Math.floor(rng() * splits.length)]!;
      lists[choice.index] = a;
      lists.push(b);
      return true;
    }
    options.splice(options.indexOf(choice), 1);
  }
  return false;
}

/** Neighbouring cage pairs that may merge, shuffled, those absorbing a one-cell cage first. */
function mergeMoves(lists: readonly CellId[][], sol: Grid, maxSize: number, rng: Rng): [number, number][] {
  const owner = ownerOf(lists);
  const seen = new Set<number>();
  const moves: [number, number][] = [];
  for (let c = 0; c < 81; c++)
    for (const n of NEIGHBOURS[c]!) {
      const a = owner[c]!;
      const b = owner[n]!;
      if (a === b) continue;
      const key = Math.min(a, b) * 1000 + Math.max(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      if (lists[a]!.length + lists[b]!.length > maxSize) continue;
      if (digitsOf(lists[a]!, sol) & digitsOf(lists[b]!, sol)) continue;
      moves.push([a, b]);
    }
  shuffle(rng, moves);
  const absorbs = (m: [number, number]) => lists[m[0]]!.length === 1 || lists[m[1]]!.length === 1;
  return [...moves.filter(absorbs), ...moves.filter((m) => !absorbs(m))];
}

const merge = (lists: readonly CellId[][], [a, b]: [number, number]): CellId[][] => [
  ...lists.filter((_, i) => i !== a && i !== b),
  [...lists[a]!, ...lists[b]!],
];
