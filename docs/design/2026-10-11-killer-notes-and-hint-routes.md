# Auto-note layer and hint routes

*Design, 2026-10-11. Decided in a brainstorm with Shawn; this file is the why. Build from it.*

## Problem

Two complaints about killer, which turn out to be one.

**Hints re-teach what the notes already show.** Hints reason from the board and never from the
player's notes (notes may be loose or wrong, by design). So on a hard or expert killer with
auto-notes filled in, the first hint spends its whole "round" on cage sums the player can already
see. Measured on `killer-expert-2` with auto-notes in:

```
WHAT: This cage's sum can only be made one way. Three steps on the way to r5c6.
WHY:  First, look at the 23 cage at r2c4: … 6+8+9 … So r2c4, r2c5 and r3c5 can only be 6, 8 or 9.
      Then, look at the 22 cage at r1c4: … 1+2+3+4+5+7 … So r1c4 … r3c6 can't be 6, 8 or 9.
      Then, look at the 4 cage at r6c6: … 1+3 … So r6c6 and r6c7 can only be 1 or 3.
DO:   Pencil it in: r1c4, r1c5, r1c6, r1c7, r2c6 and r3c6 can't be 6, 8 or 9; r2c4, r2c5 and
      r3c5 can only be 6, 8 or 9; r6c6 and r6c7 can only be 1 or 3.
```

All three steps are already in the notes. The real work toward r5c6 (cage pointing, cage claim,
the 45 rule) never appears. Across the packs, treating the auto-note candidates as already known
makes rounds go straight to that work; the share of first hints that are direct placements does
not change.

**A round is a wall.** Three full paragraphs plus a three-clause "Do" line, read at once, with no
way to tell which part is new. "Three steps on the way to r5c6" does not say what will happen.

**Auto notes write everywhere.** The toolbar's Auto notes writes candidates into every empty
cell's notes as one undo step. Players asked for a toggle: a secondary layer that their own notes
sit on top of, and that goes away when tapped again.

## Decisions

Made with Shawn, in order:

1. **Auto-notes become a computed layer**, shown dim under the player's bright notes in the same
   cell. Tapping a dim digit strikes it (a per-cell hidden mask). Alternatives rejected: adopting
   the layer into the player's notes on first edit (loses the distinction), and the player's notes
   replacing the layer per cell (removing one auto digit took several taps).
2. **When the layer is on, hints treat it as known.** Sound: the layer is computed from the rules,
   not from the player. Alternative rejected: only condensing the text while still spending the
   round's steps on sum deductions.
3. **Multi-step hints become a stepper in the sheet** ("Step 1 of 3 · toward r5c6"), one step's
   Why and Do at a time, Apply advancing to the next. Alternatives rejected: one step per hint
   (more taps on expert openings, and the route's goal is lost between hints), and keeping three
   steps as a checklist (still three paragraphs).
4. **Hand-written notes are credited.** A route step whose result the player's visible notes
   already show is collapsed to one line and costs no hint.
5. **Hints used counts one per applied step.** A three-step route costs three where it cost one.
   Honest about help taken; rounds are 4% of easy killer hints and about 20% of expert.

Routine calls made here, open to objection: the layer toggle is a *setting* (persists across
levels), not per-game state; the "Fill notes" menu item is removed; after a step is applied the
next one opens at rung 2 (What).

## Piece 1 — the auto-note layer

### State

- `Settings.autoNotes: boolean`, default `false`. Toggled by the toolbar button and the **A** key;
  also a row in the settings sheet under Sudoku: "Show auto-notes · Dim digits the rules still
  allow." Reaches the game as `SudokuSettings.autoNotes`, like `autoClearNotes`.
- `SudokuGame.hidden: Uint16Array(81)` — auto digits the player struck out. Saved as
  `SavedSudoku.hidden?: number[]` (optional; old saves load with none). `Change` gains an optional
  `hidden: [before, after]` so a strike is one undo step and undo/redo restore it.

The layer itself is never stored.

### What a cell shows

For an empty cell `c`:

```
layer(c) = settings.autoNotes
         ? candidatesNow()[c] & ~known[c] & ~hidden[c] & ~notes[c]
         : 0
```

`candidatesNow()` is `comboCandidates` in killer (cage sums applied, iterated) and
`basicCandidates` in classic. If `candidatesNow()[c] & ~known[c]` would be empty, `known` is not
subtracted for that cell (the same guard `shownCandidates` uses: it only happens with a wrong digit
on the board). `notes[c]` is the player's own notes, bright, as today. Placing a digit narrows the
layer by itself; auto-clear still prunes the player's notes as today; `hidden` bits are left alone
(a struck digit that leaves the layer is moot, and comes back struck if the digit is erased).

### Tapping a digit in notes mode

What you see is what you toggle. For digit `d` in cell `c`:

| `d` is…                                  | Tap does                                   |
|------------------------------------------|--------------------------------------------|
| in `notes[c]` (bright)                   | remove it from `notes[c]`                  |
| shown dim (in `layer(c)`)                | add it to `hidden[c]` — it disappears      |
| in `hidden[c]` and still allowed         | remove it from `hidden[c]` — back, dim     |
| not shown at all                         | add it to `notes[c]` — bright              |

A dim digit cannot be promoted to bright by tapping; it carries no extra information. Drag-pencil
across several cells (`toggleNoteMany`) applies the same rule per cell with one direction for the
group: if `d` is visible (bright or dim) in every empty cell, hide or remove it everywhere;
otherwise make it visible wherever it is missing (unstrike if hidden, else add to notes). The radial
wheel goes through the single-cell rule.

Erase on a cell resets its digit, notes and strikes. "Clear notes" resets notes and strikes
everywhere. "Fill notes" (write the layer into the player's notes) is removed from the menu, with
`SudokuGame.autoNotes()`. Toggling the layer off hides the dim digits only; notes and strikes
stay, so toggling it back restores the view.

### Rendering

- `BoardView.auto: Uint16Array` — the dim digits per cell. The board adds class `auto` to those
  `<i>`s (`.notes i.auto`: about 0.45 opacity, a cooler grey than the player's `#9ca8d4`, so they
  read as the machine's). `.match` applies to dim digits too. The `aria-label` lists them
  separately: "r3c4, empty, notes 1 2, auto 5 8".
- During a hint: from rung 3 on, dim digits step aside with the rest (`h-quiet` hides the whole
  `.notes` div, unchanged). `drawMarks` treats `auto` like `on`: a digit the hint pencils that is
  already dim gets no `ghost` class; role marks (`m-*`) override as today.
- Toolbar: the Auto notes button shows pressed state (`on` class, `aria-pressed`), like Notes.
  First time it is turned on, a toast: "Dim digits are what the rules still allow. Tap one in notes
  mode to strike it; your own notes stay bright."

## Piece 2 — hints

### The layer counts as known

`SudokuGame.hint()` and `hintCandidates()` pass an *effective* known:

```
effectiveKnown[c] = known[c] | (settings.autoNotes ? basicCandidates[c] & ~candidatesNow()[c] : 0)
```

Nothing is persisted: `known` keeps holding only what hints proved, so turning the layer off later
leaves hints consistent with what the player sees. `hidden` and the player's notes are never fed to
the engine as deductions. A struck digit that is actually the answer is not a mistake, exactly as a
note that leaves out the answer is not; the placing hint will simply name it.

Applying a step into a square that has none of the player's notes writes nothing while the layer is
on: the layer narrows because `known` grew. Squares with the player's notes intersect, as today.
With the layer off, today's behaviour stands (a note-less square gets what the hint drew, less what
it struck).

### Routes

Any hint that needs more than one step is a **route**: the narrowing steps, then the placement when
it is within reach. This replaces both today's chain (up to three narrowing paragraphs then the
digit) and round (three narrowing steps, digit further off). The cap is unchanged: when more than
`MAX_CHAIN` (3) narrowing steps are needed, the route is the first three and no placement; the next
Hint continues from `known`.

```ts
// engine/hints/index.ts
export interface SudokuHint extends HintCommon {
  step?: Step;
  cells?: CellId[];
  fix?: { … };                 // unchanged
  /** A multi-step hint: each entry is a complete single-step hint. The hint itself mirrors route[0]. */
  route?: SudokuHint[];
  /** The square the route leads to (the placement's cell, whether or not it is in this route). */
  target?: CellId;
  /** The step's result is already in the player's notes: shown collapsed, costs no hint. */
  already?: boolean;
}
export interface HintInput {
  …;                           // puzzle, grid, notes, solution, logical, known — unchanged
  /** What the player sees: own notes plus the layer (dim digits). Used only to credit steps. */
  visible?: ArrayLike<number>;
}
```

`prior` is removed, and so is `LadderText.steps`. `hintMarks(hint)` takes one step. The
top-level fields of a route hint mirror `route[0]`, so single-step consumers (Learn examples,
`stepSummary`, the board) do not change.

Each entry's ladder comes from its technique's template, with:

- **Step 1, rung 1 (Where):** "No digit is certain yet. Look at the 23 cage at r2c4." (the
  framing sentence only on the first step; later steps use the template's `where`).
- **Rung 2 (What):** the template's `what`, unchanged.
- **Rung 3 (Why), narrowing steps:** the template's `why` paragraphs plus the step's fact from
  `narrowed()`: "So r2c4, r2c5 and r3c5 can only be 6, 8 or 9."
- **Rung 4 (Do), narrowing steps:** "Note it down: r2c4, r2c5 and r3c5 can only be 6, 8 or 9."
  (one wording whether the layer or the player's notes take it).
- **The placing step:** the template's text, with "by earlier deductions" replaced by "by the
  steps before", then the notes nudge, as today.

`steppingStone`, `chainLadder` and `narrowingParagraphs` go; `walk()` stays to produce the facts.

### Credit for hand-written notes

A route step is `already` when, for every candidate it eliminates, the player's visible notes in
that cell are non-empty and do not contain the digit:

```
already(step) = step.eliminations.every(e => visible[e.cell] !== 0 && !(visible[e.cell] & bit(e.digit)))
visible[c]    = notes[c] | layer(c)          // computed by the game
```

With the layer on, steps the layer derives never appear at all (they are in `known`), so credit
only matters for steps the player worked out by hand or struck. An `already` step's ladder is:
where = the template's `where`; what = "Already in your notes."; why = the one fact
("Your notes already show r2c4, r2c5 and r3c5 can only be 6, 8 or 9."); do = "Nothing to add."
Its eliminations are still the engine's own sound deductions, so applying it records them in
`known` exactly like any step; it adds nothing to `hintsUsed`.

### The sheet as a stepper

`HintSheet.open(hint, opts?)` with `opts = { step: i, of: n, target: CellId, startRung: 1 | 2 | 3 }`.

- A pill in the header reads "Step 1 of 3 · toward r5c6" (`already` steps: "Step 1 of 3 · already
  in your notes"). Title and tier badge are the current step's.
- The player climbs rungs as today (H / Enter / taps). Apply applies **this step only**
  (`game.applyHint(route[i])`): `known` grows, the player's notes intersect, the layer narrows,
  sparks fly where it struck (existing code). Then the play screen sets `this.hint = route[i+1]`
  and reopens the sheet at `startRung: 2` (`already` steps open at 3).
- After the last step the sheet closes. If that step placed a digit, nothing more; otherwise a
  toast: "Route marked. Hint again for r5c6."
- Closing mid-route drops the rest. The next Hint recomputes from the board and `known`, so it
  resumes where the player left off.
- The board shows only the current step's marks. Earlier steps are already visible as struck from
  the layer or gone from the player's notes.
- `hintsUsed` increments once per applied step (not for `already` steps). `recordRung` runs per
  step as today.

## Removed

`SudokuGame.autoNotes()`, the "Fill notes" menu item, `SudokuHint.prior`, `LadderText.steps`,
`steppingStone`, `chainLadder`, `narrowingParagraphs`, the "X steps on the way to" and "Pencil it
in:" wording.

## Tests

**Game (`tests/game/sudoku-game.test.ts`)**
- `layer()` is empty with the setting off; with it on equals `comboCandidates` minus `known`,
  `hidden` and `notes`, and recomputes after a placement.
- The four tap rules, each one undo step; `toggleNoteMany` group direction with a mix of bright,
  dim, struck and absent cells.
- Erase resets strikes; "Clear notes" resets strikes; save and restore round-trip `hidden`.
- `hint()` receives effective known with the layer on; `hintCandidates()` matches.
- Applying a narrowing step with the layer on writes no notes into note-less squares and the layer
  shows the struck digits gone; with the layer off, today's pencilling (existing test, kept).
- Applying an `already` step records `known` and leaves `hintsUsed` unchanged.

**Engine (`tests/engine/hints.test.ts`)**
- A multi-step hint has `route`, `target`, and mirrors `route[0]`; each entry has its own ladder
  and `step`; narrowing entries' `why` end with a "So …" fact and `do` starts "Note it down".
- The cap: more than three narrowing steps gives a three-entry route with no placement.
- On every expert pack puzzle whose first hint is a route, with `known = basic & ~combo`, no route
  entry is a `cage-combos` step with `basis: "sum"`.
- Credit: with `visible` reflecting the first step's result, `route[0].already` is true and
  `route[1].already` is false; `visible` empty credits nothing.
- The existing play-out statistics (`playOut`) read `route` instead of `prior`; thresholds kept.

**End to end (`tests/e2e/app.spec.ts`)**
- Killer: Auto notes on shows `.notes i.auto`; tapping one in notes mode removes it; a bright note
  stays bright; Auto notes off hides the dim digits; the setting persists to the next level.
- A route hint shows "Step 1 of N" in the header; Apply advances to "Step 2 of N" at rung 2; Hints
  used rises by one per step. (Replaces the current round assertions around `app.spec.ts:471`.)

## Docs

- `docs/SPEC.md` §2: auto-notes paragraph → the layer (dim digits, striking, A key); keyboard list
  gains A. §3: chains and rounds → routes and the stepper, credit, hint counting.
- `docs/ARCHITECTURE.md`: the Hints paragraph (route, `visible`, effective known, `hidden`).
- `docs/MILESTONES.md`: M8's hints paragraph.

## Build order

1. Layer: settings row and toolbar toggle, `hidden`, tap rules, rendering, tests, e2e.
2. Layer as known: `effectiveKnown`, apply-step behaviour with the layer on, tests.
3. Route engine: `route`/`target`/`already`, remove `prior`/`steps`, template framing, tests.
4. Sheet stepper and play-screen wiring, hint counting, e2e; docs.

Each step leaves `npm run check` green; 1 and 4 also `npm run test:e2e`.
