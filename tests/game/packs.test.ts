import { readFileSync } from "node:fs";
import { contentId } from "../../src/engine/content-id";
import { decodeSudoku, encodeSudoku, type SudokuPackEntry } from "../../src/engine/pack";
import { decodeQueens, encodeQueens, type QueensPackEntry } from "../../src/engine/queens/pack";
import { CROSS } from "../../src/engine/queens/types";
import type { Digit } from "../../src/engine/types";
import { pickNext, resumeSaved, withContentId } from "../../src/game/packs";
import { QueensGame, type SavedQueens } from "../../src/game/queens-game";
import { SudokuGame, type SavedSudoku } from "../../src/game/sudoku-game";

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

const first = (file: string): unknown => (JSON.parse(readFileSync(`public/packs/${file}.json`, "utf8")) as { puzzles: unknown[] }).puzzles[0];

describe("withContentId", () => {
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

describe("resumeSaved", () => {
  /** Round-trip a save the way the play screens store it (JSON in localStorage). */
  const stored = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  it("a game saved on a v1 board, before the v2 packs, resumes with everything played on it", () => {
    const board = decodeSudoku(first("killer-easy") as SudokuPackEntry);
    const g = new SudokuGame(board);
    const [a, b] = [...g.grid.keys()].filter((c) => !g.grid[c]);
    g.place(a!, g.solution[a!] as Digit);
    g.toggleNote(b!, 5);
    g.elapsedMs = 600_000;
    const saved = stored(g.toJSON());
    expect(saved.puzzleId).toBe("killer-easy-1");
    const { puzzle, state } = resumeSaved(decodeSudoku(stored(encodeSudoku(board))), saved);
    expect(puzzle.id).toBe(contentId(board));
    const resumed = new SudokuGame(puzzle, state);
    expect(resumed.grid[a!]).toBe(g.solution[a!]);
    expect(resumed.notes[b!]).toBe(g.notes[b!]);
    expect(resumed.elapsedMs).toBe(600_000);
  });

  it("the same for Queens", () => {
    const board = decodeQueens(first("queens-easy") as QueensPackEntry);
    const g = new QueensGame(board);
    g.setMark(0, CROSS);
    g.elapsedMs = 300_000;
    const saved = stored(g.toJSON());
    expect(saved.puzzleId).toBe("queens-easy-1");
    const { puzzle, state } = resumeSaved(decodeQueens(stored(encodeQueens(board))), saved);
    const resumed = new QueensGame(puzzle, state);
    expect(resumed.marks[0]).toBe(CROSS);
    expect(resumed.elapsedMs).toBe(300_000);
  });

  it("a game saved on a v2 board resumes as it was", () => {
    const board = decodeSudoku(first("v2/classic-easy") as SudokuPackEntry);
    const g = new SudokuGame(board);
    g.elapsedMs = 42_000;
    const saved = stored(g.toJSON());
    const { puzzle, state } = resumeSaved(decodeSudoku(stored(encodeSudoku(board))), saved);
    expect(puzzle.id).toBe(board.id);
    expect(state).toEqual(saved);
    expect(new SudokuGame(puzzle, state).elapsedMs).toBe(42_000);
  });

  it("leaves a state saved for some other board alone, and copes with none", () => {
    const board = decodeSudoku(first("classic-easy") as SudokuPackEntry);
    const other = stored(new SudokuGame(decodeSudoku(first("classic-medium") as SudokuPackEntry)).toJSON());
    expect(resumeSaved(board, other).state).toEqual(other);
    expect(resumeSaved(board, null as SavedSudoku | SavedQueens | null).state).toBeNull();
  });
});
