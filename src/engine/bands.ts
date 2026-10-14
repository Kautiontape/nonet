/**
 * Bands as data: what every board in a band must be, and what each sub-target asks for, written
 * against the board profile (profile.ts), never against tiers or ratings alone. Approved by Shawn on
 * 2026-10-14; the measurements behind each number are in docs/generator-research.md.
 *
 * Each seed draws a sub-target before its board is made (`subTargetForSeed`): about 1 in 4 a
 * breather (the gentle end of the band), about 1 in 6 a stretch (the top), the rest standard.
 * Ranges are half-open, [min, max). A board can fit more than one sub-target where ranges meet;
 * `subTargetsOf` returns them all and the pack builder decides which quota it fills.
 *
 * Generators read the same numbers to aim at a sub-target.
 */
import type { QueensProfile, SudokuProfile } from "./profile";
import { hashSeed, mulberry32 } from "./rng";
import type { Difficulty } from "./types";

export type Mode = "classic" | "killer" | "queens";
export type SubTarget = "breather" | "standard" | "stretch";
export const SUB_TARGETS: readonly SubTarget[] = ["breather", "standard", "stretch"];
export const SUB_TARGET_SHARE: Record<SubTarget, number> = { breather: 1 / 4, standard: 7 / 12, stretch: 1 / 6 };

/** The sub-target a seed aims at; it depends on nothing but the mode, band and seed. */
export function subTargetForSeed(mode: Mode, band: Difficulty, seed: number): SubTarget {
  const r = mulberry32(hashSeed("sub-target", mode, band, seed))();
  if (r < SUB_TARGET_SHARE.breather) return "breather";
  return r < SUB_TARGET_SHARE.breather + SUB_TARGET_SHARE.stretch ? "stretch" : "standard";
}

/** [min, max) */
export type Range = readonly [number, number];
export const within = (x: number, [lo, hi]: Range): boolean => x >= lo && x < hi;

// --- the numbers ---------------------------------------------------------------------------------

/** Classic Easy: early options (placements scanning offers, mean over the first 25 states). */
export const CLASSIC_EASY_EARLY: Record<SubTarget, Range> = { breather: [18, Infinity], standard: [14, 18], stretch: [10, 14] };
/** Classic Medium: latest first wall (empty squares left), steps past singles, pairs allowed. */
export const CLASSIC_MEDIUM: Record<SubTarget, { wall: number; beyond: Range; pairs: boolean }> = {
  breather: { wall: 24, beyond: [1, 2], pairs: false },
  standard: { wall: 28, beyond: [2, 4], pairs: false },
  stretch: { wall: 34, beyond: [3, 6], pairs: true },
};
/** Classic Hard: tier-3 steps. */
export const CLASSIC_HARD_TIER3: Record<SubTarget, Range> = { breather: [1, 2], standard: [2, 3], stretch: [3, Infinity] };
/** Classic Expert: tier-4+ steps (breathers also have no chains). */
export const CLASSIC_EXPERT_ADVANCED: Record<SubTarget, Range> = { breather: [3, Infinity], standard: [3, 6], stretch: [6, Infinity] };
/** Killer Easy: one-cell cages. */
export const KILLER_EASY_FREEBIES: Record<SubTarget, Range> = { breather: [5, 7], standard: [3, 5], stretch: [1, 3] };
/** Killer Medium: 45-rule steps (one house each) and one-cell cages. */
export const KILLER_MEDIUM: Record<SubTarget, { innies: Range; freebies: Range }> = {
  breather: { innies: [1, 2], freebies: [1, 3] },
  standard: { innies: [2, 3], freebies: [0, 1] },
  stretch: { innies: [3, 5], freebies: [0, 1] },
};
/** Killer Medium: the first 45 is needed before more than this many squares are filled. */
export const KILLER_MEDIUM_OPENER = 10;
/** Killer Hard: 45-rule steps. */
export const KILLER_HARD_INNIES: Record<SubTarget, Range> = { breather: [0, 6], standard: [6, 12], stretch: [12, Infinity] };
/** Killer Expert: tier-4+ steps. */
export const KILLER_EXPERT_ADVANCED: Record<SubTarget, Range> = { breather: [2, 3], standard: [3, 5], stretch: [5, Infinity] };
/** Killer Expert: most 6-cell cages; no cage is larger. */
export const KILLER_EXPERT_SIX_CELL = 2;
/** Queens board sizes per band and sub-target. */
export const QUEENS_SIZES: Record<Difficulty, Record<SubTarget, readonly number[]>> = {
  easy: { breather: [6], standard: [6, 7], stretch: [7] },
  medium: { breather: [7], standard: [8], stretch: [8] },
  hard: { breather: [8], standard: [9], stretch: [9] },
  expert: { breather: [9], standard: [9, 10], stretch: [10] },
};
/** Queens Medium and Hard: walls, the separate times the basics run out. */
export const QUEENS_WALLS: Record<"medium" | "hard", Record<SubTarget, Range>> = {
  medium: { breather: [1, 2], standard: [1, 3], stretch: [2, 3] },
  hard: { breather: [3, 4], standard: [3, 4], stretch: [4, Infinity] },
};
/** Queens Expert: contradiction steps. */
export const QUEENS_EXPERT_CONTRADICTIONS: Record<SubTarget, Range> = { breather: [2, 3], standard: [3, 6], stretch: [6, 9] };
/** Classic Expert: most of a pack any one hardest-step technique may take. */
export const CLASSIC_EXPERT_CAP = 0.4;

// --- profile readings ------------------------------------------------------------------------------

const count = (p: { counts: Record<string, number> }, ...ids: string[]) => ids.reduce((n, id) => n + (p.counts[id] ?? 0), 0);
const pairs = (p: SudokuProfile) => count(p, "naked-pair", "hidden-pair");
const chains = (p: SudokuProfile) => count(p, "x-chain", "xy-chain", "aic");
const innies = (p: SudokuProfile) => p.innies.single + p.innies.multi;
const freebies = (p: SudokuProfile) => p.cages?.sizes[1] ?? 0;
/** Squares the player fills before the first wall. */
export const filledBeforeWall = (p: SudokuProfile): number => (p.firstWall === null ? Infinity : 81 - p.givens - p.firstWall);

// --- the bands -------------------------------------------------------------------------------------

export interface Band<P> {
  every(p: P): boolean;
  sub: Record<SubTarget, (p: P) => boolean>;
  /** Most of a pack any one hardest-step technique may take (the pack builder applies it). */
  cap?: number;
}
type Bands<P> = Record<Difficulty, Band<P>>;

const per = <P>(f: (st: SubTarget, p: P) => boolean): Record<SubTarget, (p: P) => boolean> => ({
  breather: (p) => f("breather", p),
  standard: (p) => f("standard", p),
  stretch: (p) => f("stretch", p),
});

const CLASSIC: Bands<SudokuProfile> = {
  easy: {
    every: (p) => p.solved && p.tier <= 1 && p.walls === 0 && count(p, "naked-single") === 0 && p.scan.min >= 2,
    sub: per((st, p) => within(p.scan.early, CLASSIC_EASY_EARLY[st])),
  },
  medium: {
    every: (p) => p.solved && p.tier === 2 && p.walls >= 1 && p.walls <= 2 && p.firstWall !== null && p.firstWall <= CLASSIC_MEDIUM.stretch.wall,
    sub: per((st, p) => {
      const t = CLASSIC_MEDIUM[st];
      return (t.pairs || pairs(p) === 0) && p.firstWall! <= t.wall && within(p.beyond, t.beyond);
    }),
  },
  hard: {
    every: (p) => p.solved && p.tier === 3,
    sub: per((st, p) => within(p.tiers[3]!, CLASSIC_HARD_TIER3[st])),
  },
  expert: {
    every: (p) => p.solved && p.advanced >= CLASSIC_EXPERT_ADVANCED.standard[0],
    sub: per((st, p) => within(p.advanced, CLASSIC_EXPERT_ADVANCED[st]) && (st !== "breather" || chains(p) === 0)),
    cap: CLASSIC_EXPERT_CAP,
  },
};

const KILLER: Bands<SudokuProfile> = {
  easy: {
    every: (p) => p.solved && p.tier <= 2 && freebies(p) < KILLER_EASY_FREEBIES.breather[1],
    sub: per((st, p) => within(freebies(p), KILLER_EASY_FREEBIES[st])),
  },
  medium: {
    every: (p) =>
      p.solved && p.tier === 3 && p.innies.multi === 0 && p.tiers[3] === innies(p) && filledBeforeWall(p) <= KILLER_MEDIUM_OPENER,
    sub: per((st, p) => within(innies(p), KILLER_MEDIUM[st].innies) && within(freebies(p), KILLER_MEDIUM[st].freebies)),
  },
  hard: {
    every: (p) => p.solved && p.tier === 3 && (p.innies.multi > 0 || p.tiers[3]! > innies(p)) && p.walls >= 3 && freebies(p) === 0,
    sub: per((st, p) => within(innies(p), KILLER_HARD_INNIES[st])),
  },
  expert: {
    every: (p) =>
      p.solved &&
      p.advanced >= KILLER_EXPERT_ADVANCED.breather[0] &&
      freebies(p) === 0 &&
      (p.cages?.max ?? 0) <= 6 &&
      (p.cages?.sizes[6] ?? 0) <= KILLER_EXPERT_SIX_CELL,
    sub: per((st, p) => within(p.advanced, KILLER_EXPERT_ADVANCED[st])),
  },
};

const contradictions = (p: QueensProfile) => count(p, "contradiction");
const sized = (band: Difficulty, st: SubTarget, p: QueensProfile) => QUEENS_SIZES[band][st].includes(p.n);

const QUEENS: Bands<QueensProfile> = {
  easy: {
    every: (p) => p.solved && p.tier === 2,
    sub: per((st, p) => sized("easy", st, p)),
  },
  medium: {
    every: (p) => p.solved && (p.tier === 3 || p.tier === 4) && within(p.walls, [1, 3]),
    sub: per((st, p) => sized("medium", st, p) && within(p.walls, QUEENS_WALLS.medium[st])),
  },
  hard: {
    every: (p) => p.solved && (p.tier === 3 || p.tier === 4) && p.walls >= 3,
    sub: per((st, p) => sized("hard", st, p) && within(p.walls, QUEENS_WALLS.hard[st])),
  },
  expert: {
    every: (p) => p.solved && p.tier === 5 && within(contradictions(p), [2, 9]),
    sub: per((st, p) => sized("expert", st, p) && within(contradictions(p), QUEENS_EXPERT_CONTRADICTIONS[st])),
  },
};

export const BANDS = { classic: CLASSIC, killer: KILLER, queens: QUEENS };

/** Every sub-target the board fits, in breather / standard / stretch order (empty: not in the band). */
export function subTargetsOf(mode: "queens", band: Difficulty, p: QueensProfile): SubTarget[];
export function subTargetsOf(mode: "classic" | "killer", band: Difficulty, p: SudokuProfile): SubTarget[];
export function subTargetsOf(mode: Mode, band: Difficulty, p: SudokuProfile | QueensProfile): SubTarget[];
export function subTargetsOf(mode: Mode, band: Difficulty, p: SudokuProfile | QueensProfile): SubTarget[] {
  const b = BANDS[mode][band] as Band<SudokuProfile | QueensProfile>;
  if (!b.every(p)) return [];
  return SUB_TARGETS.filter((st) => b.sub[st](p));
}

export function fitsBand(mode: "queens", band: Difficulty, p: QueensProfile): boolean;
export function fitsBand(mode: "classic" | "killer", band: Difficulty, p: SudokuProfile): boolean;
export function fitsBand(mode: Mode, band: Difficulty, p: SudokuProfile | QueensProfile): boolean;
export function fitsBand(mode: Mode, band: Difficulty, p: SudokuProfile | QueensProfile): boolean {
  return subTargetsOf(mode, band, p).length > 0;
}
