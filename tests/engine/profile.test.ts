import { readFileSync } from "node:fs";
import { decodeSudoku, type SudokuPackEntry } from "../../src/engine/pack";
import { FLOOR, profileQueens, profileSudoku, scanQueens, scanSudoku } from "../../src/engine/profile";
import { decodeQueens, type QueensPackEntry } from "../../src/engine/queens/pack";
import type { Puzzle } from "../../src/engine/types";
import { state, UNIQUE5 } from "./queens/fixtures";

const entry = <T>(key: string, i: number): T =>
  (JSON.parse(readFileSync(`public/packs/${key}.json`, "utf8")) as { puzzles: T[] }).puzzles[i]!;
const sudoku = (key: string, i = 0) => decodeSudoku(entry<SudokuPackEntry>(key, i));
const queens = (key: string, i = 0) => decodeQueens(entry<QueensPackEntry>(key, i));

// Expected values below come from research/prototypes/filter.mts's scan (an independent
// implementation): hidden + naked singles from the digits on the board, no notes.

describe("profileSudoku: classic", () => {
  it("an Easy board: singles only, never stuck", () => {
    const p = profileSudoku(sudoku("classic-easy"));
    expect(p).toMatchObject({
      mode: "classic",
      givens: 36,
      solved: true,
      stopped: false,
      steps: 45,
      tier: 1,
      hardest: "hidden-single",
      tiers: [0, 45, 0, 0, 0, 0],
      counts: { "hidden-single": 26, "full-house": 19 },
      beyond: 0,
      advanced: 0,
      walls: 0,
      firstWall: null,
      scan: { states: 44, min: 2, median: 11, ones: 0, early: 12.24 },
      innies: { single: 0, multi: 0 },
      cages: null,
    });
  });

  it("a Medium board with two walls", () => {
    const p = profileSudoku(sudoku("classic-medium", 5));
    expect(p).toMatchObject({
      givens: 29,
      steps: 58,
      tier: 2,
      tiers: [0, 52, 6, 0, 0, 0],
      beyond: 6,
      walls: 2,
      firstWall: 34,
      scan: { min: 0, median: 5, ones: 2, early: 4.44 },
    });
    expect(p.counts).toMatchObject({ pointing: 5, claiming: 1 });
  });

  it("keeps pairs apart from pointing and claiming", () => {
    const p = profileSudoku(sudoku("classic-medium", 4));
    expect(p.counts["naked-pair"]).toBe(1);
    expect(p).toMatchObject({ beyond: 1, walls: 1, firstWall: 25 });
  });

  it("an Expert board: walls, tier counts and advanced steps", () => {
    const p = profileSudoku(sudoku("classic-expert"));
    expect(p).toMatchObject({
      steps: 62,
      tier: 4,
      tiers: [0, 51, 6, 3, 2, 0],
      beyond: 11,
      advanced: 2,
      walls: 5,
      firstWall: 48,
      scan: { median: 3, ones: 6, early: 1.12 },
      uniqueness: 0,
    });
  });

  it("counts steps that assume a unique solution, and passes solver options through", () => {
    const board = sudoku("classic-expert", 1); // uses a unique rectangle
    expect(profileSudoku(board).uniqueness).toBeGreaterThan(0);
    const strict = profileSudoku(board, { noUniqueness: true });
    expect(strict.uniqueness).toBe(0);
    expect(strict.counts["unique-rectangle"]).toBeUndefined();
  });

  it("stops at the first wall when capped at the floor", () => {
    const p = profileSudoku(sudoku("classic-medium", 5), { maxTier: FLOOR.classic });
    expect(p).toMatchObject({ solved: false, stopped: false, walls: 1, firstWall: 34, beyond: 0 });
    expect(p.steps).toBe(81 - 29 - 34);
  });

  it("stops early when the stop test says so", () => {
    const p = profileSudoku(sudoku("classic-expert"), { stop: (prof) => prof.beyond > 3 });
    expect(p).toMatchObject({ solved: false, stopped: true, beyond: 4 });
    expect(p.steps).toBeLessThan(62);
  });

  it("one empty square: a full house, nothing else", () => {
    const solution = sudoku("classic-easy").solution!;
    const givens: Record<number, number> = {};
    for (let c = 1; c < 81; c++) givens[c] = Number(solution[c]);
    const p = profileSudoku({ id: "x", kind: "classic", cages: [], givens });
    expect(p).toMatchObject({ givens: 80, steps: 1, counts: { "full-house": 1 }, walls: 0, scan: { states: 0 } });
  });
});

describe("profileSudoku: killer", () => {
  it("45-rule steps by house count, walls above tier 2, cage stats", () => {
    const p = profileSudoku(sudoku("killer-medium"));
    expect(p).toMatchObject({
      mode: "killer",
      givens: 0,
      solved: true,
      steps: 185,
      tiers: [0, 98, 85, 2, 0, 0],
      beyond: 2,
      innies: { single: 2, multi: 0 },
      walls: 2,
      firstWall: 71,
      cages: { count: 27, sizes: [0, 1, 12, 5, 4, 5, 0, 0, 0, 0], max: 5, unique: 2, inBox: 16 },
    });
  });

  it("an Expert board, without the scan", () => {
    const p = profileSudoku(sudoku("killer-expert"), { scan: false });
    expect(p.scan.states).toBe(0);
    expect(p).toMatchObject({
      tiers: [0, 98, 87, 24, 0, 2],
      advanced: 2,
      innies: { single: 15, multi: 7 },
      walls: 16,
      firstWall: 81,
      cages: { count: 27, sizes: [0, 0, 11, 10, 3, 1, 2, 0, 0, 0], max: 6 },
    });
  });
});

describe("scanSudoku", () => {
  it("classic: hidden and naked singles from the board's digits, each placement once", () => {
    const start = (p: Puzzle) => {
      const grid = new Uint8Array(81);
      for (const [c, d] of Object.entries(p.givens!)) grid[Number(c)] = d;
      return grid;
    };
    const easy = sudoku("classic-easy");
    expect(scanSudoku(easy, start(easy))).toBe(8); // 7 hidden singles, 1 more naked
    const medium = sudoku("classic-medium");
    expect(scanSudoku(medium, start(medium))).toBe(3);
  });

  it("killer: a cage's last square counts", () => {
    const p: Puzzle = sudoku("killer-medium");
    const grid = new Uint8Array(81);
    const cage = p.cages.find((c) => c.cells.length === 2)!;
    grid[cage.cells[0]!] = Number(p.solution![cage.cells[0]!]);
    expect(scanSudoku(p, grid)).toBeGreaterThanOrEqual(1);
  });
});

describe("profileQueens", () => {
  it("a Medium board", () => {
    const p = profileQueens(queens("queens-medium"));
    expect(p).toMatchObject({
      mode: "queens",
      n: 8,
      solved: true,
      steps: 18,
      tier: 3,
      hardest: "confinement",
      tiers: [0, 8, 9, 1, 0, 0],
      counts: { "region-in-line": 5, "last-cell": 8, "line-in-region": 1, touch: 3, confinement: 1 },
      beyond: 1,
      advanced: 0,
      walls: 1,
      firstWall: 23,
      regions: { sizes: [2, 3, 4, 7, 9, 9, 12, 18], tiny: 2 },
    });
  });

  it("an Expert board", () => {
    const p = profileQueens(queens("queens-expert"));
    expect(p).toMatchObject({ n: 9, tiers: [0, 9, 3, 4, 1, 3], beyond: 8, advanced: 4, walls: 3, firstWall: 53 });
  });

  it("stops early when asked", () => {
    const p = profileQueens(queens("queens-expert"), { stop: (prof) => prof.beyond >= 1 });
    expect(p).toMatchObject({ stopped: true, solved: false, beyond: 1 });
  });
});

describe("scanQueens", () => {
  it("counts units that tell you something on their own", () => {
    // Region 0 is one cell: a last cell (and a region in a line, but it's one unit).
    expect(scanQueens(state(UNIQUE5))).toBe(1);
    // Queen on r1c1: rows 2–5 and columns 2–5 lose cells, region 0 is done.
    const s = state(UNIQUE5, "", "r1c1");
    expect(scanQueens(s)).toBeGreaterThan(0);
  });
});
