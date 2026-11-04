/**
 * Queens game model: the player's marks (empty / ✕ / queen), undo/redo, conflicts, completion
 * events and hint application. Pure TS.
 *
 * Auto-cross is derived, not stored: cells attacked by a placed queen *display* as crossed when the
 * setting is on, so removing a queen cleanly un-crosses them and undo history stays small.
 *
 * Gestures: a tap toggles an ✕ (queens ignore taps, so a stray one can't knock a queen off), a
 * double tap makes a queen, a hold clears a cell, a drag paints ✕s (or erases them).
 *
 * Scratch: a what-if layer. beginScratch() snapshots the real board; marks made after it count for
 * nothing — no mistakes, no right/wrong feedback, no completion — and saves and hints keep reading
 * the snapshot. wipeScratch() puts everything back; keepScratch() makes it real as one undo step,
 * checked like any other move.
 */
import { attacks, makeBoard, rowOf, colOf, type QBoard } from "../engine/queens/geometry";
import { queensHint, type QueensHint, type RegionNamer } from "../engine/queens/hints";
import { CROSS, EMPTY, QUEEN, type QCell, type QueensPuzzle, type Unit } from "../engine/queens/types";

export type QueensEvent =
  | { type: "mark"; cell: QCell; mark: number; prev: number }
  | { type: "queen"; cell: QCell; correct: boolean; conflicts: QCell[] }
  /** A queen placed while scratching: rule clashes only, never right or wrong. */
  | { type: "scratch-queen"; cell: QCell; conflicts: QCell[] }
  | { type: "marks"; cells: QCell[] }
  | { type: "scratch"; on: boolean; kept?: boolean; cells: QCell[] }
  | { type: "complete"; cell: QCell; units: Unit[] }
  | { type: "solved" }
  | { type: "lost" }
  | { type: "history"; kind: "undo" | "redo"; cells: QCell[] };

interface Change {
  cell: QCell;
  from: number;
  to: number;
}

export interface SavedQueens {
  v: 1;
  puzzleId: string;
  marks: number[];
  elapsed: number;
  mistakes: number;
  hints: number;
  rungs: number[];
  solved: boolean;
}

export class QueensGame {
  readonly puzzle: QueensPuzzle;
  readonly n: number;
  readonly board: QBoard;
  marks: Uint8Array;
  elapsedMs = 0;
  mistakes = 0;
  hintsUsed = 0;
  rungs = [0, 0, 0, 0, 0];
  solved = false;
  /** Went over the mistake limit. Never saved: a lost game is over, not resumed. */
  lost = false;
  /** `mistakeLimit`: counted mistakes the game forgives (0: none), one more loses it. Null: they never end a game. */
  settings: { checkMistakes: boolean; mistakeLimit: number | null } = { checkMistakes: true, mistakeLimit: null };
  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  private listeners = new Set<(e: QueensEvent) => void>();
  /** The undo entry of the last tap, which a double tap folds into its queen. */
  private lastTap: Change[] | null = null;
  /** The undo entry of the drag in progress, which later strokes of the same drag extend. */
  private paintEntry: Change[] | null = null;
  /** While scratching: the real board, the undo depth it began at, and the redo stack set aside. */
  private scratchState: { base: Uint8Array; depth: number; redo: Change[][] } | null = null;

  constructor(puzzle: QueensPuzzle, saved?: SavedQueens | null) {
    this.puzzle = puzzle;
    this.n = puzzle.n;
    this.board = makeBoard(puzzle);
    this.marks = new Uint8Array(puzzle.n * puzzle.n);
    if (saved && saved.puzzleId === puzzle.id && saved.marks.length === this.marks.length) {
      this.marks = Uint8Array.from(saved.marks);
      this.elapsedMs = saved.elapsed;
      this.mistakes = saved.mistakes;
      this.hintsUsed = saved.hints;
      this.rungs = [...saved.rungs, 0, 0, 0, 0, 0].slice(0, 5);
      this.solved = saved.solved;
    }
  }

  on(fn: (e: QueensEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: QueensEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /** Solved or lost: the board is closed. */
  get over(): boolean {
    return this.solved || this.lost;
  }

  region(c: QCell): number {
    return this.puzzle.regions[c]!;
  }

  isSolutionCell(c: QCell): boolean {
    return this.puzzle.solution[rowOf(c, this.n)] === colOf(c, this.n);
  }

  queens(): QCell[] {
    const out: QCell[] = [];
    this.marks.forEach((m, c) => m === QUEEN && out.push(c));
    return out;
  }

  /** Cells attacked by at least one queen on `marks` (for auto-cross display). */
  attacked(marks: Uint8Array = this.marks): Uint8Array {
    const a = new Uint8Array(marks.length);
    marks.forEach((m, q) => {
      if (m === QUEEN) for (const c of attacks(this.board, q)) if (c !== q) a[c] = 1;
    });
    return a;
  }

  /** Queens that break a rule with another queen. */
  conflicts(): Set<QCell> {
    const qs = this.queens();
    const bad = new Set<QCell>();
    for (let i = 0; i < qs.length; i++)
      for (let j = i + 1; j < qs.length; j++) {
        const a = qs[i]!;
        const b = qs[j]!;
        if (attacks(this.board, a).includes(b)) {
          bad.add(a);
          bad.add(b);
        }
      }
    return bad;
  }

  /** Correct queens on the real board, as a fraction (a scratch never moves it: that would tell). */
  progress(): number {
    let right = 0;
    this.realMarks.forEach((m, c) => m === QUEEN && this.isSolutionCell(c) && right++);
    return right / this.n;
  }

  get scratching(): boolean {
    return this.scratchState !== null;
  }

  /** While scratching: the board from before the scratch began; otherwise null. */
  get scratchBase(): Uint8Array | null {
    return this.scratchState?.base ?? null;
  }

  /** The board as it really is: the marks, or while scratching the snapshot under them. */
  get realMarks(): Uint8Array {
    return this.scratchState?.base ?? this.marks;
  }

  canUndo(): boolean {
    return this.undoStack.length > (this.scratchState?.depth ?? 0);
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private commit(changes: Change[]): Change[] {
    const real = changes.filter((c) => c.from !== c.to);
    if (!real.length) return real;
    for (const ch of real) this.marks[ch.cell] = ch.to;
    this.undoStack.push(real);
    if (this.undoStack.length > 500) {
      this.undoStack.shift();
      if (this.scratchState) this.scratchState.depth = Math.max(0, this.scratchState.depth - 1);
    }
    this.redoStack = [];
    return real;
  }

  setMark(cell: QCell, mark: number): void {
    this.mark(cell, mark);
  }

  /** Change one cell; returns its undo entry, or null if nothing changed. */
  private mark(cell: QCell, mark: number): Change[] | null {
    if (this.over) return null;
    const prev = this.marks[cell]!;
    const entry = this.commit([{ cell, from: prev, to: mark }]);
    if (!entry.length) return null;
    this.emit({ type: "mark", cell, mark, prev });
    if (mark === QUEEN) {
      if (this.scratchState) this.emit({ type: "scratch-queen", cell, conflicts: this.clashes(cell) });
      else this.afterQueen(cell);
    }
    return entry;
  }

  /** Tap: an ✕ on an empty cell, or off again. Queens ignore taps; clear() removes one. */
  tap(cell: QCell): void {
    this.lastTap = null;
    const m = this.marks[cell]!;
    if (m === QUEEN) return;
    this.lastTap = this.mark(cell, m === CROSS ? EMPTY : CROSS);
  }

  /** The second tap of a double tap: whatever the first tap did becomes a queen, as one undo step. */
  doubleTap(cell: QCell): void {
    if (this.over) return;
    const first = this.lastTap;
    this.lastTap = null;
    if (first?.[0]?.cell === cell && this.undoStack[this.undoStack.length - 1] === first) {
      this.undoStack.pop();
      this.marks[cell] = first[0].from;
    }
    if (this.marks[cell] !== QUEEN) this.mark(cell, QUEEN);
  }

  /** Hold: empty a cell, queen or ✕. */
  clear(cell: QCell): void {
    this.mark(cell, EMPTY);
  }

  /**
   * Drag: paint ✕s over empty cells, or with EMPTY erase ✕s; queens are never touched. A drag is
   * one undo step: pass `more` for every stroke after its first.
   */
  paint(cells: QCell[], mark: typeof CROSS | typeof EMPTY, more: boolean): void {
    if (!more) this.paintEntry = null;
    if (this.over) return;
    const from = mark === CROSS ? EMPTY : CROSS;
    const changes = cells.filter((c) => this.marks[c] === from).map((c) => ({ cell: c, from, to: mark }));
    if (!changes.length) return;
    const top = this.undoStack[this.undoStack.length - 1];
    if (more && top && top === this.paintEntry) {
      for (const ch of changes) this.marks[ch.cell] = ch.to;
      top.push(...changes);
    } else this.paintEntry = this.commit(changes);
    this.emit({ type: "marks", cells: changes.map((c) => c.cell) });
  }

  /** Queens that `cell`'s queen breaks a rule with. */
  private clashes(cell: QCell): QCell[] {
    const hit = attacks(this.board, cell);
    return this.queens().filter((q) => q !== cell && hit.includes(q));
  }

  // ------------------------------------------------------------------------------------------
  // Scratch

  beginScratch(): void {
    if (this.scratchState || this.over) return;
    this.scratchState = { base: this.marks.slice(), depth: this.undoStack.length, redo: this.redoStack };
    this.redoStack = [];
    this.lastTap = this.paintEntry = null;
    this.emit({ type: "scratch", on: true, cells: [] });
  }

  /** Throw the scratch away: the board, undo and redo go back to how they were before it. */
  wipeScratch(): void {
    const s = this.scratchState;
    if (!s) return;
    const cells = this.diff(s.base).map((ch) => ch.cell);
    this.marks = s.base;
    this.undoStack.length = Math.min(this.undoStack.length, s.depth);
    this.redoStack = s.redo;
    this.scratchState = null;
    this.lastTap = this.paintEntry = null;
    this.emit({ type: "scratch", on: false, kept: false, cells });
  }

  /** Make the scratch real: one undo step, and each new queen is checked like any placement. */
  keepScratch(): void {
    const s = this.scratchState;
    if (!s) return;
    const changes = this.diff(s.base);
    this.scratchState = null;
    this.undoStack.length = Math.min(this.undoStack.length, s.depth);
    this.redoStack = [];
    if (changes.length) this.undoStack.push(changes);
    this.lastTap = this.paintEntry = null;
    this.emit({ type: "scratch", on: false, kept: true, cells: changes.map((ch) => ch.cell) });
    for (const ch of changes) if (ch.to === QUEEN) this.afterQueen(ch.cell);
  }

  /** Every cell that differs from `base`, as changes from it. */
  private diff(base: Uint8Array): Change[] {
    const out: Change[] = [];
    this.marks.forEach((m, c) => m !== base[c] && out.push({ cell: c, from: base[c]!, to: m }));
    return out;
  }

  // ------------------------------------------------------------------------------------------

  private afterQueen(cell: QCell): void {
    if (this.lost) return; // Keep checks its queens in turn: the game may end partway through them
    const correct = this.isSolutionCell(cell);
    const conflicts = this.clashes(cell);
    if (!correct) this.countMistake();
    this.emit({ type: "queen", cell, correct, conflicts });
    if (this.lost) this.emit({ type: "lost" });
    else if (correct) {
      const units: Unit[] = [
        { type: "row", index: rowOf(cell, this.n) },
        { type: "col", index: colOf(cell, this.n) },
        { type: "region", index: this.region(cell) },
      ];
      this.emit({ type: "complete", cell, units });
      this.checkSolved();
    }
  }

  /** A wrong queen, counted if mistakes are being flagged. Going over the limit loses the game. */
  private countMistake(): void {
    if (!this.settings.checkMistakes) return;
    this.mistakes++;
    const limit = this.settings.mistakeLimit;
    this.lost = limit !== null && this.mistakes > limit;
  }

  private checkSolved(): void {
    if (this.solved || this.scratchState) return;
    const qs = this.queens();
    if (qs.length !== this.n || !qs.every((q) => this.isSolutionCell(q))) return;
    this.solved = true;
    this.emit({ type: "solved" });
  }

  clearAll(): void {
    if (this.over) return;
    const changed = this.commit([...this.marks].map((m, c) => ({ cell: c, from: m, to: EMPTY })));
    if (changed.length) this.emit({ type: "marks", cells: changed.map((c) => c.cell) });
  }

  /** Once over, history is closed: undoing and redoing would solve the puzzle (and score it) twice, or dodge a loss. */
  undo(): void {
    if (this.over || !this.canUndo()) return;
    const e = this.undoStack.pop();
    if (!e) return;
    this.lastTap = this.paintEntry = null;
    for (const ch of e) this.marks[ch.cell] = ch.from;
    this.redoStack.push(e);
    this.solved = false;
    this.emit({ type: "history", kind: "undo", cells: e.map((c) => c.cell) });
  }

  redo(): void {
    if (this.over) return;
    const e = this.redoStack.pop();
    if (!e) return;
    this.lastTap = this.paintEntry = null;
    for (const ch of e) this.marks[ch.cell] = ch.to;
    this.undoStack.push(e);
    this.emit({ type: "history", kind: "redo", cells: e.map((c) => c.cell) });
    this.checkSolved();
  }

  /** Hints reason from the real board, never from a scratch. */
  hint(names?: RegionNamer): QueensHint {
    return queensHint(this.puzzle, this.realMarks, names);
  }

  recordRung(r: number): void {
    if (r >= 0 && r < this.rungs.length) this.rungs[r]!++;
  }

  applyHint(h: QueensHint): void {
    if (this.over || this.scratchState) return;
    this.hintsUsed++;
    const changes: Change[] = [];
    if (h.kind === "step" && h.step) {
      for (const c of h.step.eliminations) if (this.marks[c] === EMPTY) changes.push({ cell: c, from: EMPTY, to: CROSS });
      for (const c of h.step.placements) changes.push({ cell: c, from: this.marks[c]!, to: QUEEN });
    } else if (h.kind === "mistake") {
      for (const c of h.wrongCells ?? []) changes.push({ cell: c, from: this.marks[c]!, to: EMPTY });
    } else if (h.kind === "notes") {
      for (const c of h.wrongCells ?? []) changes.push({ cell: c, from: this.marks[c]!, to: EMPTY });
    }
    const real = this.commit(changes);
    if (!real.length) return;
    this.emit({ type: "marks", cells: real.map((c) => c.cell) });
    for (const ch of real) if (ch.to === QUEEN) this.afterQueen(ch.cell);
  }

  toJSON(): SavedQueens {
    return {
      v: 1,
      puzzleId: this.puzzle.id,
      marks: Array.from(this.realMarks), // a scratch is never saved: your spot is
      elapsed: Math.round(this.elapsedMs),
      mistakes: this.mistakes,
      hints: this.hintsUsed,
      rungs: [...this.rungs],
      solved: this.solved,
    };
  }
}
