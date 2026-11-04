import { CROSS, EMPTY, QUEEN, type QueensPuzzle } from "../../src/engine/queens/types";
import { QueensGame, type QueensEvent } from "../../src/game/queens-game";

// queens-easy-1: 6×6, solution r1c2 r2c5 r3c1 r4c4 r5c6 r6c3.
const P: QueensPuzzle = {
  id: "t",
  n: 6,
  regions: [..."555000555000155000133300333002334022"].map(Number),
  solution: [1, 4, 0, 3, 5, 2],
};
const SOLUTION = P.solution.map((col, row) => row * 6 + col); // [1, 10, 12, 21, 29, 32]
const WRONG = 0; // r1c1: not a solution cell

function track(g: QueensGame): QueensEvent[] {
  const events: QueensEvent[] = [];
  g.on((e) => events.push(e));
  return events;
}

describe("QueensGame gestures", () => {
  it("a tap puts an ✕ on and takes it off again", () => {
    const g = new QueensGame(P);
    g.tap(3);
    expect(g.marks[3]).toBe(CROSS);
    g.tap(3);
    expect(g.marks[3]).toBe(EMPTY);
  });

  it("a tap never knocks off a queen; clear (hold) does", () => {
    const g = new QueensGame(P);
    g.setMark(SOLUTION[0]!, QUEEN);
    g.tap(SOLUTION[0]!);
    expect(g.marks[SOLUTION[0]!]).toBe(QUEEN);
    g.clear(SOLUTION[0]!);
    expect(g.marks[SOLUTION[0]!]).toBe(EMPTY);
  });

  it("a double tap makes a queen as one undo step, from an empty cell or from an ✕", () => {
    const g = new QueensGame(P);
    g.tap(1); // first tap: ✕
    g.doubleTap(1); // second tap: queen
    expect(g.marks[1]).toBe(QUEEN);
    g.undo();
    expect(g.marks[1]).toBe(EMPTY);
    expect(g.canUndo()).toBe(false);

    g.tap(10); // a ✕ placed earlier…
    g.tap(10); // …a later tap takes it off, and a quick second tap makes a queen
    g.doubleTap(10);
    expect(g.marks[10]).toBe(QUEEN);
    g.undo();
    expect(g.marks[10]).toBe(CROSS);
  });

  it("a double tap only merges with the tap just before it, on the same cell", () => {
    const g = new QueensGame(P);
    g.tap(3);
    g.doubleTap(1); // not the cell that was tapped: just a queen
    expect(g.marks[3]).toBe(CROSS);
    expect(g.marks[1]).toBe(QUEEN);
    g.undo();
    expect(g.marks[3]).toBe(CROSS);
  });

  it("dragging paints ✕s over empty cells as one undo step, never over queens", () => {
    const g = new QueensGame(P);
    g.setMark(2, QUEEN);
    g.paint([3, 4], CROSS, false);
    g.paint([3, 4, 5], CROSS, true);
    g.paint([3, 4, 5, 2], CROSS, true);
    expect([...g.marks.slice(2, 6)]).toEqual([QUEEN, CROSS, CROSS, CROSS]);
    g.undo();
    expect([...g.marks.slice(2, 6)]).toEqual([QUEEN, EMPTY, EMPTY, EMPTY]);
  });

  it("a drag that starts on an ✕ erases ✕s instead", () => {
    const g = new QueensGame(P);
    g.paint([6, 7, 8], CROSS, false);
    g.paint([7, 8], EMPTY, false);
    expect([...g.marks.slice(6, 9)]).toEqual([CROSS, EMPTY, EMPTY]);
    g.undo();
    expect([...g.marks.slice(6, 9)]).toEqual([CROSS, CROSS, CROSS]);
  });

  it("separate drags are separate undo steps, even when one starts with nothing to change", () => {
    const g = new QueensGame(P);
    g.paint([6, 7], CROSS, false);
    g.paint([6, 7], CROSS, false); // a new drag over cells already crossed…
    g.paint([6, 7, 8], CROSS, true); // …that then reaches a fresh one
    g.undo();
    expect([...g.marks.slice(6, 9)]).toEqual([CROSS, CROSS, EMPTY]);
  });
});

describe("QueensGame scratch", () => {
  it("wipe puts the board, the undo history and redo back exactly as they were", () => {
    const g = new QueensGame(P);
    g.tap(3);
    g.tap(4);
    g.undo(); // something to redo
    const before = g.marks.slice();
    g.beginScratch();
    expect(g.scratching).toBe(true);
    g.setMark(WRONG, QUEEN);
    g.tap(3); // take a real ✕ off, hypothetically
    g.paint([30, 31], CROSS, false);
    g.wipeScratch();
    expect(g.scratching).toBe(false);
    expect(g.marks).toEqual(before);
    g.redo();
    expect(g.marks[4]).toBe(CROSS);
    g.undo();
    g.undo();
    expect(g.marks[3]).toBe(EMPTY);
  });

  it("scratch queens never count as mistakes, never celebrate, never solve, and don't move progress", () => {
    const g = new QueensGame(P);
    const events = track(g);
    g.beginScratch();
    g.setMark(WRONG, QUEEN);
    g.setMark(WRONG + 1, QUEEN); // clashes with the first
    for (const c of SOLUTION) g.setMark(c, QUEEN);
    expect(g.mistakes).toBe(0);
    expect(g.solved).toBe(false);
    expect(g.progress()).toBe(0);
    expect(events.some((e) => e.type === "queen" || e.type === "complete" || e.type === "solved")).toBe(false);
    const clash = events.find((e) => e.type === "scratch-queen" && e.cell === WRONG + 1);
    expect(clash).toMatchObject({ conflicts: [WRONG] });
  });

  it("undo stops where the scratch began", () => {
    const g = new QueensGame(P);
    g.tap(3);
    g.beginScratch();
    expect(g.canUndo()).toBe(false);
    g.tap(4);
    expect(g.canUndo()).toBe(true);
    g.undo();
    g.undo();
    expect(g.marks[3]).toBe(CROSS);
  });

  it("keep makes the scratch real as one undo step, with the usual checks", () => {
    const g = new QueensGame(P);
    const events = track(g);
    g.tap(3);
    g.beginScratch();
    g.setMark(WRONG, QUEEN);
    g.tap(4);
    g.tap(5);
    g.keepScratch();
    expect(g.scratching).toBe(false);
    expect(g.mistakes).toBe(1); // the kept queen is wrong: checked like any placement
    expect(events.filter((e) => e.type === "queen")).toHaveLength(1);
    g.undo(); // the whole scratch comes off in one step…
    expect([...g.marks.slice(0, 6)]).toEqual([EMPTY, EMPTY, EMPTY, CROSS, EMPTY, EMPTY]);
    g.undo(); // …then the move from before it
    expect(g.marks[3]).toBe(EMPTY);
  });

  it("a solved puzzle stays solved: undo and redo do nothing", () => {
    const g = new QueensGame(P);
    for (const c of SOLUTION) g.setMark(c, QUEEN);
    expect(g.solved).toBe(true);
    const events = track(g);
    g.undo();
    g.redo();
    expect(g.solved).toBe(true);
    expect(events).toEqual([]);
  });

  it("keeping a scratch that finishes the puzzle solves it", () => {
    const g = new QueensGame(P);
    for (const c of SOLUTION.slice(0, 5)) g.setMark(c, QUEEN);
    g.beginScratch();
    g.setMark(SOLUTION[5]!, QUEEN);
    expect(g.solved).toBe(false);
    g.keepScratch();
    expect(g.solved).toBe(true);
  });

  it("saves and hints read the real board while scratching", () => {
    const g = new QueensGame(P);
    g.tap(3);
    g.beginScratch();
    g.setMark(WRONG, QUEEN);
    g.tap(3);
    const saved = g.toJSON();
    expect(saved.marks[3]).toBe(CROSS);
    expect(saved.marks[WRONG]).toBe(EMPTY);
    // A wrong queen on the real board would make the hint a "mistake" hint; the scratch one doesn't.
    expect(g.hint().kind).not.toBe("mistake");
    expect(new QueensGame(P, saved).marks).toEqual(Uint8Array.from(saved.marks));
  });
});

describe("QueensGame mistake limit", () => {
  const WRONGS = [0, 2, 3, 4]; // row 1, none of them r1c2

  const limited = (limit: number | null) => {
    const g = new QueensGame(P);
    g.settings.mistakeLimit = limit;
    return { g, events: track(g) };
  };

  it("no limit: mistakes never end the game", () => {
    const { g, events } = limited(null);
    for (const c of WRONGS) g.setMark(c, QUEEN);
    expect(g.mistakes).toBe(4);
    expect(g.lost).toBe(false);
    expect(events.some((e) => e.type === "lost")).toBe(false);
  });

  it("a limit of 2 forgives two mistakes and loses on the third", () => {
    const { g, events } = limited(2);
    g.setMark(WRONGS[0]!, QUEEN);
    g.setMark(WRONGS[1]!, QUEEN);
    expect(g.lost).toBe(false);
    g.setMark(WRONGS[2]!, QUEEN);
    expect(g.mistakes).toBe(3);
    expect(g.lost).toBe(true);
    expect(events.filter((e) => e.type === "lost")).toHaveLength(1);
  });

  it("hardcore loses on the first wrong queen, after the queen's own feedback", () => {
    const { g, events } = limited(0);
    g.setMark(SOLUTION[0]!, QUEEN); // right: nothing happens
    expect(g.lost).toBe(false);
    g.setMark(WRONGS[3]!, QUEEN);
    expect(g.lost).toBe(true);
    expect(events.slice(-2).map((e) => e.type)).toEqual(["queen", "lost"]);
  });

  it("a mistake nobody flags counts for nothing", () => {
    const { g } = limited(0);
    g.settings.checkMistakes = false;
    g.setMark(WRONG, QUEEN);
    expect(g.mistakes).toBe(0);
    expect(g.lost).toBe(false);
  });

  it("scratch queens never count; Keep checks them, and the first over the limit ends it", () => {
    const { g, events } = limited(0);
    g.beginScratch();
    g.setMark(WRONGS[0]!, QUEEN);
    g.setMark(WRONGS[1]!, QUEEN);
    expect(g.mistakes).toBe(0);
    expect(g.lost).toBe(false);
    g.keepScratch();
    expect(g.mistakes).toBe(1); // the second kept queen isn't judged: the game is over
    expect(g.lost).toBe(true);
    expect(events.filter((e) => e.type === "lost")).toHaveLength(1);
  });

  it("a lost board is locked: nothing changes it, and there's no undoing out", () => {
    const { g } = limited(0);
    g.tap(5);
    g.setMark(WRONG, QUEEN);
    const before = JSON.stringify(g.toJSON());
    const events = track(g);

    g.tap(7);
    g.doubleTap(8);
    g.clear(WRONG);
    g.paint([13, 14], CROSS, false);
    g.clearAll();
    g.undo();
    g.redo();
    g.beginScratch();
    g.applyHint(g.hint());

    expect(g.scratching).toBe(false);
    expect(JSON.stringify(g.toJSON())).toBe(before);
    expect(events).toEqual([]);
  });
});
