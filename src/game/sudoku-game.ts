/**
 * Sudoku game model (classic + killer): the player's digits and notes, undo/redo, mistake
 * reasons, completion events and hint application. Pure TS — the UI subscribes to events and
 * turns them into visuals and sound.
 */
import { basicCandidates, comboCandidates, gridFromPuzzle } from "../engine/candidates";
import { bit, cageCombos } from "../engine/combos";
import { CELL_HOUSES, HOUSE_CELLS, houseAt, PEERS } from "../engine/geometry";
import { hintMarks, shownCandidates, sudokuHint, type SudokuHint } from "../engine/hints/index";
import { puzzleKind, type Cage, type CellId, type Digit, type House, type Puzzle, type PuzzleKind } from "../engine/types";
import { parseSolution } from "../engine/validate";

export type MistakeReason =
  | { kind: "house"; house: House; other: CellId }
  | { kind: "cage-dup"; cage: number; other: CellId }
  | { kind: "cage-sum"; cage: number; sum: number; size: number; rem: number; combos: number[] }
  | { kind: "solution" };

export interface Change {
  cell: CellId;
  digit: [number, number];
  notes: [number, number];
  /** Auto-note digits the player struck out (before, after); absent when a change leaves them alone. */
  hidden?: [number, number];
}

interface HistoryEntry {
  label: string;
  changes: Change[];
}

export type GameEvent =
  | { type: "place"; cell: CellId; digit: Digit; correct: boolean; reason?: MistakeReason; fromHint?: boolean }
  | { type: "erase"; cells: CellId[] }
  | { type: "note"; cell: CellId; digit: Digit; on: boolean }
  | { type: "notes"; cells: CellId[] }
  | { type: "complete"; cell: CellId; houses: House[]; cages: number[]; digits: Digit[] }
  | { type: "solved" }
  | { type: "history"; kind: "undo" | "redo"; cells: CellId[] };

export interface SudokuSettings {
  /** Remove a placed digit from the notes of its row/column/box/cage. */
  autoClearNotes: boolean;
  /** Flag wrong digits immediately (and count mistakes). */
  checkMistakes: boolean;
  /** Show the auto-note layer: dim digits the rules still allow, under the player's own notes. */
  autoNotes: boolean;
}

export interface SavedSudoku {
  v: 1;
  puzzleId: string;
  grid: number[];
  notes: number[];
  elapsed: number;
  mistakes: number;
  hints: number;
  rungs: number[];
  solved: boolean;
  /** Candidates hints have ruled out (bitmask per cell); older saves don't have it. */
  known?: number[];
  /** Auto-note digits the player struck out (bitmask per cell); older saves don't have it. */
  hidden?: number[];
}

export class SudokuGame {
  readonly puzzle: Puzzle;
  readonly kind: PuzzleKind;
  readonly solution: Uint8Array;
  readonly given: Uint8Array;
  grid: Uint8Array;
  notes: Uint16Array;
  /** Candidates hints have ruled out — the next hint builds on them, whatever the notes say. */
  known: Uint16Array;
  /** Auto-note digits the player struck out: the layer leaves them out until they're unstruck or erased. */
  hidden: Uint16Array;
  elapsedMs = 0;
  mistakes = 0;
  /** Hints applied (rung 4) or otherwise consumed. */
  hintsUsed = 0;
  /** How many times each rung (0..4) was revealed. */
  rungs = [0, 0, 0, 0, 0];
  solved = false;
  settings: SudokuSettings = { autoClearNotes: true, checkMistakes: true, autoNotes: false };

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<(e: GameEvent) => void>();
  private cageIndex: Int16Array;

  constructor(puzzle: Puzzle, saved?: SavedSudoku | null) {
    if (!puzzle.solution) throw new Error("SudokuGame needs a puzzle with a solution");
    this.puzzle = puzzle;
    this.kind = puzzleKind(puzzle);
    this.solution = parseSolution(puzzle.solution);
    const g = gridFromPuzzle(puzzle);
    this.given = g.map((d) => (d ? 1 : 0));
    this.grid = Uint8Array.from(g);
    this.notes = new Uint16Array(81);
    this.known = new Uint16Array(81);
    this.hidden = new Uint16Array(81);
    this.cageIndex = new Int16Array(81).fill(-1);
    puzzle.cages.forEach((cage, i) => cage.cells.forEach((c) => (this.cageIndex[c] = i)));
    if (saved && saved.puzzleId === puzzle.id && saved.grid.length === 81) {
      for (let c = 0; c < 81; c++) {
        if (!this.given[c]) this.grid[c] = saved.grid[c] ?? 0;
        this.notes[c] = saved.notes[c] ?? 0;
      }
      this.elapsedMs = saved.elapsed;
      this.mistakes = saved.mistakes;
      this.hintsUsed = saved.hints;
      this.rungs = [...saved.rungs, 0, 0, 0, 0, 0].slice(0, 5);
      this.solved = saved.solved;
      if (saved.known?.length === 81) this.known = Uint16Array.from(saved.known);
      if (saved.hidden?.length === 81) this.hidden = Uint16Array.from(saved.hidden);
    }
  }

  on(fn: (e: GameEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: GameEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  cageOf(cell: CellId): Cage | undefined {
    const i = this.cageIndex[cell]!;
    return i >= 0 ? this.puzzle.cages[i] : undefined;
  }

  isWrong(cell: CellId): boolean {
    const d = this.grid[cell]!;
    return d !== 0 && d !== this.solution[cell];
  }

  /** How many of each digit are placed correctly (index 1..9). */
  digitCounts(): number[] {
    const out = new Array<number>(10).fill(0);
    for (let c = 0; c < 81; c++) if (this.grid[c] && this.grid[c] === this.solution[c]) out[this.grid[c]!]!++;
    return out;
  }

  filledCount(): number {
    let n = 0;
    for (let c = 0; c < 81; c++) if (this.grid[c] && this.grid[c] === this.solution[c]) n++;
    return n;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ------------------------------------------------------------------------------------------
  // Mutations (each one is a single undoable history entry)

  private commit(label: string, changes: Change[]): void {
    const real = changes.filter((ch) => ch.digit[0] !== ch.digit[1] || ch.notes[0] !== ch.notes[1] || (ch.hidden && ch.hidden[0] !== ch.hidden[1]));
    if (!real.length) return;
    for (const ch of real) {
      this.grid[ch.cell] = ch.digit[1];
      this.notes[ch.cell] = ch.notes[1];
      if (ch.hidden) this.hidden[ch.cell] = ch.hidden[1];
    }
    this.undoStack.push({ label, changes: real });
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * Changes for placing a digit: the cell itself plus, when auto-clear is on, the notes it makes
   * impossible — its digit in the row, column, box and cage, and (killer) any digit the cage's
   * remaining sum no longer allows. So no note the hint's notes check would flag is left behind.
   */
  private placeChanges(cell: CellId, digit: Digit, pending: Map<CellId, Change>): void {
    const get = (c: CellId): Change => {
      let ch = pending.get(c);
      if (!ch) pending.set(c, (ch = { cell: c, digit: [this.grid[c]!, this.grid[c]!], notes: [this.notes[c]!, this.notes[c]!] }));
      return ch;
    };
    const self = get(cell);
    self.digit[1] = digit;
    self.notes[1] = 0;
    if (!this.settings.autoClearNotes) return;
    const off = ~bit(digit);
    const peers = new Set(PEERS[cell]);
    const cage = this.cageOf(cell);
    for (const c of cage?.cells ?? []) if (c !== cell) peers.add(c);
    for (const p of peers) {
      const ch = get(p);
      if (ch.notes[1] & bit(digit)) ch.notes[1] &= off;
    }
    // A digit already flagged wrong doesn't narrow its cage: erasing it would leave the notes short.
    if (!cage || (digit !== this.solution[cell] && this.settings.checkMistakes)) return;
    let rem = cage.sum;
    let used = 0;
    const empty: CellId[] = [];
    for (const c of cage.cells) {
      const d = pending.get(c)?.digit[1] ?? this.grid[c]!;
      if (d) {
        rem -= d;
        used |= bit(d);
      } else empty.push(c);
    }
    const allowed = cageCombos(empty.length, rem)
      .filter((m) => !(m & used))
      .reduce((a, m) => a | m, 0);
    // No combination left means the digit itself is wrong: leave the notes for when it's fixed.
    if (allowed) for (const c of empty) get(c).notes[1] &= allowed;
  }

  mistakeReason(cell: CellId, digit: Digit): MistakeReason {
    for (const h of CELL_HOUSES[cell]!)
      for (const c of HOUSE_CELLS[h]!) if (c !== cell && this.grid[c] === digit) return { kind: "house", house: houseAt(h), other: c };
    const cage = this.cageOf(cell);
    if (cage) {
      for (const c of cage.cells) if (c !== cell && this.grid[c] === digit) return { kind: "cage-dup", cage: cage.id, other: c };
      let rem = cage.sum;
      let used = 0;
      let empty = 0;
      for (const c of cage.cells) {
        if (c === cell || !this.grid[c]) empty++;
        else {
          rem -= this.grid[c]!;
          used |= bit(this.grid[c]!);
        }
      }
      const combos = cageCombos(empty, rem).filter((m) => !(m & used));
      if (!combos.some((m) => m & bit(digit)))
        return { kind: "cage-sum", cage: cage.id, sum: cage.sum, size: cage.cells.length, rem, combos };
    }
    return { kind: "solution" };
  }

  place(cell: CellId, digit: Digit, fromHint = false): void {
    if (this.solved || this.given[cell] || this.grid[cell] === digit) return;
    const correct = digit === this.solution[cell];
    const reason = correct ? undefined : this.mistakeReason(cell, digit);
    const pending = new Map<CellId, Change>();
    this.placeChanges(cell, digit, pending);
    this.commit(fromHint ? "hint" : "place", [...pending.values()]);
    if (!correct && this.settings.checkMistakes) this.mistakes++;
    this.emit({ type: "place", cell, digit, correct, reason, fromHint });
    if (correct) this.checkCompletion(cell);
  }

  erase(cell: CellId): void {
    this.eraseMany([cell]);
  }

  /** Wipe several cells at once — digits, notes and strikes; givens stay — as one undo step. */
  eraseMany(cells: readonly CellId[]): void {
    if (this.solved) return;
    const hit = cells.filter((c) => !this.given[c] && (this.grid[c] || this.notes[c] || this.hidden[c]));
    if (!hit.length) return;
    this.commit("erase", hit.map((c): Change => ({ cell: c, digit: [this.grid[c]!, 0], notes: [this.notes[c]!, 0], hidden: [this.hidden[c]!, 0] })));
    this.emit({ type: "erase", cells: hit });
  }

  /**
   * Pencil a digit in or out of a cell, as the player sees it — what you see is what you toggle:
   * a bright note comes out; a dim auto-note is struck (hidden); a struck digit the layer still
   * allows comes back dim; anything else goes in as a bright note.
   */
  toggleNote(cell: CellId, digit: Digit): void {
    if (this.solved || this.grid[cell]) return;
    const base = this.layerBase();
    const shows = ((this.notes[cell]! | this.dimAt(cell, base)) & bit(digit)) !== 0;
    const ch = this.noteToggle(cell, digit, base, shows ? "off" : "on");
    if (!ch) return;
    this.commit("note", [ch]);
    this.emit({ type: "note", cell, digit, on: !shows });
  }

  /**
   * Pencil a digit into several cells at once (one undo step): if every empty cell already shows
   * it (bright or dim), take it out of all of them; otherwise show it everywhere it's missing.
   */
  toggleNoteMany(cells: readonly CellId[], digit: Digit): void {
    if (this.solved) return;
    const empty = cells.filter((c) => !this.grid[c]);
    if (!empty.length) return;
    const base = this.layerBase();
    const b = bit(digit);
    const shows = (c: CellId) => ((this.notes[c]! | this.dimAt(c, base)) & b) !== 0;
    const want = empty.every(shows) ? "off" : "on";
    const changes = empty.map((c) => this.noteToggle(c, digit, base, want)).filter((x): x is Change => !!x);
    if (!changes.length) return;
    this.commit("notes", changes);
    this.emit({ type: "notes", cells: changes.map((ch) => ch.cell) });
    this.emit({ type: "note", cell: changes[0]!.cell, digit, on: want === "on" });
  }

  /**
   * The change that makes `digit` show ("on") or not ("off") in `cell`, following the tap rules;
   * null when it already does (or doesn't).
   */
  private noteToggle(cell: CellId, digit: Digit, base: Uint16Array, want: "on" | "off"): Change | null {
    const b = bit(digit);
    const notes = this.notes[cell]!;
    const hidden = this.hidden[cell]!;
    const hid: [number, number] = [hidden, hidden];
    const ch: Change = { cell, digit: [0, 0], notes: [notes, notes], hidden: hid };
    if (want === "off") {
      if (notes & b) ch.notes[1] = notes & ~b;
      else if (this.dimAt(cell, base) & b) hid[1] = hidden | b;
      else return null;
    } else {
      if ((notes | this.dimAt(cell, base)) & b) return null;
      if (hidden & b && base[cell]! & b) hid[1] = hidden & ~b;
      else ch.notes[1] = notes | b;
    }
    return ch;
  }

  /** Candidates as a player would pencil them: sudoku rules (plus cage sums in killer). */
  candidatesNow(): Uint16Array {
    return this.kind === "killer" ? comboCandidates(this.puzzle, this.grid) : basicCandidates(this.puzzle, this.grid);
  }

  /**
   * What the auto-note layer rests on: the candidates, less what hints have proved (unless that
   * would leave a square empty — only a wrong digit does that). Empty when the layer is off.
   */
  private layerBase(): Uint16Array {
    const out = new Uint16Array(81);
    if (!this.settings.autoNotes) return out;
    const cand = this.candidatesNow();
    for (let c = 0; c < 81; c++) {
      if (this.grid[c]) continue;
      out[c] = cand[c]! & ~this.known[c]! || cand[c]!;
    }
    return out;
  }

  /** The dim digits of one square: the layer's base, less the player's strikes and own notes. */
  private dimAt(cell: CellId, base: Uint16Array): number {
    return base[cell]! & ~this.hidden[cell]! & ~this.notes[cell]!;
  }

  /**
   * The auto-note layer: the dim digits per square — what the rules still allow, less what hints
   * proved, what the player struck and what's already in their notes. Never stored; it recomputes
   * from the board, so placing a digit narrows it on its own. All zeros when the layer is off.
   */
  layer(): Uint16Array {
    const base = this.layerBase();
    for (let c = 0; c < 81; c++) base[c] = this.dimAt(c, base);
    return base;
  }

  /** Clear the player's notes and strikes everywhere, as one undo step. */
  clearNotes(): void {
    const changes: Change[] = [];
    for (let c = 0; c < 81; c++)
      if (this.notes[c] || this.hidden[c]) changes.push({ cell: c, digit: [this.grid[c]!, this.grid[c]!], notes: [this.notes[c]!, 0], hidden: [this.hidden[c]!, 0] });
    this.commit("clear-notes", changes);
    this.emit({ type: "notes", cells: changes.map((ch) => ch.cell) });
  }

  /** Once solved, history is closed: undoing and redoing would solve the puzzle (and score it) twice. */
  undo(): void {
    if (this.solved) return;
    const e = this.undoStack.pop();
    if (!e) return;
    for (const ch of e.changes) {
      this.grid[ch.cell] = ch.digit[0];
      this.notes[ch.cell] = ch.notes[0];
      if (ch.hidden) this.hidden[ch.cell] = ch.hidden[0];
    }
    this.redoStack.push(e);
    this.solved = false;
    this.emit({ type: "history", kind: "undo", cells: e.changes.map((c) => c.cell) });
  }

  redo(): void {
    if (this.solved) return;
    const e = this.redoStack.pop();
    if (!e) return;
    for (const ch of e.changes) {
      this.grid[ch.cell] = ch.digit[1];
      this.notes[ch.cell] = ch.notes[1];
      if (ch.hidden) this.hidden[ch.cell] = ch.hidden[1];
    }
    this.undoStack.push(e);
    this.emit({ type: "history", kind: "redo", cells: e.changes.map((c) => c.cell) });
    this.checkSolved();
  }

  // ------------------------------------------------------------------------------------------
  // Completion

  private checkCompletion(cell: CellId): void {
    const ok = (c: CellId) => this.grid[c] !== 0 && this.grid[c] === this.solution[c];
    const houses = CELL_HOUSES[cell]!.filter((h) => HOUSE_CELLS[h]!.every(ok)).map(houseAt);
    const cage = this.cageOf(cell);
    const cages = cage && cage.cells.length > 1 && cage.cells.every(ok) ? [cage.id] : [];
    const d = this.grid[cell]!;
    const digits = this.digitCounts()[d] === 9 ? [d] : [];
    if (houses.length || cages.length || digits.length) this.emit({ type: "complete", cell, houses, cages, digits });
    this.checkSolved();
  }

  private checkSolved(): void {
    if (this.solved) return;
    for (let c = 0; c < 81; c++) if (this.grid[c] !== this.solution[c]) return;
    this.solved = true;
    this.emit({ type: "solved" });
  }

  // ------------------------------------------------------------------------------------------
  // Hints

  hint(): SudokuHint {
    return sudokuHint({ puzzle: this.puzzle, grid: this.grid, notes: this.notes, solution: this.solution, known: this.known });
  }

  /** The candidates a hint pencils: what a note may hold, minus what hints have ruled out. */
  hintCandidates(): Uint16Array {
    return shownCandidates(this.puzzle, this.grid, this.known);
  }

  recordRung(rung: number): void {
    if (rung >= 0 && rung < this.rungs.length) this.rungs[rung]!++;
  }

  /** Apply a hint's "do" rung as one undoable entry. */
  applyHint(h: SudokuHint): void {
    if (this.solved) return;
    this.hintsUsed++;
    const pending = new Map<CellId, Change>();
    const get = (c: CellId): Change => {
      let ch = pending.get(c);
      if (!ch) pending.set(c, (ch = { cell: c, digit: [this.grid[c]!, this.grid[c]!], notes: [this.notes[c]!, this.notes[c]!] }));
      return ch;
    };
    const placed: { cell: CellId; digit: Digit }[] = [];
    if (h.kind === "step" && h.step) {
      // What a hint rules out is remembered for the next hint, whatever the notes say.
      for (const s of [...(h.prior ?? []), h.step]) for (const e of s.eliminations) this.known[e.cell]! |= bit(e.digit);
      for (const p of h.step.placements) placed.push(p);
      // A round on the way to a digit pencils in what it leaves, in the squares it marks: notes keep
      // the digits still possible (a square with none gets the hint's candidates).
      if (!h.step.placements.length) {
        const cand = this.hintCandidates();
        for (const c of new Set(hintMarks(h).map((m) => m.cell))) {
          if (this.grid[c]) continue;
          const ch = get(c);
          ch.notes[1] = (ch.notes[0] & cand[c]!) || cand[c]!;
        }
      }
    } else if (h.fix) {
      for (const c of h.fix.clear ?? []) {
        const ch = get(c);
        ch.digit[1] = 0;
      }
      // Only the impossible digits come out: the rest of a note is the player's own business.
      for (const { cell, mask } of h.fix.removeNotes ?? []) get(cell).notes[1] &= ~mask;
      for (const r of h.fix.reveal ?? []) placed.push(r);
    }
    for (const p of placed) this.placeChanges(p.cell, p.digit, pending);
    this.commit("hint", [...pending.values()]);
    const cleared = h.fix?.clear ?? [];
    if (cleared.length) this.emit({ type: "erase", cells: cleared });
    const noteCells = [...pending.values()].filter((ch) => ch.notes[0] !== ch.notes[1] && !placed.some((p) => p.cell === ch.cell)).map((ch) => ch.cell);
    if (noteCells.length) this.emit({ type: "notes", cells: noteCells });
    for (const p of placed) {
      this.emit({ type: "place", cell: p.cell, digit: p.digit, correct: true, fromHint: true });
      this.checkCompletion(p.cell);
    }
  }

  // ------------------------------------------------------------------------------------------

  toJSON(): SavedSudoku {
    return {
      v: 1,
      puzzleId: this.puzzle.id,
      grid: Array.from(this.grid),
      notes: Array.from(this.notes),
      elapsed: Math.round(this.elapsedMs),
      mistakes: this.mistakes,
      hints: this.hintsUsed,
      rungs: [...this.rungs],
      solved: this.solved,
      known: Array.from(this.known),
      hidden: Array.from(this.hidden),
    };
  }
}
