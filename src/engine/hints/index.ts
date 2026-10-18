/**
 * The sudoku hint ladder (classic + killer).
 *
 * Order of concerns, so a hint always addresses what's actually blocking the player:
 *   1. solved?                         → kind "solved"
 *   2. a wrong digit on the board      → kind "mistake" (clear it)
 *   3. a note that's impossible        → kind "notes"   (take that digit out of the notes)
 *   4. the next digit you can know     → kind "step"    (place it)
 *   5. nothing found                   → kind "stuck"   (offer to reveal one cell)
 *
 * Hints reason from the board, never from the player's notes: notes say what a cell might be, not
 * everything it can be, so a note that merely leaves out the answer isn't a mistake. Only a note
 * that's impossible — the digit is already in its row, column, box or cage, or no combination of
 * its cage's sum uses it — gets flagged.
 *
 * Every step hint places a digit. The solver looks ahead a few placements and picks the one that
 * needs the fewest narrowing steps first (most need none: a single, or a 45-rule sum); when some
 * are needed, the hint is a route: those steps, then the digit, each a complete hint of its own
 * that the sheet walks through one at a time. When the digit is further off, the route is the
 * first few steps toward it; applying each pencils in what it leaves (`hintMarks` says where) and
 * the game remembers what it ruled out, so the next hint picks up from there. A step whose result
 * the player's notes already show isn't taught: it's folded into the next step, whose Why names
 * what the notes show, and it doesn't count toward the few.
 */
import { basicCandidates } from "../candidates";
import { techniqueName } from "../catalog";
import { bit, digitsOf, popcount } from "../combos";
import { CELL_HOUSES, cellName, houseAt, houseIndex, houseName, HOUSE_CELLS, PEERS } from "../geometry";
import type { HintCommon, LadderText } from "../hint-types";
import { nextStep, type LogicalOptions } from "../logical";
import { TECHNIQUES } from "../techniques";
import type { Technique } from "../techniques/types";
import { cageView } from "../techniques/killer";
import { applyStep, cloneState, createState, isBroken, type SolverState } from "../state";
import type { CandidateMark, CellId, Digit, Grid, House, Puzzle, Step } from "../types";
import { aDigit, cageName, cap, cellList, comboList, maskList, numberWord, plural, relation } from "./format";
import { templateFor } from "./registry";

export interface SudokuHint extends HintCommon {
  /** The step this hint teaches: a placement, or one narrowing step of a route. */
  step?: Step;
  /** Cells the hint is about (wrong digits, impossible notes, or a revealed cell). */
  cells?: CellId[];
  /**
   * A hint that takes more than one step: each entry is a complete single-step hint, in order, and
   * the hint itself mirrors the first. The sheet walks them one at a time.
   */
  route?: SudokuHint[];
  /** The square a route leads to: the digit's cell, whether or not the route reaches it. */
  target?: CellId;
  /**
   * Steps before this one whose result the player's notes already show, in order: not taught, but
   * named in this step's Why and remembered with it when it's applied. They cost no hint.
   */
  folded?: Step[];
  /** What the "do" rung changes for non-step hints. */
  fix?: {
    clear?: CellId[];
    /** Digits to take out of a cell's notes (bitmask). */
    removeNotes?: { cell: CellId; mask: number }[];
    reveal?: { cell: CellId; digit: Digit }[];
  };
}

export interface HintInput {
  puzzle: Puzzle;
  /** Current digits, givens included. */
  grid: Grid;
  /** Player notes: per-cell digit bitmask, 0 = no notes. */
  notes: ArrayLike<number>;
  /** The puzzle's solution. */
  solution: Grid;
  /** Limit the techniques a hint may use (e.g. for tests). */
  logical?: LogicalOptions;
  /**
   * Candidates earlier hints have already ruled out (bitmask per cell). Kept by the game, not in
   * the player's notes, so a hint that only narrows things down isn't forgotten by the next one.
   */
  known?: ArrayLike<number>;
  /**
   * What the player sees pencilled (bitmask per cell): their own notes plus the auto-note layer.
   * Used only to spare teaching a step whose result is already there — never as a deduction.
   */
  visible?: ArrayLike<number>;
}

/** Where hints reason from: the board, minus what earlier hints have ruled out. */
function boardState(input: HintInput): ReturnType<typeof createState> {
  const s = createState(input.puzzle, input.grid);
  if (input.known)
    for (let c = 0; c < 81; c++) {
      const narrowed = s.cand[c]! & ~(input.known[c] ?? 0);
      if (narrowed) s.cand[c] = narrowed;
    }
  return s;
}

/**
 * What a note may hold: a digit not already in the cell's row, column, box or cage, and (killer) one
 * some combination of its cage's remaining sum uses. The notes check flags anything else.
 */
function legalCandidates(puzzle: Puzzle, grid: Grid): Uint16Array {
  const legal = basicCandidates(puzzle, grid);
  if (puzzle.cages.length) {
    const s = createState(puzzle, grid);
    for (const cage of puzzle.cages) {
      const allowed = cageView(s, cage).combos.reduce((m, x) => m | x, 0);
      for (const c of cage.cells) legal[c]! &= allowed;
    }
  }
  return legal;
}

/**
 * The candidates a hint pencils onto the board: what a note may hold, minus what earlier hints have
 * ruled out. So a hint's own pencils never trip the notes check.
 */
export function shownCandidates(puzzle: Puzzle, grid: Grid, known?: ArrayLike<number>): Uint16Array {
  const cand = legalCandidates(puzzle, grid);
  if (known)
    for (let c = 0; c < 81; c++) {
      const left = cand[c]! & ~(known[c] ?? 0);
      if (left) cand[c] = left;
    }
  return cand;
}

/**
 * The candidates a step hint marks, one role each: the step's marks, with its eliminations struck
 * (a struck candidate stays struck whatever else marks it). Their squares are the only ones the
 * hint pencils. "digit" marks are left out: they point out where else a digit can go, which is no
 * reason to pencil a square.
 */
export function hintMarks(hint: Pick<SudokuHint, "step">): CandidateMark[] {
  const out = new Map<number, CandidateMark>();
  const s = hint.step;
  if (!s) return [];
  const struck = s.eliminations.map((e): CandidateMark => ({ cell: e.cell, digit: e.digit, role: "elim" }));
  for (const m of [...(s.marks ?? []), ...struck]) {
    if (m.role === "digit") continue;
    const k = pair(m.cell, m.digit);
    if (out.get(k)?.role !== "elim") out.set(k, { cell: m.cell, digit: m.digit, role: m.role });
  }
  return [...out.values()];
}

const boxName = (c: CellId): string => houseName(houseAt(CELL_HOUSES[c]![2]));

function mistakeHint(input: HintInput, wrong: CellId[]): SudokuHint {
  const { grid, puzzle } = input;
  const first = wrong[0]!;
  const d = grid[first]!;
  const clash = PEERS[first]!.find((p) => grid[p] === d) ??
    puzzle.cages.find((c) => c.cells.includes(first))?.cells.find((p) => p !== first && grid[p] === d);
  const why: string[] = [];
  if (clash !== undefined)
    why.push(`${cellName(first)} is ${d}, but ${cellName(clash)} — in the ${relation(first, clash, puzzle)} — is also ${d}. A digit can't repeat there.`);
  else
    why.push(
      `${cellName(first)} = ${d} doesn't match the solution. Nothing on the board contradicts it yet, but the puzzle can't be completed around it.`,
    );
  if (wrong.length > 1) why.push(`In all, ${wrong.length} digits are wrong: ${cellList(wrong)}.`);
  return {
    kind: "mistake",
    title: wrong.length === 1 ? "A digit is wrong" : "Some digits are wrong",
    ladder: {
      where: `Something's off in ${boxName(first)}.`,
      what: wrong.length === 1 ? "One of your digits is wrong." : `${cap(String(wrong.length))} of your digits are wrong.`,
      why,
      do: `Clear ${cellList(wrong)}.`,
    },
    cells: wrong,
    fix: { clear: wrong },
  };
}

interface BadNote {
  cell: CellId;
  mask: number;
}

/**
 * Notes that are impossible, not just incomplete: the digit is already in the cell's row, column,
 * box or cage, or (killer) no combination of the cage's sum uses it.
 */
function impossibleNotes(input: HintInput): BadNote[] {
  const { puzzle, grid, notes } = input;
  const legal = legalCandidates(puzzle, grid);
  const out: BadNote[] = [];
  for (let c = 0; c < 81; c++) {
    const bad = grid[c] ? 0 : (notes[c] ?? 0) & ~legal[c]! & 0x3fe;
    if (bad) out.push({ cell: c, mask: bad });
  }
  return out;
}

/** Why `d` can't go in `cell`: a digit it sees, or its cage's sum. */
function whyImpossible(input: HintInput, cell: CellId, d: Digit): string {
  const { puzzle, grid } = input;
  const cage = puzzle.cages.find((x) => x.cells.includes(cell));
  const clash = PEERS[cell]!.find((q) => grid[q] === d) ?? cage?.cells.find((q) => q !== cell && grid[q] === d);
  if (clash !== undefined) return `${cellName(clash)} — in the ${relation(cell, clash, puzzle)} — is already ${d}`;
  if (cage) {
    const v = cageView(createState(puzzle, grid), cage);
    const ways = comboList(v.combos, "or");
    return v.placed.length
      ? `the rest of ${cageName(puzzle, cage.id)} has to make ${v.rem}: ${ways}, and none of those uses ${aDigit(d)}`
      : `${cageName(puzzle, cage.id)} can only be ${ways}, and none of those uses ${aDigit(d)}`;
  }
  return `${aDigit(d)} can't go there`;
}

function impossibleNotesHint(input: HintInput, bad: BadNote[]): SudokuHint {
  const first = bad[0]!;
  const d = digitsOf(first.mask)[0]! as Digit;
  const single = bad.length === 1 && popcount(first.mask) === 1;
  const others = bad.flatMap((b) => digitsOf(b.mask).map((x) => ({ cell: b.cell, d: x as Digit }))).slice(1);
  const why = [`${cellName(first.cell)} has ${aDigit(d)} pencilled in, but ${whyImpossible(input, first.cell, d)}.`];
  if (others.length)
    why.push(`Also: ${others.map((o) => `${o.d} in ${cellName(o.cell)} (${whyImpossible(input, o.cell, o.d)})`).join("; ")}.`);
  why.push("The rest of your notes are fine — notes are for what a cell might be, so they never have to be complete.");
  return {
    kind: "notes",
    title: single ? "A note can't be right" : "Some notes can't be right",
    ladder: {
      where: `Check your notes in ${boxName(first.cell)}.`,
      what: single ? "One of your notes can't be right." : "A few of your notes can't be right.",
      why,
      do: single
        ? `Remove ${d} from ${cellName(first.cell)}'s notes.`
        : `Remove ${bad.map((b) => `${digitsOf(b.mask).join(" and ")} from ${cellName(b.cell)}`).join("; ")} in your notes.`,
    },
    cells: bad.map((b) => b.cell),
    fix: { removeNotes: bad },
  };
}

// ------------------------------------------------------------------------------------------
// Looking ahead to the next placement

const ALL: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
/** Look ahead this far for placements to choose from. */
const LOOKAHEAD_PLACEMENTS = 12;
/** Techniques that can place a digit straight off the board — no narrowing first. */
const DIRECT = new Set(["full-house", "naked-single", "hidden-single", "cage-last-cell", "innies-outies"]);
const LOOKAHEAD_STEPS = 400;

/** Candidates are tracked as cell * 10 + digit. */
const pair = (c: CellId, d: number) => c * 10 + d;

/** Cells a step's reasoning covers: what it looks at, its pattern, its cages. */
function supportCells(step: Step, p: Puzzle): Set<CellId> {
  const out = new Set<CellId>([...step.focus.cells, ...(step.sources ?? []), ...step.placements.map((x) => x.cell)]);
  for (const h of step.focus.houses) for (const c of HOUSE_CELLS[houseIndex(h)]!) out.add(c);
  for (const id of step.focus.cages) for (const c of p.cages.find((x) => x.id === id)?.cells ?? []) out.add(c);
  for (const m of step.marks ?? []) out.add(m.cell);
  for (const vc of step.virtualCages ?? []) for (const c of vc.cells) out.add(c);
  return out;
}

/** Placements read off sums and placed digits rather than candidates. */
const ARITHMETIC = new Set(["full-house", "cage-last-cell", "innies-outies"]);

/** Steps that read only sums and placed digits: no candidates (but placed digits, see below). */
function arithmetic(step: Step, final: boolean): boolean {
  const ex = step.explain as { kind?: string; basis?: string };
  if (ex.kind === "cage-combos" && ex.basis === "sum") return true; // "a 3-cell 7 cage is 1+2+4"
  return final && !!ex.kind && ARITHMETIC.has(ex.kind);
}

/** The candidates a step's conclusion relies on being gone (or present). */
function reads(step: Step, p: Puzzle, final: boolean): number[] {
  const ex = step.explain as { kind?: string; cell?: CellId; digit?: unknown; house?: House; cage?: number };
  if (arithmetic(step, final)) return [];
  // Locked inside a cage: reads the cage's own cells (its valid combos, where the digit can go).
  if (ex.kind === "cage-locked")
    return (p.cages.find((c) => c.id === ex.cage)?.cells ?? []).flatMap((c) => ALL.map((d) => pair(c, d)));
  if (final) {
    if (ex.kind === "hidden-single" && ex.house)
      return HOUSE_CELLS[houseIndex(ex.house)]!.filter((c) => c !== ex.cell).map((c) => pair(c, ex.digit as number));
    if (ex.kind === "naked-single" && ex.cell !== undefined) return ALL.filter((d) => d !== ex.digit).map((d) => pair(ex.cell!, d));
  }
  const digits = typeof ex.digit === "number" ? [ex.digit] : ALL;
  return [...supportCells(step, p)].flatMap((c) => digits.map((d) => pair(c, d)));
}

/** The candidates a step takes away — a placement takes its digit from every cell it sees. */
function removes(step: Step, p: Puzzle): number[] {
  const out = step.eliminations.map((e) => pair(e.cell, e.digit));
  for (const pl of step.placements) {
    for (const d of ALL) if (d !== pl.digit) out.push(pair(pl.cell, d));
    for (const q of PEERS[pl.cell]!) out.push(pair(q, pl.digit));
    for (const q of p.cages.find((c) => c.cells.includes(pl.cell))?.cells ?? []) if (q !== pl.cell) out.push(pair(q, pl.digit));
  }
  return out;
}

/**
 * The earlier steps the placement at `i` actually depends on, in order — or null if it depends on
 * an earlier placement (then it isn't the next digit to find).
 */
function dependencies(steps: readonly Step[], i: number, p: Puzzle): Step[] | null {
  // Arithmetic steps read placed digits: if the look-ahead itself filled any cell one adds up,
  // that step isn't something the board shows yet.
  const placedBefore = (k: number, step: Step) => {
    const cells = supportCells(step, p);
    return steps.slice(0, k).some((s) => s.placements.some((pl) => cells.has(pl.cell)));
  };
  const final = steps[i]!;
  if (arithmetic(final, true) && placedBefore(i, final)) return null;
  const need = new Set(reads(final, p, true));
  const kept: Step[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const s = steps[j]!;
    if (!removes(s, p).some((x) => need.has(x))) continue;
    if (s.placements.length || (arithmetic(s, false) && placedBefore(j, s))) return null;
    kept.unshift(s);
    for (const x of reads(s, p, false)) need.add(x);
  }
  return kept;
}

/** Whether `t` may run for this puzzle under these options (as the logical solver decides). */
function usable(t: Technique, kind: string, o: LogicalOptions = {}): boolean {
  if (o.techniques && !o.techniques.includes(t)) return false;
  if (t.killerOnly && kind !== "killer") return false;
  if (t.classicOnly && kind !== "classic") return false;
  if (o.maxTier !== undefined && t.tier > o.maxTier) return false;
  return !(o.noUniqueness && t.assumesUnique);
}

/** The digit that's quickest to know from the board: its placing step and the steps it needs. */
function nextPlacement(input: HintInput): { step: Step; prior: Step[] } | null {
  // A digit you can place straight off the board needs no narrowing at all — even a 45-rule sum
  // the step-by-step solver would only reach after lots of cheaper eliminations.
  const s0 = boardState(input);
  for (const t of TECHNIQUES) {
    if (!DIRECT.has(t.id) || !usable(t, s0.kind, input.logical)) continue;
    const step = t.find(s0);
    if (step?.placements.length) return { step, prior: [] };
  }
  const s = boardState(input);
  const steps: Step[] = [];
  let found = 0;
  for (let k = 0; k < LOOKAHEAD_STEPS && found < LOOKAHEAD_PLACEMENTS; k++) {
    const step = nextStep(s, input.logical);
    if (!step) break;
    steps.push(step);
    applyStep(s, step);
    if (step.placements.length) found++;
    if (isBroken(s)) break;
  }
  let best: { step: Step; prior: Step[] } | null = null;
  steps.forEach((step, i) => {
    if (!step.placements.length) return;
    const prior = dependencies(steps, i, input.puzzle);
    if (prior && (!best || prior.length < best.prior.length)) best = { step, prior };
  });
  return best;
}

/** The most narrowing steps one hint walks through; longer routes are taught in rounds this size. */
const MAX_CHAIN = 3;

/**
 * What a step leaves, as facts: "r4c3, r4c4 and r4c5 can only be 1, 2 or 4; r9c1 can't be 7" —
 * whichever reads shorter per cell. `before` is the candidates just before the step.
 */
function narrowed(eliminations: readonly { cell: CellId; digit: number }[], before: ArrayLike<number>): string {
  const removed = new Map<CellId, number>();
  for (const e of eliminations) removed.set(e.cell, (removed.get(e.cell) ?? 0) | (1 << e.digit));
  const groups = new Map<string, CellId[]>();
  for (const [c, gone] of [...removed].sort((a, b) => a[0] - b[0])) {
    const left = (before[c] ?? 0) & ~gone;
    const key = left && popcount(left) <= popcount(gone) ? `only:${left}` : `not:${gone}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups]
    .map(([key, cells]) => {
      const [kind, mask] = key.split(":");
      return `${cellList(cells)} ${kind === "only" ? "can only be" : "can't be"} ${maskList(Number(mask), "or")}`;
    })
    .join("; ");
}

/** Walk steps from `start`, giving each one's "So …" facts. */
function walk(start: SolverState, steps: readonly Step[]): string[] {
  const s = cloneState(start);
  return steps.map((step) => {
    const text = narrowed(step.eliminations, Uint16Array.from(s.cand));
    applyStep(s, step);
    return text;
  });
}

/** How notes would have made a chained hint visible at a glance. */
function notesNudge(step: Step): string {
  const ex = step.explain as { kind?: string; cell?: CellId; digit?: number; house?: House };
  if (ex.kind === "hidden-single" && ex.house)
    return `Notes make this easy to see: with the options pencilled in and those crossed out, ${aDigit(ex.digit!)} has just one place left in ${houseName(ex.house)}.`;
  if (ex.kind === "naked-single" && ex.cell !== undefined)
    return `Notes make this easy to see: with ${cellName(ex.cell)}'s options pencilled in and those crossed out, only ${ex.digit} is left.`;
  return "Notes make chains like this easy to follow: pencil in what each cell can be and cross out as you go.";
}

/**
 * Whether the player's visible notes already reflect a step: in every square it narrows they show
 * something, and none of the digits it strikes. Presentation only — the step is still the engine's
 * own deduction.
 */
function alreadyShown(step: Step, visible?: ArrayLike<number>): boolean {
  if (!visible || !step.eliminations.length) return false;
  return step.eliminations.every((e) => {
    const v = visible[e.cell] ?? 0;
    return v !== 0 && !(v & bit(e.digit));
  });
}

/** A hint for one step. */
function stepHint(step: Step, ladder: LadderText, folded: readonly Step[] = []): SudokuHint {
  return {
    kind: "step",
    title: techniqueName(step.technique),
    technique: step.technique,
    tier: step.tier,
    ladder,
    step,
    cells: step.focus.cells,
    ...(folded.length ? { folded: [...folded] } : {}),
  };
}

/** The most folded steps a Why names; the rest are counted. */
const MAX_NOTED = 2;

/**
 * "Your notes already show …": what the steps folded into `step` (indexes into `chain`) leave.
 * Notes far ahead of the hints can fold dozens, so it names at most two — the last of those
 * `step` reads from, or the last folded if it reads from none — and counts the rest.
 */
function notedLine(chain: readonly Step[], facts: readonly string[], folded: readonly number[], step: Step, p: Puzzle): string {
  const need = new Set(reads(step, p, !!step.placements.length));
  const direct = folded.filter((k) => removes(chain[k]!, p).some((x) => need.has(x)));
  const named = (direct.length ? direct : folded).slice(-MAX_NOTED);
  const more = folded.length - named.length;
  const rest = more ? `, and ${numberWord(more)} more ${plural(more, "step", "steps")} before this one` : "";
  return `Your notes already show ${named.map((k) => facts[k]).join("; ")}${rest}.`;
}

/**
 * The hint for the digit `step` places, given the narrowing steps it needs first. Steps the
 * player's notes already show aren't taught: each is folded into the next step taught, whose Why
 * opens with what the notes show. The rest are a route: those steps, then the digit when no more
 * than `MAX_CHAIN` stand before it, or else the first `MAX_CHAIN` of them, so folded steps never
 * use up a round. Each entry is a complete hint of its own — the sheet walks them one at a time —
 * and the hint itself mirrors the first, so anything that reads one step sees where the route
 * starts. With nothing left to teach before the digit, it's a hint of its own.
 */
function placementHint(input: HintInput, step: Step, prior: readonly Step[]): SudokuHint {
  const chain = [...prior, step];
  const facts = walk(boardState(input), chain);
  const shown = prior.map((s) => alreadyShown(s, input.visible));
  const reach = shown.filter((x) => !x).length <= MAX_CHAIN;
  const entries: SudokuHint[] = [];
  let folded: number[] = [];
  for (let i = 0; i < chain.length; i++) {
    if (shown[i]) {
      folded.push(i);
      continue;
    }
    if (!reach && entries.length === MAX_CHAIN) break;
    const s = chain[i]!;
    const t = templateFor(s.technique)(s, { puzzle: input.puzzle });
    const noted = folded.length ? [notedLine(chain, facts, folded, s, input.puzzle)] : [];
    const premise = folded.map((k) => chain[k]!);
    folded = [];
    if (!s.placements.length) {
      const where = entries.length ? t.where : `No digit is certain yet. ${t.where}`;
      entries.push(stepHint(s, { where, what: t.what, why: [...noted, ...t.why, `So ${facts[i]}.`], do: `Note it down: ${facts[i]}.` }, premise));
    } else if (entries.length) {
      // The singles say "ruled out by earlier deductions": here those are the steps before.
      const why = t.why.map((w) => w.replaceAll("by earlier deductions", "by the steps before"));
      entries.push(stepHint(s, { ...t, why: [...noted, ...why, notesNudge(s)] }, premise));
    } else entries.push(stepHint(s, { ...t, why: [...noted, ...t.why] }, premise));
  }
  if (entries.length === 1 && entries[0]!.step === step) return entries[0]!;
  return { ...entries[0]!, route: entries, target: step.placements[0]!.cell };
}

function stuckHint(input: HintInput): SudokuHint {
  const cand = basicCandidates(input.puzzle, input.grid);
  let best = -1;
  for (let c = 0; c < 81; c++) {
    if (input.grid[c]) continue;
    if (best === -1 || popcount(cand[c]!) < popcount(cand[best]!)) best = c;
  }
  const digit = input.solution[best]!;
  return {
    kind: "stuck",
    title: "No logical step found",
    ladder: {
      where: "I can't find a step with the techniques I know.",
      what: "This position needs a technique beyond the hint engine's set.",
      why: [
        "Every hint must be a deduction you could make yourself, and none of the known techniques applies here.",
        `I can reveal one cell to get you moving — ${cellName(best)}, which has the fewest options.`,
      ],
      do: `Reveal ${cellName(best)}.`,
    },
    cells: [best],
    fix: { reveal: [{ cell: best, digit }] },
  };
}

export function sudokuHint(input: HintInput): SudokuHint {
  const { grid, solution } = input;

  let filled = true;
  const wrong: CellId[] = [];
  for (let c = 0; c < 81; c++) {
    if (!grid[c]) filled = false;
    else if (grid[c] !== solution[c]) wrong.push(c);
  }
  if (wrong.length) return mistakeHint(input, wrong);
  if (filled)
    return { kind: "solved", title: "Solved!", ladder: { where: "", what: "The puzzle is complete.", why: [], do: "" } };

  const bad = impossibleNotes(input);
  if (bad.length) return impossibleNotesHint(input, bad);

  const next = nextPlacement(input);
  if (!next) return stuckHint(input);
  return placementHint(input, next.step, next.prior);
}

/** One-line description of a step (for logs, the solve-path view, and tests). */
export function stepSummary(step: Step, puzzle: Puzzle): string {
  const t = templateFor(step.technique)(step, { puzzle });
  return `${techniqueName(step.technique)}: ${t.do}`;
}

