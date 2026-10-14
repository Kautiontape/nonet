import { BANDS, fitsBand, subTargetForSeed, subTargetsOf, SUB_TARGETS, type SubTarget } from "../../src/engine/bands";
import type { QueensProfile, SudokuProfile } from "../../src/engine/profile";

// Made-up profiles: only the fields the band rules read matter.
function sudoku(over: Partial<SudokuProfile> & { counts?: Record<string, number> }): SudokuProfile {
  return {
    mode: "classic",
    givens: 30,
    solved: true,
    stopped: false,
    steps: 51,
    tier: 1,
    rating: 1.2,
    hardest: "hidden-single",
    tiers: [0, 51, 0, 0, 0, 0],
    counts: {},
    techniques: [],
    beyond: 0,
    advanced: 0,
    uniqueness: 0,
    walls: 0,
    firstWall: null,
    scan: { states: 50, min: 2, median: 10, mean: 10, early: 15, ones: 0 },
    innies: { single: 0, multi: 0 },
    cages: null,
    ...over,
  };
}
const killerCages = (oneCell: number, sixCell = 0) => ({
  count: 27,
  sizes: [0, oneCell, 10, 8, 5, 2, sixCell, 0, 0, 0],
  max: sixCell ? 6 : 5,
  unique: 2,
  inBox: 10,
  inLine: 6,
});
function queens(over: Partial<QueensProfile>): QueensProfile {
  return {
    mode: "queens",
    n: 8,
    solved: true,
    stopped: false,
    steps: 16,
    tier: 3,
    rating: 3.5,
    hardest: "confinement",
    tiers: [0, 8, 6, 2, 0, 0],
    counts: {},
    techniques: [],
    beyond: 2,
    advanced: 0,
    walls: 1,
    firstWall: 30,
    scan: { states: 15, min: 0, median: 1, mean: 1, early: 1, ones: 4 },
    regions: { sizes: [2, 3, 5, 7, 9, 10, 12, 16], tiny: 2 },
    ...over,
  };
}

describe("subTargetForSeed", () => {
  it("depends only on the mode, band and seed", () => {
    expect(subTargetForSeed("classic", "easy", 7)).toBe(subTargetForSeed("classic", "easy", 7));
  });

  it("draws about 1 in 4 breathers and 1 in 6 stretches", () => {
    const n = 6000;
    const tally: Record<SubTarget, number> = { breather: 0, standard: 0, stretch: 0 };
    for (let seed = 1; seed <= n; seed++) tally[subTargetForSeed("killer", "hard", seed)]++;
    expect(tally.breather / n).toBeCloseTo(1 / 4, 1);
    expect(tally.stretch / n).toBeCloseTo(1 / 6, 1);
    expect(tally.standard / n).toBeCloseTo(7 / 12, 1);
  });
});

describe("Classic bands", () => {
  it("Easy: cross-hatching only, never down to one square, sub-target by early options", () => {
    expect(subTargetsOf("classic", "easy", sudoku({ scan: { states: 50, min: 2, median: 12, mean: 12, early: 19, ones: 0 } }))).toEqual(["breather"]);
    expect(subTargetsOf("classic", "easy", sudoku({ scan: { states: 50, min: 2, median: 12, mean: 12, early: 18, ones: 0 } }))).toEqual(["breather"]);
    expect(subTargetsOf("classic", "easy", sudoku({ scan: { states: 50, min: 2, median: 9, mean: 9, early: 17.9, ones: 0 } }))).toEqual(["standard"]);
    expect(subTargetsOf("classic", "easy", sudoku({ scan: { states: 50, min: 2, median: 7, mean: 7, early: 10, ones: 0 } }))).toEqual(["stretch"]);
    expect(fitsBand("classic", "easy", sudoku({ scan: { states: 50, min: 2, median: 6, mean: 6, early: 9.9, ones: 0 } }))).toBe(false);
    // a naked single, a moment with one square, or any step past singles: not Easy
    expect(fitsBand("classic", "easy", sudoku({ counts: { "naked-single": 1 } }))).toBe(false);
    expect(fitsBand("classic", "easy", sudoku({ scan: { states: 50, min: 1, median: 10, mean: 10, early: 15, ones: 1 } }))).toBe(false);
    expect(fitsBand("classic", "easy", sudoku({ tier: 2, walls: 1, firstWall: 20, beyond: 1 }))).toBe(false);
  });

  it("Medium: one or two late walls; pairs only in stretches", () => {
    const medium = (over: Partial<SudokuProfile>) => sudoku({ tier: 2, walls: 1, ...over });
    expect(subTargetsOf("classic", "medium", medium({ firstWall: 22, beyond: 1 }))).toEqual(["breather"]);
    expect(subTargetsOf("classic", "medium", medium({ firstWall: 27, beyond: 2 }))).toEqual(["standard"]);
    expect(subTargetsOf("classic", "medium", medium({ firstWall: 27, beyond: 3 }))).toEqual(["standard", "stretch"]);
    expect(subTargetsOf("classic", "medium", medium({ firstWall: 33, beyond: 4 }))).toEqual(["stretch"]);
    expect(subTargetsOf("classic", "medium", medium({ firstWall: 27, beyond: 2, counts: { "naked-pair": 1 } }))).toEqual([]);
    expect(subTargetsOf("classic", "medium", medium({ firstWall: 30, beyond: 3, counts: { "hidden-pair": 1 } }))).toEqual(["stretch"]);
    expect(fitsBand("classic", "medium", medium({ firstWall: 35, beyond: 3 }))).toBe(false);
    expect(fitsBand("classic", "medium", medium({ walls: 3, firstWall: 30, beyond: 4 }))).toBe(false);
    expect(fitsBand("classic", "medium", medium({ tier: 3, firstWall: 25, beyond: 2 }))).toBe(false);
  });

  it("Hard: tier 3 needed, sub-target by how many tier-3 steps", () => {
    const hard = (t3: number) => sudoku({ tier: 3, tiers: [0, 45, 3, t3, 0, 0], walls: 1, firstWall: 30, beyond: 3 + t3 });
    expect(subTargetsOf("classic", "hard", hard(1))).toEqual(["breather"]);
    expect(subTargetsOf("classic", "hard", hard(2))).toEqual(["standard"]);
    expect(subTargetsOf("classic", "hard", hard(5))).toEqual(["stretch"]);
    expect(fitsBand("classic", "hard", sudoku({ tier: 2, counts: { "naked-pair": 2 }, walls: 1, firstWall: 30, beyond: 4 }))).toBe(false);
    expect(fitsBand("classic", "hard", sudoku({ tier: 4, tiers: [0, 45, 3, 2, 1, 0], advanced: 1 }))).toBe(false);
  });

  it("Expert: 3+ tier-4+ steps; breathers have no chains", () => {
    const expert = (advanced: number, counts: Record<string, number> = {}) => sudoku({ tier: 4, advanced, counts });
    expect(subTargetsOf("classic", "expert", expert(3, { "w-wing": 3 }))).toEqual(["breather", "standard"]);
    expect(subTargetsOf("classic", "expert", expert(4, { aic: 1, "w-wing": 3 }))).toEqual(["standard"]);
    expect(subTargetsOf("classic", "expert", expert(7, { "xy-chain": 2, "w-wing": 5 }))).toEqual(["stretch"]);
    expect(subTargetsOf("classic", "expert", expert(6, { "w-wing": 6 }))).toEqual(["breather", "stretch"]);
    expect(fitsBand("classic", "expert", expert(2, { aic: 2 }))).toBe(false);
    expect(BANDS.classic.expert.cap).toBe(0.4);
    expect(BANDS.classic.medium.cap).toBeUndefined();
  });
});

describe("Killer bands", () => {
  const k = (over: Partial<SudokuProfile>) => sudoku({ mode: "killer", givens: 0, cages: killerCages(0), ...over });

  it("Easy: tier 1–2, sub-target by one-cell cages", () => {
    expect(subTargetsOf("killer", "easy", k({ tier: 2, cages: killerCages(6) }))).toEqual(["breather"]);
    expect(subTargetsOf("killer", "easy", k({ tier: 2, cages: killerCages(3) }))).toEqual(["standard"]);
    expect(subTargetsOf("killer", "easy", k({ tier: 2, cages: killerCages(1) }))).toEqual(["stretch"]);
    expect(subTargetsOf("killer", "easy", k({ tier: 2, cages: killerCages(0) }))).toEqual([]);
    expect(fitsBand("killer", "easy", k({ tier: 2, cages: killerCages(7) }))).toBe(false);
    expect(fitsBand("killer", "easy", k({ tier: 3, cages: killerCages(4), innies: { single: 1, multi: 0 } }))).toBe(false);
  });

  it("Medium: single-house 45s only, the first needed before 11 squares are filled", () => {
    const m = (single: number, oneCell: number, firstWall = 79) =>
      k({ tier: 3, tiers: [0, 90, 80, single, 0, 0], innies: { single, multi: 0 }, cages: killerCages(oneCell), walls: 1, firstWall, beyond: single });
    expect(subTargetsOf("killer", "medium", m(1, 2))).toEqual(["breather"]);
    expect(subTargetsOf("killer", "medium", m(2, 0))).toEqual(["standard"]);
    expect(subTargetsOf("killer", "medium", m(4, 0))).toEqual(["stretch"]);
    expect(subTargetsOf("killer", "medium", m(1, 0))).toEqual([]);
    expect(subTargetsOf("killer", "medium", m(2, 1))).toEqual([]);
    expect(fitsBand("killer", "medium", m(2, 0, 71))).toBe(true); // 10 squares filled first
    expect(fitsBand("killer", "medium", m(2, 0, 70))).toBe(false); // 11
    expect(fitsBand("killer", "medium", k({ tier: 3, tiers: [0, 90, 80, 2, 0, 0], innies: { single: 1, multi: 1 }, walls: 1, firstWall: 80 }))).toBe(false);
    expect(fitsBand("killer", "medium", k({ tier: 3, tiers: [0, 90, 80, 3, 0, 0], innies: { single: 2, multi: 0 }, walls: 1, firstWall: 80 }))).toBe(false);
  });

  it("Hard: harder 45s or tier-3 techniques, stuck at 3+ points, sub-target by 45 count", () => {
    const h = (total: number, walls = 5, multi = 1) =>
      k({ tier: 3, tiers: [0, 90, 80, total, 0, 0], innies: { single: total - multi, multi }, walls, firstWall: 81, beyond: total });
    expect(subTargetsOf("killer", "hard", h(5))).toEqual(["breather"]);
    expect(subTargetsOf("killer", "hard", h(8))).toEqual(["standard"]);
    expect(subTargetsOf("killer", "hard", h(12))).toEqual(["stretch"]);
    expect(fitsBand("killer", "hard", h(8, 2))).toBe(false);
    expect(fitsBand("killer", "hard", h(8, 5, 0))).toBe(false); // single-house 45s only: Medium's ground
    expect(fitsBand("killer", "hard", k({ ...h(8), cages: killerCages(1) }))).toBe(false);
  });

  it("Expert: 2+ tier-4+ steps, no one-cell cages, at most two 6-cell cages", () => {
    const x = (advanced: number, oneCell = 0, sixCell = 1) => k({ tier: 5, advanced, cages: killerCages(oneCell, sixCell) });
    expect(subTargetsOf("killer", "expert", x(2))).toEqual(["breather"]);
    expect(subTargetsOf("killer", "expert", x(4))).toEqual(["standard"]);
    expect(subTargetsOf("killer", "expert", x(5))).toEqual(["stretch"]);
    expect(fitsBand("killer", "expert", x(1))).toBe(false);
    expect(fitsBand("killer", "expert", x(3, 1))).toBe(false);
    expect(fitsBand("killer", "expert", x(3, 0, 3))).toBe(false);
  });
});

describe("Queens bands", () => {
  it("Easy: tier 2, never stuck, 6×6 or 7×7", () => {
    const e = (n: number) => queens({ n, tier: 2, tiers: [0, 6, 3, 0, 0, 0], walls: 0, firstWall: null, beyond: 0 });
    expect(subTargetsOf("queens", "easy", e(6))).toEqual(["breather", "standard"]);
    expect(subTargetsOf("queens", "easy", e(7))).toEqual(["standard", "stretch"]);
    expect(fitsBand("queens", "easy", e(8))).toBe(false);
    expect(fitsBand("queens", "easy", queens({ n: 6, tier: 1, tiers: [0, 6, 0, 0, 0, 0], walls: 0, beyond: 0 }))).toBe(false);
  });

  it("Medium and Hard: touch and counting, told apart by how often you're stuck", () => {
    expect(subTargetsOf("queens", "medium", queens({ n: 7, walls: 1 }))).toEqual(["breather"]);
    expect(subTargetsOf("queens", "medium", queens({ n: 8, walls: 1 }))).toEqual(["standard"]);
    expect(subTargetsOf("queens", "medium", queens({ n: 8, walls: 2 }))).toEqual(["standard", "stretch"]);
    expect(fitsBand("queens", "medium", queens({ n: 8, walls: 3 }))).toBe(false);
    expect(subTargetsOf("queens", "hard", queens({ n: 8, tier: 4, walls: 3 }))).toEqual(["breather"]);
    expect(subTargetsOf("queens", "hard", queens({ n: 9, walls: 3 }))).toEqual(["standard"]);
    expect(subTargetsOf("queens", "hard", queens({ n: 9, walls: 4 }))).toEqual(["stretch"]);
    expect(fitsBand("queens", "hard", queens({ n: 9, tier: 5, walls: 4, counts: { contradiction: 1 } }))).toBe(false);
  });

  it("Expert: 2–8 contradictions", () => {
    const x = (n: number, c: number) => queens({ n, tier: 5, walls: 3, counts: { contradiction: c } });
    expect(subTargetsOf("queens", "expert", x(9, 2))).toEqual(["breather"]);
    expect(subTargetsOf("queens", "expert", x(10, 4))).toEqual(["standard"]);
    expect(subTargetsOf("queens", "expert", x(10, 7))).toEqual(["stretch"]);
    expect(fitsBand("queens", "expert", x(9, 1))).toBe(false);
    expect(fitsBand("queens", "expert", x(10, 9))).toBe(false);
  });
});

describe("every sub-target has a rule", () => {
  it("covers all modes and bands", () => {
    for (const mode of ["classic", "killer", "queens"] as const)
      for (const band of ["easy", "medium", "hard", "expert"] as const)
        for (const st of SUB_TARGETS) expect(typeof BANDS[mode][band].sub[st]).toBe("function");
  });
});
