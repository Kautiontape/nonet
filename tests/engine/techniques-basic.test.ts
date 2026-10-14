import { readFileSync } from "node:fs";
import { nextStep, solveLogically } from "../../src/engine/logical";
import { decodeSudoku, type SudokuPackEntry } from "../../src/engine/pack";
import { regionEquation } from "../../src/engine/region";
import { applyStep, createState } from "../../src/engine/state";
import type { Step } from "../../src/engine/types";
import { claiming, pointing } from "../../src/engine/techniques/intersections";
import { inniesSingle } from "../../src/engine/techniques/innies";
import { cageCandidateCombos, cageClaim, cageLastCell, cageLocked, cageSumCombos } from "../../src/engine/techniques/killer";
import { fullHouse, hiddenSingle, nakedSingle } from "../../src/engine/techniques/singles";
import { hiddenPair, nakedPair, nakedTriple } from "../../src/engine/techniques/subsets";
import { cage, cell, classic, elims, explainOf, places, stateWith, withDigits } from "./helpers";

describe("singles", () => {
  it("full house: the last empty cell of a row", () => {
    const p = withDigits({ r1c1: 1, r1c2: 2, r1c3: 3, r1c4: 4, r1c5: 5, r1c6: 6, r1c7: 7, r1c8: 8 });
    const step = fullHouse.find(stateWith(p));
    expect(places(step)).toEqual(["r1c9=9"]);
    expect(step!.explain).toMatchObject({ kind: "full-house", house: { kind: "row", index: 0 } });
  });

  it("hidden single by cross-hatching, with the sight lines that block the other cells", () => {
    // 5s in rows 2,3 and columns 2,3 (outside box 1) leave r1c1 as box 1's only home for 5.
    const p = withDigits({ r2c4: 5, r3c7: 5, r7c2: 5, r8c3: 5 });
    const step = hiddenSingle.find(stateWith(p));
    expect(places(step)).toEqual(["r1c1=5"]);
    expect(step!.rating).toBe(1.2);
    expect(step!.sources).toEqual([cell("r2c4"), cell("r3c7"), cell("r7c2"), cell("r8c3")]);
    const { blocked } = explainOf<{ blocked: { cell: number; by: number | null }[] }>(step);
    expect(blocked.find((b) => b.cell === cell("r1c2"))!.by).toBe(cell("r7c2"));
    expect(blocked.find((b) => b.cell === cell("r2c2"))!.by).toBe(cell("r2c4"));
  });

  it("naked single records which peer rules out each other digit", () => {
    const p = withDigits({ r1c2: 1, r1c3: 2, r1c4: 3, r2c1: 4, r3c1: 5, r5c1: 6, r6c1: 7, r2c2: 8 });
    const step = nakedSingle.find(stateWith(p));
    expect(places(step)).toEqual(["r1c1=9"]);
    const { seen } = explainOf<{ seen: { digit: number; by: number | null }[] }>(step);
    expect(seen.find((x) => x.digit === 8)!.by).toBe(cell("r2c2"));
  });
});

describe("intersections", () => {
  it("pointing: box 1's 7s all in row 1 clear the rest of row 1", () => {
    const p = withDigits({});
    const s = stateWith(p);
    // Remove 7 from rows 2–3 of box 1.
    for (const n of ["r2c1", "r2c2", "r2c3", "r3c1", "r3c2", "r3c3"]) s.cand[cell(n)]! &= ~(1 << 7);
    const step = pointing.find(s);
    expect(elims(step)).toEqual(["r1c4-7", "r1c5-7", "r1c6-7", "r1c7-7", "r1c8-7", "r1c9-7"]);
    expect(step!.explain).toMatchObject({ kind: "pointing", digit: 7 });
  });

  it("claiming: row 1's 3s all in box 1 clear the rest of box 1", () => {
    const s = stateWith(withDigits({}));
    for (const n of ["r1c4", "r1c5", "r1c6", "r1c7", "r1c8", "r1c9"]) s.cand[cell(n)]! &= ~(1 << 3);
    const step = claiming.find(s);
    expect(elims(step)).toEqual(["r2c1-3", "r2c2-3", "r2c3-3", "r3c1-3", "r3c2-3", "r3c3-3"]);
  });
});

describe("subsets", () => {
  it("naked pair in a row (also locked in the box)", () => {
    const s = stateWith(withDigits({}), { r1c1: "12", r1c2: "12" });
    const step = nakedPair.find(s);
    // Row 1 and box 1 both lose 1 and 2 outside the pair.
    expect(elims(step)).toContain("r1c9-1");
    expect(elims(step)).toContain("r3c3-2");
    expect(elims(step)).not.toContain("r1c1-1");
    expect(step!.explain).toMatchObject({ kind: "naked-subset", size: 2, digits: [1, 2] });
  });

  it("naked triple need not have every digit in every cell", () => {
    const s = stateWith(withDigits({}), { r5c1: "12", r5c5: "23", r5c9: "13" });
    const step = nakedTriple.find(s);
    expect(elims(step)).toContain("r5c2-1");
    expect(elims(step)).toContain("r5c8-3");
    expect(elims(step).some((e) => e.startsWith("r5c5"))).toBe(false);
  });

  it("hidden pair: two digits confined to two cells of a column", () => {
    const s = stateWith(withDigits({}));
    for (let r = 2; r <= 9; r++) s.cand[cell(`r${r}c1`)]! &= ~((1 << 8) | (1 << 9));
    s.cand[cell("r2c1")] = (1 << 8) | (1 << 9) | (1 << 1) | (1 << 2);
    s.cand[cell("r1c1")] = (1 << 8) | (1 << 9) | (1 << 5);
    const step = hiddenPair.find(s);
    expect(elims(step)).toEqual(["r1c1-5", "r2c1-1", "r2c1-2"]);
  });
});

describe("killer techniques", () => {
  it("cage last cell", () => {
    const p = withDigits({ r1c1: 4 }, [cage(0, 10, ["r1c1", "r1c2"])]);
    expect(places(cageLastCell.find(stateWith(p)))).toEqual(["r1c2=6"]);
  });

  it("single-combination cage by sum: 2-cell 17 = 8+9", () => {
    const p = withDigits({}, [cage(0, 17, ["r1c1", "r1c2"]), cage(1, 10, ["r5c5", "r5c6"])]);
    const step = cageSumCombos.find(stateWith(p));
    expect(step!.explain).toMatchObject({ kind: "cage-combos", basis: "sum", cage: 0, combos: [(1 << 8) | (1 << 9)] });
    expect(elims(step)).toHaveLength(14); // 1–7 from both cells
  });

  it("combination check against candidates", () => {
    // 10 cage: 1+9, 2+8, 3+7, 4+6. r1c1 ∈ {1,3,9}, r1c2 ∈ {7,9} → only 1+9 or 3+7.
    const p = withDigits({}, [cage(0, 10, ["r1c1", "r1c2"])]);
    const s = stateWith(p, { r1c1: "139", r1c2: "79" });
    const step = cageCandidateCombos.find(s);
    expect(elims(step)).toEqual(["r1c1-9"]);
    expect(explainOf<{ valid: number[] }>(step).valid).toHaveLength(2);
  });

  it("cage-locked: a required digit stuck in one row of the cage", () => {
    // 3-cell 7 = 1+2+4: must contain 1. Only r1c1 and r1c2 can hold 1 → row 1 loses 1 elsewhere.
    const p = withDigits({}, [cage(0, 7, ["r1c1", "r1c2", "r2c1"])]);
    const s = stateWith(p, { r1c1: "124", r1c2: "124", r2c1: "24" });
    const step = cageLocked.find(s);
    expect(step!.explain).toMatchObject({ kind: "cage-locked", digit: 1 });
    expect(elims(step)).toContain("r1c9-1");
    expect(elims(step)).not.toContain("r1c1-1");
  });

  it("cage-claim: row 9's only 9s sit in one cage, so that cage must use a 9", () => {
    // 3-cell 15 cage across r9c1,r9c2,r8c1. Row 9's 9s only in r9c1/r9c2.
    const p = withDigits({}, [cage(0, 15, ["r9c1", "r9c2", "r8c1"])]);
    const s = stateWith(p);
    for (let c = 3; c <= 9; c++) s.cand[cell(`r9c${c}`)]! &= ~(1 << 9);
    const step = cageClaim.find(s);
    expect(step!.explain).toMatchObject({ kind: "cage-claim", digit: 9, cage: 0 });
    // r8c1 can't be 9; combos with 9 are 1+5+9, 2+4+9 → no 3,6,7,8 anywhere in the cage.
    expect(elims(step)).toContain("r8c1-9");
    expect(elims(step)).toContain("r8c1-7");
  });

  it("combination checks follow the cage's candidates (they're reused between steps)", () => {
    const p = withDigits({}, [cage(0, 10, ["r1c1", "r1c2"])]);
    expect(elims(cageCandidateCombos.find(stateWith(p, { r1c1: "139", r1c2: "79" })))).toEqual(["r1c1-9"]);
    expect(elims(cageCandidateCombos.find(stateWith(p, { r1c1: "1389", r1c2: "79" })))).toEqual(["r1c1-8", "r1c1-9"]);
    expect(cageCandidateCombos.find(stateWith(p, { r1c1: "13", r1c2: "79" }))).toBeNull();
  });

  it("reusing combination checks doesn't change a solve, and steps don't share them", () => {
    const pack = JSON.parse(readFileSync("public/packs/killer-hard.json", "utf8")) as { puzzles: SudokuPackEntry[] };
    const p = decodeSudoku(pack.puzzles[0]!);
    const clean = JSON.stringify(solveLogically(decodeSudoku(pack.puzzles[0]!)).steps);
    // Same puzzle object, step by step, scribbling over each step's explain data before the next
    // step is found (a cage's check is reused while its cells don't change).
    const s = createState(p);
    const seen: Step[] = [];
    for (let step = nextStep(s); step; step = nextStep(s)) {
      seen.push(JSON.parse(JSON.stringify(step)) as Step);
      applyStep(s, step);
      for (const v of Object.values(step.explain)) if (Array.isArray(v)) v.length = 0;
    }
    expect(JSON.stringify(seen)).toBe(clean);
  });

  it("innies: a row whose cages leave one cell poking out", () => {
    // Row 1: cages inside sum to 45-6 = 39 except r1c9, whose cage reaches into row 2.
    const p = withDigits({}, [
      cage(0, 3, ["r1c1", "r1c2"]),
      cage(1, 7, ["r1c3", "r1c4"]),
      cage(2, 11, ["r1c5", "r1c6"]),
      cage(3, 18, ["r1c7", "r1c8"]),
      cage(4, 10, ["r1c9", "r2c9"]),
    ]);
    const step = inniesSingle.find(stateWith(p));
    expect(places(step)).toEqual(["r1c9=6"]);
    expect(step!.explain).toMatchObject({ kind: "innies-outies", side: "innies", target: 6, insideSum: 39 });
  });

  it("outies: with the innie placed, the cell poking out of the row follows", () => {
    const cages = [
      cage(0, 3, ["r1c1", "r1c2"]),
      cage(1, 7, ["r1c3", "r1c4"]),
      cage(2, 11, ["r1c5", "r1c6"]),
      cage(3, 18, ["r1c7", "r1c8"]),
      cage(4, 10, ["r1c9", "r2c9"]),
    ];
    const step = inniesSingle.find(stateWith(withDigits({ r1c9: 6 }, cages)));
    expect(places(step)).toEqual(["r2c9=4"]);
    expect(step!.explain).toMatchObject({ side: "outies", sum: 4, target: 4 });
  });
});

describe("classic sanity", () => {
  it("wikipedia puzzle: first hidden single exists", () => {
    const p = classic("530070000600195000098000060800060003400803001700020006060000280000419005000080079");
    expect(hiddenSingle.find(stateWith(p))).not.toBeNull();
  });
});

describe("regionEquation (45 lens)", () => {
  const cages = [
    cage(0, 3, ["r1c1", "r1c2"]),
    cage(1, 7, ["r1c3", "r1c4"]),
    cage(2, 11, ["r1c5", "r1c6"]),
    cage(3, 18, ["r1c7", "r1c8"]),
    cage(4, 10, ["r1c9", "r2c9"]),
  ];
  it("picks the innie when it's the simpler side", () => {
    const eq = regionEquation(cages, new Uint8Array(81), [{ kind: "row", index: 0 }])!;
    expect(eq.side).toBe("innies");
    expect(eq.empty).toEqual([cell("r1c9")]);
    expect(eq.target).toBe(6);
  });
  it("switches to the outie once the innie is placed", () => {
    const grid = new Uint8Array(81);
    grid[cell("r1c9")] = 6;
    const eq = regionEquation(cages, grid, [{ kind: "row", index: 0 }])!;
    expect(eq.side).toBe("outies");
    expect(eq.empty).toEqual([cell("r2c9")]);
    expect(eq.target).toBe(4);
  });
});
