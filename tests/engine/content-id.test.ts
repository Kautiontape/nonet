import { readFileSync } from "node:fs";
import fc from "fast-check";
import { contentId, contentPreimage, cyrb53 } from "../../src/engine/content-id";
import { decodeSudoku, type SudokuPackEntry } from "../../src/engine/pack";
import { decodeQueens, type QueensPackEntry } from "../../src/engine/queens/pack";
import type { QueensPuzzle } from "../../src/engine/queens/types";
import type { Cage, Puzzle } from "../../src/engine/types";

const firstOf = <T>(key: string): T =>
  (JSON.parse(readFileSync(`public/packs/${key}.json`, "utf8")) as { puzzles: T[] }).puzzles[0]!;
const sudoku = (key: string) => decodeSudoku(firstOf<SudokuPackEntry>(key));
const queens = (key: string) => decodeQueens(firstOf<QueensPackEntry>(key));

describe("cyrb53", () => {
  it("matches the published test vectors", () => {
    expect(cyrb53("a")).toBe(7929297801672961);
    expect(cyrb53("b")).toBe(8684336938537663);
    expect(cyrb53("revenge")).toBe(4051478007546757);
    expect(cyrb53("revenue")).toBe(8309097637345594);
  });
});

describe("contentPreimage", () => {
  it("classic: the givens as 81 digits, 0 for blank", () => {
    expect(contentPreimage(sudoku("classic-easy"))).toBe(
      "classic|000030246408600001006001803200010580080702060064050002107500900800004605652080000",
    );
  });

  it("killer: cages labelled by first cell, sums in label order, then the givens", () => {
    const rest = Array.from({ length: 81 }, (_, c) => c).filter((c) => ![0, 1, 2, 9].includes(c));
    const p: Puzzle = {
      id: "x",
      kind: "killer",
      cages: [
        { id: 7, sum: 389, cells: rest },
        { id: 0, sum: 9, cells: [2, 1] },
        { id: 3, sum: 7, cells: [9, 0] },
      ],
      givens: { 80: 4 },
    };
    const labels = new Array<string>(81).fill("2");
    labels[0] = labels[9] = "0";
    labels[1] = labels[2] = "1";
    expect(contentPreimage(p)).toBe(`killer|${labels.join(",")}|7,9,389|${"0".repeat(80)}4`);
  });

  it("killer: virtual cages are not part of the board", () => {
    const p = sudoku("killer-easy");
    const withVirtual: Puzzle = { ...p, cages: [...p.cages, { id: 99, sum: 12, cells: [0, 1], virtual: true }] };
    expect(contentPreimage(withVirtual)).toBe(contentPreimage(p));
  });

  it("queens: n, then regions labelled by first cell", () => {
    const p: QueensPuzzle = { id: "x", n: 4, regions: [2, 2, 0, 0, 2, 1, 1, 0, 3, 3, 1, 0, 3, 3, 3, 0], solution: [] };
    expect(contentPreimage(p)).toBe("queens|4|0,0,1,1,0,2,2,1,3,3,2,1,3,3,3,1");
  });
});

describe("contentId", () => {
  // A permanent format: progress is stored against these. Never update these values; if one
  // changes, the canonical form or the hash changed by mistake.
  it("golden values", () => {
    expect(contentId(sudoku("classic-easy"))).toBe("c2b36jbp5auh");
    expect(contentId(sudoku("classic-expert"))).toBe("c05enp2l0biw");
    expect(contentId(sudoku("killer-easy"))).toBe("k1qlmhr3u72q");
    expect(contentId(sudoku("killer-expert"))).toBe("k0appsaz72dg");
    expect(contentId(queens("queens-easy"))).toBe("q05xuqw41yvv");
    expect(contentId(queens("queens-expert"))).toBe("q10yy9cmqv80");
  });

  it("is a mode letter and 11 base-36 digits", () => {
    for (const key of ["classic-medium", "killer-hard"]) expect(contentId(sudoku(key))).toMatch(/^[ck][0-9a-z]{11}$/);
    expect(contentId(queens("queens-hard"))).toMatch(/^q[0-9a-z]{11}$/);
  });

  it("ignores the id, the seed and every grade field", () => {
    const p = sudoku("classic-hard");
    const bare: Puzzle = { id: "other", kind: "classic", cages: [], givens: p.givens };
    expect(contentId({ ...p, meta: { seed: 9, tier: 1, rating: 9.9, steps: 3, difficulty: "easy" } })).toBe(contentId(bare));
    const q = queens("queens-medium");
    expect(contentId({ ...q, id: "other", solution: [], meta: { seed: 1 } })).toBe(contentId(q));
  });

  it("ignores the solution (only what the player sees counts)", () => {
    const p = sudoku("killer-medium");
    expect(contentId({ ...p, solution: undefined })).toBe(contentId(p));
  });

  it("ignores cage order, cage ids and cell order inside a cage", () => {
    const p = sudoku("killer-medium");
    const id = contentId(p);
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: p.cages.length, maxLength: p.cages.length }), (keys) => {
        const order = p.cages.map((_, i) => i).sort((a, b) => keys[a]! - keys[b]! || a - b);
        const cages: Cage[] = order.map((i, k) => ({
          id: 100 + k,
          sum: p.cages[i]!.sum,
          cells: [...p.cages[i]!.cells].reverse(),
        }));
        return contentId({ ...p, cages }) === id;
      }),
      { numRuns: 50 },
    );
  });

  it("ignores which label each queens region has", () => {
    const q = queens("queens-hard");
    const id = contentId(q);
    fc.assert(
      fc.property(fc.shuffledSubarray([...Array(q.n).keys()], { minLength: q.n, maxLength: q.n }), (perm) => {
        return contentId({ ...q, regions: q.regions.map((g) => perm[g]!) }) === id;
      }),
      { numRuns: 50 },
    );
  });

  it("changes when anything the player sees changes", () => {
    const c = sudoku("classic-medium");
    const cell = Number(Object.keys(c.givens!)[0]);
    const givens = { ...c.givens };
    delete givens[cell];
    expect(contentId({ ...c, givens })).not.toBe(contentId(c));

    const k = sudoku("killer-medium");
    const cages = k.cages.map((cage, i) => (i === 0 ? { ...cage, sum: cage.sum + 1 } : cage));
    expect(contentId({ ...k, cages })).not.toBe(contentId(k));
    expect(contentId({ ...k, givens: { 0: Number(k.solution![0]) } })).not.toBe(contentId(k));

    const q = queens("queens-easy");
    const regions = [...q.regions];
    const other = regions.findIndex((g) => g !== regions[0]);
    regions[0] = regions[other]!;
    expect(contentId({ ...q, regions })).not.toBe(contentId(q));
  });

  it("separates modes", () => {
    const blank: Puzzle = { id: "x", kind: "classic", cages: [], givens: {} };
    expect(contentId(blank).slice(1)).not.toBe(contentId({ ...blank, kind: "killer" }).slice(1));
  });
});
