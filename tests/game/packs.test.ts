import { readFileSync } from "node:fs";
import { contentId } from "../../src/engine/content-id";
import { decodeSudoku, type SudokuPackEntry } from "../../src/engine/pack";
import { decodeQueens, type QueensPackEntry } from "../../src/engine/queens/pack";
import { pickNext, withContentId } from "../../src/game/packs";

const pack = ["a", "b", "c", "d"].map((id) => ({ id }));
/** Every pick over ten evenly spread draws, as the set of ids that came up. */
const picks = (solved: string[], avoid?: string) =>
  [...new Set(Array.from({ length: 10 }, (_, i) => pickNext(pack, solved, avoid, () => i / 10)!.id))].sort();

describe("pickNext", () => {
  it("picks at random from the puzzles not yet solved", () => {
    expect(pickNext(pack, ["a", "c"], undefined, () => 0)!.id).toBe("b");
    expect(pickNext(pack, ["a", "c"], undefined, () => 0.99)!.id).toBe("d");
    expect(picks(["a"])).toEqual(["b", "c", "d"]);
  });

  it("never offers the puzzle just left: New puzzle moves on, and that puzzle stays in the draw", () => {
    expect(picks([], "b")).toEqual(["a", "c", "d"]);
    // After another solve it is one unsolved puzzle among the rest, not first in line.
    expect(picks(["a"], "a")).toEqual(["b", "c", "d"]);
  });

  it("once every puzzle is solved, replays any but the one just played", () => {
    expect(picks(["a", "b", "c", "d"], "a")).toEqual(["b", "c", "d"]);
    expect(pickNext([{ id: "only" }], ["only"], "only")!.id).toBe("only");
    expect(pickNext([], [])).toBeNull();
  });
});

describe("withContentId", () => {
  const first = (file: string): unknown => (JSON.parse(readFileSync(`public/packs/${file}.json`, "utf8")) as { puzzles: unknown[] }).puzzles[0];

  it("names a board saved before the v2 packs by its content", () => {
    const board = decodeSudoku(first("classic-easy") as SudokuPackEntry);
    expect(board.id).toBe("classic-easy-1");
    expect(withContentId(board).id).toBe(contentId(board));
    expect(withContentId(board).id).toMatch(/^c[0-9a-z]{11}$/);
  });

  it("leaves a v2 board's id as it is", () => {
    const entry = first("v2/queens-easy") as QueensPackEntry;
    expect(withContentId(decodeQueens(entry)).id).toBe(entry.id);
  });
});
