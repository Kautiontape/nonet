/**
 * Board profile: what a solve asks of the player, measured along the logical solver's
 * easiest-first path. The grade (grade.ts) is the hardest step; the profile adds how many steps go
 * past the basics, how early the first hard part comes, and how much plain scanning offers on the
 * way. Band rules (bands.ts) are written against it.
 *
 * - `tiers`, `counts`: steps per tier (index 1–5) and per technique id.
 * - `beyond`: steps above the mode's floor, the Easy band's ceiling (`FLOOR`): singles in classic,
 *   tier 2 in killer and queens. `advanced`: steps at tier 4 and up.
 * - `walls`, `firstWall`: a wall is a stretch of the solve where the floor finds nothing to do.
 *   - Classic: scanning the digits on the board (hidden and naked singles, no notes) finds no
 *     placement. One stretch counts once, however many steps it takes to get past.
 *   - Killer and queens: a run of steps above the floor (or the point where the solver is stuck).
 *   `firstWall` is how much of the board is still open when the first wall comes: empty squares
 *   (sudoku) or cells that could still hold a queen (queens); null when there's no wall.
 * - `scan`: what scanning offers at each state before a step (`scanSudoku`, `scanQueens`):
 *   placements in sudoku (killer scans the cage-sum candidates auto-notes would show); in queens,
 *   rows, columns and regions that say something on their own. The state before the last step
 *   (one square or queen left) is left out, so `min` and `ones` describe real bottlenecks.
 *   `early` is the mean over the first 25 states: Pelánek's "dependency" metric, the best
 *   predictor of human solving time among singles-only puzzles (late states offer plenty on any
 *   board). `median` is the upper median. `scan: false` skips it where walls don't need it (killer,
 *   queens): a killer scan costs five to six times the solve.
 */
import { basicCandidates, comboCandidates } from "./candidates";
import { cageCombos } from "./combos";
import { boxOf, colOf, HOUSE_CELLS, rowOf } from "./geometry";
import { nextStep, type LogicalOptions } from "./logical";
import { nextStep as queensNextStep } from "./queens/logical";
import {
  applyStep as queensApplyStep,
  findEmptyUnit,
  initialState,
  isSolved as queensIsSolved,
  type QState,
} from "./queens/state";
import type { QStep, QueensPuzzle } from "./queens/types";
import { applyStep, createState, isBroken, isSolved } from "./state";
import { TECHNIQUES } from "./techniques";
import { puzzleKind, type Cage, type CellId, type Grid, type Puzzle, type PuzzleKind, type Step } from "./types";

/** States that `scan.early` averages over. */
export const EARLY_STATES = 25;

/** The Easy band's ceiling per mode: steps above it count as `beyond`, and make walls. */
export const FLOOR = { classic: 1, killer: 2, queens: 2 } as const;

export interface ScanStats {
  /** States scanned: one before each step. */
  states: number;
  min: number;
  median: number;
  mean: number;
  /** Mean over the first `EARLY_STATES` states. */
  early: number;
  /** States where scanning offered exactly one thing. */
  ones: number;
}

export interface CageStats {
  count: number;
  /** sizes[s] = cages of s cells (index 0..9). */
  sizes: number[];
  max: number;
  /** Cages of 2+ cells whose sum has only one digit combination. */
  unique: number;
  /** Cages inside one box. */
  inBox: number;
  /** Cages inside one row or column. */
  inLine: number;
}

interface ProfileBase {
  solved: boolean;
  /** The `stop` test ended the solve early: counts so far are lower bounds. */
  stopped: boolean;
  steps: number;
  /** Hardest tier and rating used, and the technique of the highest-rated step (first if tied). */
  tier: number;
  rating: number;
  hardest: string | null;
  /** tiers[t] = steps at tier t (index 0 unused). */
  tiers: number[];
  counts: Record<string, number>;
  /** Technique ids in order of first use. */
  techniques: string[];
  beyond: number;
  advanced: number;
  walls: number;
  firstWall: number | null;
  /** Filled in when the solve ends; a `stop` test sees zeros. */
  scan: ScanStats;
}

export interface SudokuProfile extends ProfileBase {
  mode: PuzzleKind;
  givens: number;
  /** Steps by techniques that assume a unique solution (unique rectangles, BUG+1). */
  uniqueness: number;
  /** 45-rule steps over one house, and over two or more. */
  innies: { single: number; multi: number };
  /** Killer only. */
  cages: CageStats | null;
}

export interface QueensProfile extends ProfileBase {
  mode: "queens";
  n: number;
  regions: {
    /** Region sizes, ascending. */
    sizes: number[];
    /** Regions of three cells or fewer. */
    tiny: number;
  };
}

export interface ProfileOptions extends LogicalOptions {
  /** Default true; false skips the scan stats in killer (classic always scans: walls need it). */
  scan?: boolean;
  /** Called after each step; returning true ends the solve there (`stopped`). */
  stop?: (profile: SudokuProfile, step: Step) => boolean;
}

export interface QueensProfileOptions {
  /** Skip techniques above this tier (default 5). */
  maxTier?: number;
  /** Default true; false skips the scan stats. */
  scan?: boolean;
  stop?: (profile: QueensProfile, step: QStep) => boolean;
}

const UNIQUENESS = new Set(TECHNIQUES.filter((t) => t.assumesUnique).map((t) => t.id));

function emptyBase(): ProfileBase {
  return {
    solved: false,
    stopped: false,
    steps: 0,
    tier: 0,
    rating: 0,
    hardest: null,
    tiers: [0, 0, 0, 0, 0, 0],
    counts: {},
    techniques: [],
    beyond: 0,
    advanced: 0,
    walls: 0,
    firstWall: null,
    scan: { states: 0, min: 0, median: 0, mean: 0, early: 0, ones: 0 },
  };
}

/** Step bookkeeping shared by all modes. */
function count(p: ProfileBase, step: { technique: string; tier: number; rating: number }, floor: number): void {
  p.steps++;
  p.tier = Math.max(p.tier, step.tier);
  if (step.rating > p.rating) {
    p.rating = step.rating;
    p.hardest = step.technique;
  }
  p.tiers[step.tier]!++;
  if (!(step.technique in p.counts)) {
    p.techniques.push(step.technique);
    p.counts[step.technique] = 0;
  }
  p.counts[step.technique]!++;
  if (step.tier > floor) p.beyond++;
  if (step.tier >= 4) p.advanced++;
}

/** `options` has one entry per state before a step; a finished solve drops the last. */
function summarize(options: number[], solved: boolean): ScanStats {
  if (solved) options.pop();
  if (!options.length) return { states: 0, min: 0, median: 0, mean: 0, early: 0, ones: 0 };
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sorted = [...options].sort((a, b) => a - b);
  return {
    states: sorted.length,
    min: sorted[0]!,
    median: sorted[sorted.length >> 1]!,
    mean: mean(sorted),
    early: mean(options.slice(0, EARLY_STATES)),
    ones: sorted.filter((x) => x === 1).length,
  };
}

/** Distinct placements that hidden or naked singles offer on these candidates. */
function countSingles(grid: Grid, cand: Uint16Array): number {
  const found = new Uint16Array(81);
  let n = 0;
  for (const cells of HOUSE_CELLS) {
    let once = 0;
    let twice = 0;
    for (const c of cells) {
      if (grid[c]) continue;
      twice |= once & cand[c]!;
      once |= cand[c]!;
    }
    for (let single = once & ~twice; single; ) {
      const low = single & -single;
      single ^= low;
      for (const c of cells)
        if (!grid[c] && cand[c]! & low) {
          if (!(found[c]! & low)) n++;
          found[c]! |= low;
          break;
        }
    }
  }
  for (let c = 0; c < 81; c++) {
    const m = cand[c]!;
    if (grid[c] || !m || m & (m - 1) || found[c]! & m) continue;
    found[c]! |= m;
    n++;
  }
  return n;
}

/**
 * Placements a player can find by scanning, without notes: hidden and naked singles from the
 * digits on the board. Killer scans the cage-sum candidates (what auto-notes show), so a cage's
 * last square counts.
 */
export function scanSudoku(p: Puzzle, grid: Grid): number {
  const cand = puzzleKind(p) === "killer" ? comboCandidates(p, grid) : basicCandidates(p, grid);
  return countSingles(grid, cand);
}

const allSame = (cells: readonly CellId[], f: (c: CellId) => number): boolean => cells.every((c) => f(c) === f(cells[0]!));

export function cageStats(cages: readonly Cage[]): CageStats {
  const printed = cages.filter((c) => !c.virtual);
  const sizes = new Array<number>(10).fill(0);
  let unique = 0;
  let inBox = 0;
  let inLine = 0;
  for (const { cells, sum } of printed) {
    sizes[cells.length]!++;
    if (cells.length > 1 && cageCombos(cells.length, sum).length === 1) unique++;
    if (allSame(cells, boxOf)) inBox++;
    if (allSame(cells, rowOf) || allSame(cells, colOf)) inLine++;
  }
  let max = 0;
  sizes.forEach((k, s) => k && (max = s));
  return { count: printed.length, sizes, max, unique, inBox, inLine };
}

export function profileSudoku(puzzle: Puzzle, opts: ProfileOptions = {}): SudokuProfile {
  const mode = puzzleKind(puzzle);
  const floor = FLOOR[mode];
  const s = createState(puzzle);
  let empty = s.grid.reduce((n, d) => n + (d ? 0 : 1), 0);
  const p: SudokuProfile = {
    ...emptyBase(),
    mode,
    givens: 81 - empty,
    uniqueness: 0,
    innies: { single: 0, multi: 0 },
    cages: mode === "killer" ? cageStats(puzzle.cages) : null,
  };
  const options: number[] = [];
  let inWall = false;
  const wall = () => {
    if (!inWall) {
      p.walls++;
      p.firstWall ??= empty;
    }
    inWall = true;
  };
  const maxSteps = opts.maxSteps ?? 1000;
  const scanning = mode === "classic" || opts.scan !== false;
  while (!isSolved(s) && p.steps < maxSteps) {
    const offered = scanning ? scanSudoku(puzzle, s.grid) : -1;
    if (scanning) options.push(offered);
    if (mode === "classic") {
      if (offered === 0) wall();
      else inWall = false;
    }
    const step = nextStep(s, opts);
    if (!step) {
      wall();
      break;
    }
    count(p, step, floor);
    if (UNIQUENESS.has(step.technique)) p.uniqueness++;
    if (step.technique === "innies-outies") {
      if ((step.explain.houses as unknown[]).length > 1) p.innies.multi++;
      else p.innies.single++;
    }
    if (mode !== "classic") {
      if (step.tier > floor) wall();
      else inWall = false;
    }
    applyStep(s, step);
    empty -= step.placements.length;
    if (isBroken(s)) break;
    if (opts.stop?.(p, step)) {
      p.stopped = true;
      break;
    }
  }
  p.solved = isSolved(s);
  p.scan = summarize(options, p.solved);
  return p;
}

/**
 * Rows, columns and regions that say something on their own: one cell left (a queen goes there),
 * or every open cell inside one other unit that still has open cells elsewhere (a region in a
 * line, a line in a region: those can be crossed off).
 */
export function scanQueens(s: QState): number {
  const { board } = s;
  let n = 0;
  for (let id = 0; id < board.units.length; id++) {
    const cells = board.cellsByUnit[id]!;
    if (cells.some((c) => s.queens[c])) continue;
    const open = cells.filter((c) => s.possible[c]);
    if (!open.length) continue;
    if (open.length === 1) {
      n++;
      continue;
    }
    // cellUnits is [region, row, col]: a region looks at lines, a line at regions.
    const slots = board.units[id]!.type === "region" ? [1, 2] : [0];
    const says = slots.some((k) => {
      const other = board.cellUnits[open[0]!]![k]!;
      return (
        open.every((c) => board.cellUnits[c]![k] === other) &&
        board.cellsByUnit[other]!.some((c) => s.possible[c] && !board.cellUnits[c]!.includes(id))
      );
    });
    if (says) n++;
  }
  return n;
}

export function profileQueens(puzzle: QueensPuzzle, opts: QueensProfileOptions = {}): QueensProfile {
  const floor = FLOOR.queens;
  let s = initialState(puzzle);
  const sizes = Array.from({ length: puzzle.n }, (_, g) => puzzle.regions.filter((x) => x === g).length).sort(
    (a, b) => a - b,
  );
  const p: QueensProfile = {
    ...emptyBase(),
    mode: "queens",
    n: puzzle.n,
    regions: { sizes, tiny: sizes.filter((k) => k <= 3).length },
  };
  const options: number[] = [];
  let inWall = false;
  const wall = () => {
    if (!inWall) {
      p.walls++;
      p.firstWall ??= s.possible.reduce((a, b) => a + b, 0);
    }
    inWall = true;
  };
  const limit = 2 * s.board.size;
  while (!queensIsSolved(s) && !findEmptyUnit(s) && p.steps <= limit) {
    if (opts.scan !== false) options.push(scanQueens(s));
    const step = queensNextStep(s, opts.maxTier ?? 5);
    if (!step) {
      wall();
      break;
    }
    count(p, step, floor);
    if (step.tier > floor) wall();
    else inWall = false;
    s = queensApplyStep(s, step);
    if (opts.stop?.(p, step)) {
      p.stopped = true;
      break;
    }
  }
  p.solved = queensIsSolved(s);
  p.scan = summarize(options, p.solved);
  return p;
}
