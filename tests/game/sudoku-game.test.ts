import { readFileSync } from "node:fs";
import { comboCandidates } from "../../src/engine/candidates";
import { bit, cageCombos, maskOf } from "../../src/engine/combos";
import { cellName } from "../../src/engine/geometry";
import { hintMarks, type SudokuHint } from "../../src/engine/hints/index";
import { decodeSudoku, type SudokuPackEntry } from "../../src/engine/pack";
import type { Digit, Puzzle, Step } from "../../src/engine/types";
import { SudokuGame, type GameEvent, type SavedSudoku } from "../../src/game/sudoku-game";
import { cage, cell, classic } from "../engine/helpers";

const WIKI = classic(
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179",
);

const packPuzzle = (file: string, i: number): Puzzle =>
  decodeSudoku((JSON.parse(readFileSync(`public/packs/${file}.json`, "utf8")) as { puzzles: SudokuPackEntry[] }).puzzles[i]!);

function track(g: SudokuGame): GameEvent[] {
  const events: GameEvent[] = [];
  g.on((e) => events.push(e));
  return events;
}

describe("SudokuGame", () => {
  it("places digits and auto-clears peers' notes; undo/redo restore both", () => {
    const g = new SudokuGame(WIKI);
    g.toggleNote(cell("r1c4"), 4);
    g.toggleNote(cell("r9c3"), 4);
    expect(g.notes[cell("r1c4")]).toBe(maskOf([4]));
    g.place(cell("r1c3"), 4); // correct
    expect(g.grid[cell("r1c3")]).toBe(4);
    expect(g.notes[cell("r1c4")]).toBe(0); // same row
    expect(g.notes[cell("r9c3")]).toBe(0); // same column
    g.undo();
    expect(g.grid[cell("r1c3")]).toBe(0);
    expect(g.notes[cell("r1c4")]).toBe(maskOf([4]));
    g.redo();
    expect(g.grid[cell("r1c3")]).toBe(4);
    expect(g.notes[cell("r1c4")]).toBe(0);
  });

  it("explains a provable mistake (row clash) and counts it", () => {
    const g = new SudokuGame(WIKI);
    const ev = track(g);
    g.place(cell("r1c3"), 5); // r1c1 is 5
    const e = ev.find((x) => x.type === "place");
    expect(e).toMatchObject({ type: "place", correct: false, reason: { kind: "house", other: cell("r1c1") } });
    expect(g.mistakes).toBe(1);
    expect(g.isWrong(cell("r1c3"))).toBe(true);
  });

  it("does not count mistakes when checking is off", () => {
    const g = new SudokuGame(WIKI);
    g.settings.checkMistakes = false;
    g.place(cell("r1c3"), 5);
    expect(g.mistakes).toBe(0);
  });

  it("killer: duplicate in cage and impossible sum are explained", () => {
    const p: Puzzle = {
      id: "k",
      kind: "killer",
      cages: [cage(0, 3, ["r1c1", "r1c2"]), cage(1, 10, ["r1c3", "r1c4"])],
      solution: "123456789456789123789123456234567891567891234891234567345678912678912345912345678",
    };
    const g = new SudokuGame(p);
    expect(g.mistakeReason(cell("r1c1"), 5)).toMatchObject({ kind: "cage-sum", sum: 3 });
    g.place(cell("r1c3"), 3);
    expect(g.mistakeReason(cell("r1c4"), 3)).toMatchObject({ kind: "house" }); // same row wins
  });

  it("emits completion for a finished row and solved at the end", () => {
    const g = new SudokuGame(WIKI);
    const ev = track(g);
    const sol = WIKI.solution!;
    // Fill row 1.
    for (let c = 0; c < 9; c++) if (!g.grid[c]) g.place(c, Number(sol[c]));
    const complete = ev.filter((e) => e.type === "complete");
    expect(complete.some((e) => e.type === "complete" && e.houses.some((h) => h.kind === "row" && h.index === 0))).toBe(true);
    for (let c = 0; c < 81; c++) if (!g.grid[c]) g.place(c, Number(sol[c]));
    expect(g.solved).toBe(true);
    expect(ev.some((e) => e.type === "solved")).toBe(true);
  });

  it("applies a step hint as one undoable action", () => {
    const g = new SudokuGame(WIKI);
    const h = g.hint();
    expect(h.kind).toBe("step");
    g.applyHint(h);
    const p = h.step!.placements[0]!;
    expect(g.grid[p.cell]).toBe(p.digit);
    expect(g.hintsUsed).toBe(1);
    g.undo();
    expect(g.grid[p.cell]).toBe(0);
  });

  it("applies an elimination hint by writing notes", () => {
    const g = new SudokuGame(WIKI);
    // Walk hints until an elimination step appears (or the puzzle is solved).
    for (let i = 0; i < 200 && !g.solved; i++) {
      const h = g.hint();
      if (h.kind !== "step") break;
      if (h.step!.eliminations.length) {
        g.applyHint(h);
        const e = h.step!.eliminations[0]!;
        expect(g.notes[e.cell]! & (1 << e.digit)).toBe(0);
        expect(g.notes[e.cell]).not.toBe(0);
        return;
      }
      g.applyHint(h);
    }
    expect(g.solved).toBe(true); // all singles: fine too
  });

  it("bulk-pencils a digit across cells as one undo step, toggling off when all have it", () => {
    const g = new SudokuGame(WIKI);
    const cells = [cell("r1c3"), cell("r1c4"), cell("r1c1")]; // r1c1 is a given: skipped
    g.toggleNote(cell("r1c3"), 2);
    g.toggleNoteMany(cells, 2);
    expect(g.notes[cell("r1c3")]).toBe(maskOf([2]));
    expect(g.notes[cell("r1c4")]).toBe(maskOf([2]));
    g.toggleNoteMany(cells, 2); // all have it → remove everywhere
    expect(g.notes[cell("r1c3")]).toBe(0);
    expect(g.notes[cell("r1c4")]).toBe(0);
    g.undo();
    expect(g.notes[cell("r1c4")]).toBe(maskOf([2]));
  });

  it("erases a whole selection — digits and notes, givens untouched — as one undo step", () => {
    const g = new SudokuGame(WIKI);
    g.place(cell("r1c3"), 4);
    g.toggleNote(cell("r1c4"), 6);
    g.toggleNote(cell("r1c4"), 2);
    const events = track(g);
    g.eraseMany([cell("r1c3"), cell("r1c4"), cell("r1c1"), cell("r1c6")]); // r1c1 given, r1c6 already empty
    expect(g.grid[cell("r1c3")]).toBe(0);
    expect(g.notes[cell("r1c4")]).toBe(0);
    expect(g.grid[cell("r1c1")]).toBe(5);
    expect(events).toContainEqual({ type: "erase", cells: [cell("r1c3"), cell("r1c4")] });
    g.undo();
    expect(g.grid[cell("r1c3")]).toBe(4);
    expect(g.notes[cell("r1c4")]).toBe(maskOf([2, 6]));
  });

  it("a round pencils in what it leaves, in only the squares it marks, and is remembered for the next hint", () => {
    const g = new SudokuGame(WIKI);
    g.toggleNote(cell("r1c4"), 2); // the player's own notes (r1c4 can be 2 or 6)
    g.toggleNote(cell("r1c4"), 6);
    g.toggleNote(cell("r9c1"), 1); // a square the round doesn't mark
    const step = {
      technique: "pointing",
      tier: 2,
      rating: 2,
      placements: [],
      eliminations: [
        { cell: cell("r1c3"), digit: 1 },
        { cell: cell("r1c4"), digit: 2 },
      ],
      focus: { cells: [], cages: [], houses: [] },
      explain: {},
      marks: [
        { cell: cell("r2c3"), digit: 2, role: "key" },
        { cell: cell("r1c6"), digit: 2, role: "digit" },
      ],
    } as unknown as Step;
    g.applyHint({ kind: "step", title: "Pointing", ladder: { where: "", what: "", why: [], do: "" }, step });
    expect(g.known[cell("r1c3")]).toBe(maskOf([1]));
    expect(g.notes[cell("r1c3")]).toBe(maskOf([2, 4])); // an empty square: its candidates (1, 2, 4), less the 1
    expect(g.notes[cell("r1c4")]).toBe(maskOf([6])); // the player's notes keep what's still possible
    expect(g.notes[cell("r2c3")]).toBe(maskOf([2, 4, 7])); // the squares the reasoning uses are pencilled too
    expect(g.notes[cell("r1c6")]).toBe(0); // "every other 2" pencils nothing
    expect(g.notes[cell("r9c1")]).toBe(maskOf([1]));
    expect(g.hintCandidates()[cell("r1c3")]! & maskOf([1])).toBe(0);
    g.undo(); // one step; what the hint ruled out stays known
    expect(g.notes[cell("r1c3")]).toBe(0);
    expect(g.notes[cell("r1c4")]).toBe(maskOf([2, 6]));
    expect(g.known[cell("r1c3")]).toBe(maskOf([1]));
    const restored = new SudokuGame(WIKI, JSON.parse(JSON.stringify(g.toJSON())));
    expect(restored.known[cell("r1c3")]).toBe(maskOf([1]));
  });

  it("a round toward a digit is applied a step at a time, each pencilling only its own squares — the board from the bug report", () => {
    // killer-medium-1: the round that ends with 9 pointing out of the top-middle box. Its squares
    // used to get no notes; now they get exactly what each step drew, less what it struck.
    const g = new SudokuGame(packPuzzle("killer-medium", 0));
    const isRound = (x: SudokuHint) => !!x.route && !x.route[x.route.length - 1]!.step!.placements.length && x.route.some((r) => r.technique === "pointing");
    let h = g.hint();
    for (let k = 0; k < 20 && !isRound(h); k++) {
      for (const r of h.route ?? [h]) g.applyHint(r);
      h = g.hint();
    }
    expect(isRound(h)).toBe(true);
    expect(h.target).toBe(cell("r1c3"));
    expect(h.ladder.where).toMatch(/^No digit is certain yet\. /);
    expect(h.route!.find((r) => r.technique === "pointing")!.ladder.do).toBe("Note it down: r2c1, r2c2 and r2c3 can't be 9.");
    const squares = ["r1c1", "r1c2", "r1c3", "r1c4", "r2c1", "r2c2", "r2c3", "r2c4", "r2c5", "r2c6"];
    expect([...new Set(h.route!.flatMap((r) => hintMarks(r).map((m) => cellName(m.cell))))].sort()).toEqual(squares);
    const before = Uint16Array.from(g.notes);
    const used = g.hintsUsed;
    for (const r of h.route!) g.applyHint(r);
    expect(g.hintsUsed).toBe(used + h.route!.length); // one hint per step taken
    for (let c = 0; c < 81; c++) if (!squares.includes(cellName(c))) expect(g.notes[c], cellName(c)).toBe(before[c]);
    expect(g.notes[cell("r1c1")]).toBe(maskOf([7, 9]));
    expect(g.notes[cell("r1c3")]).toBe(maskOf([4, 8]));
    expect(g.notes[cell("r1c4")]).toBe(maskOf([4, 8]));
    for (const n of ["r2c1", "r2c2", "r2c3"]) expect(g.notes[cell(n)]! & maskOf([9])).toBe(0);
    for (const n of ["r2c4", "r2c5", "r2c6"]) expect(g.notes[cell(n)]! & maskOf([9])).toBe(maskOf([9]));
    expect(g.hint().kind).toBe("step"); // the next hint doesn't pick at those notes
  });

  it("killer: placing a digit also clears notes its cage's sum no longer allows", () => {
    const p: Puzzle = {
      id: "k",
      kind: "killer",
      cages: [cage(0, 3, ["r1c1", "r1c2"]), cage(1, 15, ["r2c1", "r2c2", "r2c3"])],
      solution: "123456789456789123789123456234567891567891234891234567345678912678912345912345678",
    };
    const g = new SudokuGame(p);
    for (let d = 1; d <= 9; d++) g.toggleNoteMany([cell("r2c2"), cell("r2c3"), cell("r1c2")], d as Digit);
    g.place(cell("r2c1"), 4); // 11 left in two cells: 2+9, 3+8 or 5+6
    expect(g.notes[cell("r2c2")]).toBe(maskOf([2, 3, 5, 6, 8, 9]));
    expect(g.notes[cell("r2c3")]).toBe(maskOf([2, 3, 5, 6, 8, 9]));
    g.undo();
    expect(g.notes[cell("r2c2")]).toBe(maskOf([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    g.place(cell("r2c1"), 9); // wrong, and flagged: it doesn't get to narrow the cage
    expect(g.notes[cell("r2c2")]).toBe(maskOf([1, 2, 3, 4, 5, 6, 7, 8]));
    g.undo();
    g.settings.checkMistakes = false; // unflagged, a wrong digit counts like any other…
    g.place(cell("r2c1"), 9); // 6 left in two cells: 1+5 or 2+4
    expect(g.notes[cell("r2c2")]).toBe(maskOf([1, 2, 4, 5]));
    g.undo();
    g.place(cell("r1c1"), 3); // …unless no digit can finish its cage: then only the 3 comes out
    expect(g.notes[cell("r1c2")]).toBe(maskOf([1, 2, 4, 5, 6, 7, 8, 9]));
    g.undo();
    g.settings.autoClearNotes = false;
    g.place(cell("r2c1"), 4);
    expect(g.notes[cell("r2c2")]).toBe(maskOf([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  it("solving on hints alone never leaves a note the notes check would flag, and every pencil keeps the answer", () => {
    for (const [file, i] of [["killer-easy", 0], ["killer-medium", 0], ["killer-hard", 3], ["killer-expert", 1], ["classic-expert", 0]] as const) {
      const g = new SudokuGame(packPuzzle(file, i));
      for (let k = 0; k < 400 && !g.solved; k++) {
        const h = g.hint();
        expect(h.kind, `${file} #${i}`).toBe("step");
        for (const r of h.route ?? [h]) {
          const before = Uint16Array.from(g.notes);
          g.applyHint(r);
          if (!r.step!.placements.length) {
            // A narrowing step writes what it drew, less what it struck — in its squares and nowhere else.
            const marks = hintMarks(r);
            const squares = new Set(marks.map((m) => m.cell));
            for (let c = 0; c < 81; c++) if (!squares.has(c)) expect(g.notes[c]).toBe(before[c]);
            for (const m of marks) if (m.role !== "elim") expect(g.notes[m.cell]! & (1 << m.digit), `${file} ${cellName(m.cell)}:${m.digit}`).not.toBe(0);
          }
          for (let c = 0; c < 81; c++) if (g.notes[c]) expect(g.notes[c]! & (1 << g.solution[c]!), `${file} ${cellName(c)}`).not.toBe(0);
        }
      }
      expect(g.solved, `${file} #${i}`).toBe(true);
    }
  });

  it("a solved puzzle stays solved: undo and redo do nothing", () => {
    const g = new SudokuGame(WIKI);
    const sol = WIKI.solution!;
    for (let c = 0; c < 81; c++) if (!g.grid[c]) g.place(c, Number(sol[c]));
    expect(g.solved).toBe(true);
    const events = track(g);
    g.undo();
    g.redo();
    expect(g.solved).toBe(true);
    expect(events.filter((e) => e.type === "solved")).toHaveLength(0);
  });

  it("serializes and restores progress", () => {
    const g = new SudokuGame(WIKI);
    g.place(cell("r1c3"), 4);
    g.toggleNote(cell("r1c4"), 6);
    g.elapsedMs = 12345;
    const saved = JSON.parse(JSON.stringify(g.toJSON()));
    const h = new SudokuGame(WIKI, saved);
    expect(h.grid[cell("r1c3")]).toBe(4);
    expect(h.notes[cell("r1c4")]).toBe(maskOf([6]));
    expect(h.elapsedMs).toBe(12345);
  });
});

describe("crossing out cage combinations", () => {
  const p = packPuzzle("killer-easy", 0);
  // A cage with no givens and a choice of combinations.
  const fresh = new SudokuGame(p);
  const k = p.cages.find((c) => c.cells.every((x) => !fresh.grid[x]) && cageCombos(c.cells.length, c.sum).length >= 2)!;
  const [first, second] = cageCombos(k.cells.length, k.sum) as [number, number];

  it("crosses a combination out and back in, each an undo step of its own", () => {
    const g = new SudokuGame(p);
    const events = track(g);
    g.toggleStrike(k, first);
    expect(g.isStruck(k, first)).toBe(true);
    expect(g.isStruck(k, second)).toBe(false);
    expect(events).toContainEqual({ type: "strike", cage: k.id, combo: first, on: true });
    g.toggleStrike(k, first);
    expect(g.isStruck(k, first)).toBe(false);
    expect(events).toContainEqual({ type: "strike", cage: k.id, combo: first, on: false });
    g.undo();
    expect(g.isStruck(k, first)).toBe(true);
    g.undo();
    expect(g.isStruck(k, first)).toBe(false);
    expect(g.canUndo()).toBe(false);
    g.redo();
    expect(g.isStruck(k, first)).toBe(true);
  });

  it("a strike is the whole cage's digits, so it still holds once one of them is placed, and after it's erased", () => {
    const g = new SudokuGame(p);
    const c = k.cells[0]!;
    const d = g.solution[c]! as Digit;
    const whole = cageCombos(k.cells.length, k.sum).find((m) => m & bit(d))!;
    g.toggleStrike(k, whole);
    g.place(c, d);
    // The bar now lists combinations for the squares left: the struck one without the placed digit.
    expect(g.isStruck(k, whole & ~bit(d))).toBe(true);
    g.erase(c);
    expect(g.isStruck(k, whole)).toBe(true);
  });

  it("Clear notes clears strikes too, and undo brings them back", () => {
    const g = new SudokuGame(p);
    g.toggleStrike(k, first);
    g.toggleStrike(k, second);
    g.clearNotes();
    expect(g.isStruck(k, first) || g.isStruck(k, second)).toBe(false);
    g.undo();
    expect(g.isStruck(k, first) && g.isStruck(k, second)).toBe(true);
  });

  it("are saved with the game; a save from before strikes loads with none", () => {
    const g = new SudokuGame(p);
    g.toggleStrike(k, second);
    const saved = JSON.parse(JSON.stringify(g.toJSON())) as SavedSudoku;
    const h = new SudokuGame(p, saved);
    expect(h.isStruck(k, second)).toBe(true);
    expect(h.isStruck(k, first)).toBe(false);
    delete saved.struck;
    expect(new SudokuGame(p, saved).isStruck(k, second)).toBe(false);
  });

  it("a solved puzzle takes no strikes", () => {
    const g = new SudokuGame(p);
    g.solved = true;
    g.toggleStrike(k, first);
    expect(g.isStruck(k, first)).toBe(false);
  });
});

describe("auto-note layer", () => {
  const withLayer = (p: Puzzle = WIKI) => {
    const g = new SudokuGame(p);
    g.settings.autoNotes = true;
    return g;
  };

  it("is empty when off; on, each square shows its candidates less what hints proved, strikes and own notes", () => {
    const g = new SudokuGame(WIKI);
    const c = cell("r1c3"); // 1, 2 or 4
    expect(g.layer()[c]).toBe(0);
    g.settings.autoNotes = true;
    expect(g.layer()[c]).toBe(maskOf([1, 2, 4]));
    expect(g.layer()[cell("r1c1")]).toBe(0); // a given
    g.known[c] = maskOf([1]);
    expect(g.layer()[c]).toBe(maskOf([2, 4]));
    g.known[c] = maskOf([1, 2, 4]); // would leave nothing (only a wrong digit does that): not subtracted
    expect(g.layer()[c]).toBe(maskOf([1, 2, 4]));
    g.known[c] = 0;
    g.toggleNote(c, 5); // 5 is in the row, so it's never dim: it goes in bright
    expect(g.notes[c]).toBe(maskOf([5]));
    expect(g.layer()[c]).toBe(maskOf([1, 2, 4]));
    g.place(cell("r1c9"), 2); // the layer follows the board
    expect(g.layer()[c]).toBe(maskOf([1, 4]));
  });

  it("killer: the layer is the cage-sum candidates", () => {
    const g = withLayer(packPuzzle("killer-easy", 0));
    expect(Array.from(g.layer())).toEqual(Array.from(comboCandidates(g.puzzle, g.grid)));
  });

  it("tap rules: a bright note comes out, a dim digit is struck, a struck digit comes back, anything else goes in bright", () => {
    const g = withLayer();
    const c = cell("r1c3");
    const events = track(g);
    g.toggleNote(c, 2); // dim → struck
    expect(g.hidden[c]).toBe(maskOf([2]));
    expect(g.notes[c]).toBe(0);
    expect(g.layer()[c]).toBe(maskOf([1, 4]));
    expect(events.at(-1)).toEqual({ type: "note", cell: c, digit: 2, on: false });
    g.toggleNote(c, 2); // struck, still allowed → back, dim
    expect(g.hidden[c]).toBe(0);
    expect(g.layer()[c]).toBe(maskOf([1, 2, 4]));
    expect(events.at(-1)).toEqual({ type: "note", cell: c, digit: 2, on: true });
    g.toggleNote(c, 5); // not shown → bright
    expect(g.notes[c]).toBe(maskOf([5]));
    g.toggleNote(c, 5); // bright → out
    expect(g.notes[c]).toBe(0);
    // A strike is one undo step, is saved, and survives the layer being switched off.
    g.toggleNote(c, 2);
    g.undo();
    expect(g.hidden[c]).toBe(0);
    g.redo();
    expect(g.hidden[c]).toBe(maskOf([2]));
    const restored = new SudokuGame(WIKI, JSON.parse(JSON.stringify(g.toJSON())));
    expect(restored.hidden[c]).toBe(maskOf([2]));
    g.settings.autoNotes = false;
    expect(g.layer()[c]).toBe(0);
    g.toggleNote(c, 2); // layer off: tapping behaves as it always did — a bright note
    expect(g.notes[c]).toBe(maskOf([2]));
    expect(g.hidden[c]).toBe(maskOf([2]));
  });

  it("bulk pencil follows what shows: out of every square when all show it, else in wherever it's missing", () => {
    const g = withLayer();
    const a = cell("r1c3"); // 1, 2 or 4
    const b = cell("r1c4"); // 2 or 6
    g.toggleNoteMany([a, b, cell("r1c1")], 2); // both dim → both struck; the given is skipped
    expect(g.hidden[a]).toBe(maskOf([2]));
    expect(g.hidden[b]).toBe(maskOf([2]));
    g.toggleNote(b, 2); // b back
    g.toggleNoteMany([a, b], 2); // shown in one, not all → show in both: a comes back, b stays
    expect(g.hidden[a]).toBe(0);
    expect(g.notes[a]).toBe(0);
    g.toggleNoteMany([a, b], 5); // 5 shows nowhere (it's in the row) → bright in both
    expect(g.notes[a]).toBe(maskOf([5]));
    expect(g.notes[b]).toBe(maskOf([5]));
    g.toggleNoteMany([a, b], 5); // both bright → out of both
    expect(g.notes[a]).toBe(0);
    g.undo();
    expect(g.notes[b]).toBe(maskOf([5]));
  });

  it("erase and Clear notes reset strikes as well", () => {
    const g = withLayer();
    const c = cell("r1c3");
    g.toggleNote(c, 2);
    g.toggleNote(cell("r1c4"), 6);
    g.erase(c);
    expect(g.hidden[c]).toBe(0);
    g.undo();
    expect(g.hidden[c]).toBe(maskOf([2]));
    g.clearNotes();
    expect(g.hidden[c]).toBe(0);
    expect(g.hidden[cell("r1c4")]).toBe(0);
    g.undo();
    expect(g.hidden[cell("r1c4")]).toBe(maskOf([6]));
  });
});

describe("hints with the auto-note layer on", () => {
  const sumStep = (s: Step) => s.technique === "cage-combos" && (s.explain as { basis?: string }).basis === "sum";

  it("count the layer as known: the opening round skips the cage sums the layer already shows", () => {
    const p = packPuzzle("killer-expert", 1);
    const plain = new SudokuGame(p).hint();
    expect((plain.route ?? [plain]).some((r) => sumStep(r.step!))).toBe(true); // what it re-taught before
    const g = new SudokuGame(p);
    g.settings.autoNotes = true;
    const h = g.hint();
    expect(h.kind).toBe("step");
    expect((h.route ?? [h]).some((r) => sumStep(r.step!))).toBe(false);
    const layer = comboCandidates(p, g.grid);
    for (let c = 0; c < 81; c++) expect(g.hintCandidates()[c]! & ~layer[c]!).toBe(0); // pencils nothing the layer rules out
    expect(g.known.every((k) => k === 0)).toBe(true); // and nothing is stored
    g.settings.autoNotes = false;
    expect(Array.from(g.effectiveKnown())).toEqual(Array.from(g.known));
  });

  it("applying a narrowing step writes no notes into note-less squares: the layer narrows instead", () => {
    const g = new SudokuGame(WIKI);
    g.toggleNote(cell("r1c4"), 2); // the player's own notes, pencilled before the layer went on
    g.toggleNote(cell("r1c4"), 6);
    g.settings.autoNotes = true;
    const step = {
      technique: "pointing",
      tier: 2,
      rating: 2,
      placements: [],
      eliminations: [
        { cell: cell("r1c3"), digit: 1 },
        { cell: cell("r1c4"), digit: 2 },
      ],
      focus: { cells: [], cages: [], houses: [] },
      explain: {},
      marks: [{ cell: cell("r2c3"), digit: 2, role: "key" }],
    } as unknown as Step;
    g.applyHint({ kind: "step", title: "Pointing", ladder: { where: "", what: "", why: [], do: "" }, step });
    expect(g.known[cell("r1c3")]).toBe(maskOf([1]));
    expect(g.notes[cell("r1c3")]).toBe(0); // nothing written…
    expect(g.layer()[cell("r1c3")]).toBe(maskOf([2, 4])); // …the layer shows the 1 gone
    expect(g.notes[cell("r2c3")]).toBe(0);
    expect(g.notes[cell("r1c4")]).toBe(maskOf([6])); // own notes keep what's still possible
  });

  it("solving a killer on hints alone works with the layer on, and never leaves a note the notes check would flag", () => {
    for (const [file, i] of [["killer-hard", 3], ["killer-expert", 1]] as const) {
      const g = new SudokuGame(packPuzzle(file, i));
      g.settings.autoNotes = true;
      for (let k = 0; k < 400 && !g.solved; k++) {
        const h = g.hint();
        expect(h.kind, `${file} #${i}`).toBe("step");
        for (const r of h.route ?? [h]) g.applyHint(r);
        for (let c = 0; c < 81; c++) if (g.notes[c]) expect(g.notes[c]! & (1 << g.solution[c]!), `${file} ${cellName(c)}`).not.toBe(0);
      }
      expect(g.solved, `${file} #${i}`).toBe(true);
    }
  });
});
