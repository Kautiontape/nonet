import { subTargetsOf } from "../../src/engine/bands";
import { contentId, queensSymmetryKey } from "../../src/engine/content-id";
import { exactSolve } from "../../src/engine/exact";
import { makeBoard } from "../../src/engine/gen";
import { makeClassic } from "../../src/engine/gen/classic";
import { makeKiller } from "../../src/engine/gen/killer";
import { makeQueens } from "../../src/engine/gen/queens";
import { decodeV2, encodeV2, SUB_TARGET_OF_CODE, type SudokuEntryV2 } from "../../src/engine/pack-v2";
import { decodeSudoku } from "../../src/engine/pack";
import { profileQueens, profileSudoku } from "../../src/engine/profile";
import { countSolutions } from "../../src/engine/queens/exact";
import type { QueensPuzzle } from "../../src/engine/queens/types";
import type { Puzzle } from "../../src/engine/types";

// Killer Expert takes seconds to minutes a board, so it stays out of unit tests (scripts/gen-bench.ts
// covers it). Aims are picked so every case here runs in well under a second.

describe("Classic generator", () => {
  for (const [band, aim, seed] of [
    ["easy", "breather", 3],
    ["easy", "stretch", 3],
    ["medium", "breather", 4],
    ["medium", "standard", 3],
    ["hard", "standard", 3],
    ["expert", "standard", 3],
  ] as const)
    it(`${band} ${aim}: unique, fits the band, same board for the same seed`, () => {
      const a = makeClassic(band, aim, seed)!;
      expect(a).not.toBeNull();
      expect(exactSolve(a.board, { limit: 2 }).count).toBe(1);
      expect(subTargetsOf("classic", band, profileSudoku(a.board))).toEqual(a.fits);
      expect(a.fits.length).toBeGreaterThan(0);
      expect(contentId(makeClassic(band, aim, seed)!.board)).toBe(contentId(a.board));
    });

  it("an Easy board never needs a naked single and always offers two squares", () => {
    const a = makeClassic("easy", "standard", 11)!;
    expect(a.profile.counts["naked-single"]).toBeUndefined();
    expect(a.profile.scan.min).toBeGreaterThanOrEqual(2);
  });
});

describe("Killer generator", () => {
  // Seeds picked for speed; each board is made once and shared.
  const made = new Map<string, ReturnType<typeof makeKiller>>();
  const killer = (band: "easy" | "medium" | "hard", aim: "breather" | "standard", seed: number) => {
    const key = `${band}/${aim}/${seed}`;
    if (!made.has(key)) made.set(key, makeKiller(band, aim, seed));
    return made.get(key)!;
  };
  for (const [band, aim, seed] of [
    ["easy", "breather", 2],
    ["easy", "standard", 2],
    ["medium", "standard", 1],
    ["hard", "breather", 8],
  ] as const)
    it(`${band} ${aim}: solved by the hint engine and fits the band`, () => {
      const a = killer(band, aim, seed)!;
      expect(a).not.toBeNull();
      const p = profileSudoku(a.board, { scan: false });
      expect(p.solved).toBe(true); // a full logical solve proves one solution
      expect(subTargetsOf("killer", band, p)).toEqual(a.fits);
    });

  it("makes the same board for the same seed", () => {
    for (const [band, aim, seed] of [
      ["easy", "breather", 2],
      ["medium", "standard", 1],
    ] as const)
      expect(contentId(makeKiller(band, aim, seed)!.board)).toBe(contentId(killer(band, aim, seed)!.board));
  });

  it("Medium opens with a 45 and Hard boards have no one-cell cages", () => {
    const m = killer("medium", "standard", 1)!;
    expect(81 - m.profile.givens - m.profile.firstWall!).toBeLessThanOrEqual(10);
    expect(killer("hard", "breather", 8)!.board.cages.every((c) => c.cells.length > 1)).toBe(true);
  });
});

describe("Queens generator", () => {
  for (const band of ["easy", "medium", "hard", "expert"] as const)
    it(`${band}: one solution, fits the band, same board for the same seed`, () => {
      const a = makeQueens(band, "standard", 5)!;
      expect(a).not.toBeNull();
      expect(countSolutions(a.board)).toBe(1);
      expect(subTargetsOf("queens", band, profileQueens(a.board))).toEqual(a.fits);
      expect(contentId(makeQueens(band, "standard", 5)!.board)).toBe(contentId(a.board));
    });

  it("twins under rotation and reflection share a symmetry key", () => {
    const q = makeQueens("easy", "breather", 1)!.board;
    const n = q.n;
    const rotated = Array.from({ length: n * n }, (_, i) => q.regions[(n - 1 - (i % n)) * n + Math.floor(i / n)]!);
    const mirrored = Array.from({ length: n * n }, (_, i) => q.regions[Math.floor(i / n) * n + (n - 1 - (i % n))]!);
    expect(queensSymmetryKey({ n, regions: rotated })).toBe(queensSymmetryKey(q));
    expect(queensSymmetryKey({ n, regions: mirrored })).toBe(queensSymmetryKey(q));
    expect(queensSymmetryKey(makeQueens("easy", "breather", 2)!.board)).not.toBe(queensSymmetryKey(q));
  });
});

describe("makeBoard and v2 pack entries", () => {
  it("names the board by its content id", () => {
    const m = makeBoard("classic", "easy", 4)!;
    expect(m.board.id).toBe(contentId(m.board));
  });

  it("encodes a board whose id is the content id of the entry as read back", () => {
    for (const mode of ["classic", "killer", "queens"] as const) {
      const m = makeBoard(mode, "easy", 4)!;
      const e = encodeV2(mode, "easy", m, m.fits[0]!, 2);
      const back = decodeV2(mode, e);
      expect(e.id).toBe(contentId(back));
      expect(e).toMatchObject({ seed: 4, gv: 2, d: "easy" });
      expect(SUB_TARGET_OF_CODE[e.st]).toBe(m.fits[0]);
      if (mode === "queens") expect((back as QueensPuzzle).regions).toEqual((m.board as QueensPuzzle).regions);
      else expect((back as Puzzle).solution).toBe((m.board as Puzzle).solution);
    }
  });

  it("v1 readers accept v2 entries", () => {
    const m = makeBoard("killer", "easy", 4)!;
    const e = encodeV2("killer", "easy", m, m.fits[0]!, 2);
    const p = decodeSudoku(e as SudokuEntryV2);
    expect(p.cages.length).toBe((m.board as Puzzle).cages.length);
    expect(p.meta?.difficulty).toBe("easy");
  });

  it("summarizes the profile per mode", () => {
    const c = encodeV2("classic", "easy", makeBoard("classic", "easy", 4)!, "standard", 2);
    expect(Object.keys(c.p).sort()).toEqual(["a", "b", "e", "fw", "h", "t3", "w"]);
    const k = encodeV2("killer", "easy", makeBoard("killer", "easy", 4)!, "standard", 2);
    expect(Object.keys(k.p).sort()).toEqual(["a", "b", "f", "fw", "h", "i", "im", "w"]);
    const q = encodeV2("queens", "easy", makeBoard("queens", "easy", 4)!, "standard", 2);
    expect(Object.keys(q.p).sort()).toEqual(["a", "b", "c", "fw", "h", "w"]);
  });
});
