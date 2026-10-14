# Nonet — Product Spec

Puzzles that teach instead of tell. Three puzzle types, one coach: hints climb a ladder from
"look here" to "here's the answer", every hint is a human-style deduction with its reasoning drawn
on the board, and the whole thing feels like Tetris Effect — calm, luminous, and punctuated by
light and sound when things click.

Target: installable PWA, Android-first (phone portrait), works offline. Desktop browser works too
(keyboard supported).

---

## 1. Modes

### Classic sudoku
9×9, givens, rows/cols/boxes contain 1–9 once.

### Killer sudoku
Cages with sum clues, normally no givens. Rows/cols/boxes contain 1–9 once; cage cells sum to the
clue; **no repeated digit inside a cage**.

### Queens (colour regions)
N×N board (6–10) split into N coloured regions. Place N queens: exactly one per row, column and
region; no two queens touch, not even diagonally (they *may* share a long diagonal — this is the
LinkedIn "Queens" puzzle, not classic 8-queens).

### Difficulty
Easy / Medium / Hard / Expert per mode, graded by the hardest technique the logical solver needs
(see §4). Queens board size grows with difficulty (Easy 6–7, Medium 8, Hard 9, Expert 9–10).

---

## 2. Core play

- Sudoku: tap cell → tap digit. Notes mode toggle; **hold a digit on the pad = light that digit up
  across the grid** (places nothing; only a tap places). Erase, undo/redo (unlimited). Drag across cells — or Shift / Ctrl / ⌘-click — to
  select several; a digit then pencils into all of them (or comes out of all, if all have it),
  and Erase wipes them all (digits and notes), each as one undo step. A cell acts on release, not
  on press: pressing the selected cell to start a drag never pencils anything, while a plain tap
  on it repeats the last digit. **Hold an empty square** (a deliberate ~1.5 s press, one knob in
  `sudoku-board.ts`) and a wheel of digit dots floats around it; flick toward one and let go to
  enter it — as an answer or a note, following the mode — or release near the centre to cancel.
- **Auto notes** is a layer, not a fill: dim digits under your own notes, showing what the rules
  still allow in every empty square (cage sums applied in killer), recomputed as you play. What
  you see is what you toggle: in notes mode, tap a dim digit to strike it, tap a struck digit to
  bring it back, and a digit the layer doesn't show goes in as your own bright note. Your notes
  take precedence in a square; Erase clears its strikes too. The layer is a setting (toolbar
  button or **A**), so it follows you to the next level, and strikes are saved with the game.
- Placing a digit auto-removes it from notes in the same row/col/box/**cage**, and (killer) takes
  out of the cage's other notes any digit its remaining sum no longer allows (setting).
- Highlights: selected cell, its peers, its cage, every cell with the same digit, matching notes.
- Digit pad shows how many of each digit remain; finished digits dim.
- Killer: a cage bar lists the selected cage's combinations, striking out ones that clash with
  digits already placed in a house the cage lives in (setting). Its **Σ45 lens** works the 45 rule
  for the selected cell's row, column or box: it writes the equation and rings the innies or
  outies on the board (the calculator's Region mode). Select cells across two or more cages and
  the bar adds those cages up instead — "54 = 11 + 12 + 12 + 19 in 11 cells", each cage once
  (or what its open cells have left, once digits are in) — and lights their outlines.
- Queens: tap puts an ✕ on or takes it off; double-tap (second tap within ~⅓ s) makes a queen, as
  one undo step; hold clears a cell; drag paints ✕s (or erases them, if the drag starts on an ✕),
  one undo step per drag. A single tap never removes a queen (it nudges "hold to clear"), so a
  stray tap can't cost you your place. Auto-✕ (setting) shows cells ruled out by placed queens
  without storing them.
- Queens **Scratch** (tool, or S): a what-if layer. Turning it on snapshots the board; queens and
  ✕s placed after that are drawn pencilled (dashed, hatched) and count for nothing: no mistakes,
  no right/wrong feedback (that would give the answer away), no completion. Rule clashes and
  auto-✕ still show, which is the point of trying a queen. Undo stops at the snapshot; hints and
  saves read the real board. **Wipe** (or switching the tool off) restores the snapshot exactly;
  **Keep** makes the scratch real as one undo step, checked like any other move.
- Keyboard (sudoku / killer): 1–9 place, Shift+digit pencils (read from the physical key, so it
  works on any layout); while Shift is held the screen shows notes mode and a numpad tap pencils
  too; Space or N toggles Notes; arrows move (wrapping), Shift+arrow — like
  Shift / Ctrl / ⌘-click — adds cells to the selection; Backspace / Delete / 0 erase the
  selection; H opens the hint or shows the next rung, Enter does what the sheet's main button
  does (next rung, or apply); A toggles Auto notes; L cycles the Σ45 lens (killer); Esc steps back one layer (game menu
  → hint → lens → several cells → the selection); Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo.
  Queens: H, Enter, Esc, S (Scratch on / off), Ctrl/⌘+Z / Y. Bare-key shortcuts ignore
  Ctrl/⌘/Alt (those combinations stay the browser's: tabs, history, save) and held-key repeats
  (except arrows and erase). A solved puzzle can't be undone. Clicking a control doesn't leave
  focus on it, so Space / Enter never re-press it.
- Games autosave per mode; "Continue" on the home screen resumes.

### Mistakes that teach
With instant checking on (default), a wrong digit is flagged and explained when a rule makes it
provably wrong right now:
- "Row 6 already has a 5." / "Column 2 …" / "The top-left box …"
- "That cage already has a 7."
- "This 3-cell cage sums to 6, so it can only be 1+2+3 — no 9."
Otherwise: "That doesn't match the solution. Hint can show you why."
Queens: rule clashes are explained ("Queens can't touch — not even diagonally."); a queen off the
solution is flagged with a pointer to the hint.

---

## 3. Hint ladder

Every hint gets you to the next **digit you can know** from the player's current board. Hints
reason from the board itself, never from the player's notes: notes record what a cell *might* be
(many players pencil loosely), so a note that merely leaves out the answer is not a mistake.

The solver looks ahead a few placements and picks the one that needs the fewest narrowing steps
first; candidates a step relies on are traced back, digit by digit, so unrelated steps drop out.
It first checks the board for digits that need nothing at all (a single, a cage's last cell, a
45-rule sum — even ones the step-by-step solver would only reach late). Over whole solves:
~72–86% of killer hints and ~92% of classic ones place a digit outright. "Do" places the digit;
nothing is written into the player's notes.

A digit that needs narrowing first is taught as a **route**: up to three narrowing steps, then
the digit, one step at a time. A pill in the sheet's header says where you are ("Step 1 of 3 ·
toward r5c6"); each step has its own Where ("No digit is certain yet. Look at the 7 cage at
r4c3."), What, Why (ending "So r4c3, r4c4 and r4c5 can only be 1, 2 or 4.") and Do ("Note it
down: …"), Apply takes just that step and opens the next at What, and every step applied counts
as one hint. The digit's step ends with a nudge that notes would have shown it at a glance. When
the digit is further off (the hard openings of tough killers), the route is the first three
steps toward it, and the last Apply says "Route marked. Hint again for r5c6." Closing the sheet
mid-route drops the rest; the next Hint carries on from the board. Applying a narrowing step
pencils in what it leaves, in the squares it marks and nowhere else: notes there keep the digits
still possible, and a square without notes gets what the hint drew, less what it struck — unless
the auto-note layer is on, which narrows by itself. The game remembers what hints have ruled out
(saved with the game), so the next hint picks up from there — and every later hint is shorter
for it.

With the **auto-note layer** on, hints take what it shows as known: the layer comes from the
rules, not from you, so no route spends a step on a cage sum you can already see. A step whose
result your own notes already show is credited instead of re-taught: "Step 1 of 3 · already in
your notes", a one-line Why, "Got it", and it costs no hint.

Before any step, the hint checks, in order:
1. **Wrong digits / queens** → "Something's off in the top-left box." … "Clear r3c4."
2. **Impossible notes** — a pencilled digit already in the cell's row, column, box or cage, or
   (killer) one no combination of the cage's sum uses → "r1c3 has a 5 pencilled in, but r1c1 — in
   the same row — is already 5." … "Remove 5 from r1c3's notes." Only those digits come out; the
   rest of the player's notes are left alone. (Queens: ✕ on a queen's cell, as before.)
3. **The next digit** (above).
4. If nothing applies (shouldn't happen with the packs): offer to reveal one cell.

| Rung | Shows | Board |
|---|---|---|
| 1 Where | which area to look at, no technique named | area tinted, rest dimmed |
| 2 What | technique name + one-line nudge, tier badge | pattern cells outlined, cages lit |
| 3 Why | full reasoning with cells, digits and arithmetic | pencils in only the squares the step marks (never "every other 9"): candidates coloured by role, every step's eliminations struck through; notes in squares the hint doesn't use step aside until it closes; sight lines from justifying digits, chain arrows, dashed virtual cages, the cages involved lit |
| 4 Do | places the digit, or (a narrowing step) pencils in what it leaves | normal feedback |

Hint text is generated from structured `Step.explain` data via per-technique templates (no LLM,
no prose in techniques). "Learn" on the sheet opens that technique's guide.

**Named squares.** Every `r{row}c{col}` in the visible rungs is drawn as a chip in an accent
colour, and the board rings that square in the same colour (from rung 1 on). Colours go by first
mention; squares listed together ("r1c9, r2c9 and r3c9", "r1c1 or r1c7") share one, and a square
keeps its colour wherever it comes up again. No red or green — those mean eliminate and place.
In Queens a name takes the colour of the square's region (hints name regions by colour). Tapping
a name pulses its ring. Learn examples and the Σ45 lens equation colour names the same way.
While the sheet is open the board is pinned above it, so every row stays visible, and faint row
and column numbers appear around it; the row and column of each named square light up in that
square's colour. A tap on the board then only closes the sheet: it never selects, places or
marks anything (all three modes).

### Technique coverage
- **Sudoku (classic + killer):** full house, hidden/naked singles, pointing, box/line reduction,
  naked/hidden pairs–quads, X-Wing, Swordfish, Jellyfish, finned fish, Skyscraper, 2-String Kite,
  Empty Rectangle, XY-Wing, XYZ-Wing, W-Wing, Simple Colouring, Unique Rectangle, BUG+1 (classic
  only), X-Chain, XY-Chain, AIC.
- **Killer:** cage remainder, cage combinations (by sum; against candidates), cage pointing, cage
  claim, 45 rule (innies & outies over 1–4 houses, with virtual cages).
- **Queens:** last cell, region-in-line, line-in-region, touch (blocking), k-confinement,
  contradiction (short forcing chain).

---

## 4. Puzzles

- Generated offline into JSON packs (`npm run gen`), shipped with the app; deterministic per seed.
- Every pack puzzle is **solvable start to finish by the hint engine's techniques**, so a hint is
  always available.
- Grading: hardest tier needed. Classic: tier 1 easy (singles), 2 medium, 3 hard, 4–5 expert.
  Killer: ≤ tier 2 easy, single-house 45s medium, multi-house 45s / tier-3 techniques hard,
  tier 4–5 expert. Queens: tier 1–2 easy … tier 5 (contradiction) expert.
- Next puzzle = first unsolved in pack order; packs cycle when exhausted.

---

## 5. Feel (Tetris Effect direction)

- Each mode is a "stage" with its own palette: Classic *Abyss* (cyan/azure/violet), Killer *Ember*
  (magenta/orange/gold), Queens *Aurora* (mint/sky/lilac); home uses a prism mix.
- Digits 1–9 keep fixed neon hues everywhere.
- Background: slow nebula that brightens as the puzzle fills and blooms where you play.
- Placement: digit pops, sparks + shockwave in its colour, a bell note in the current chord, haptic.
- Completion: light sweeps across the house, beams and streaks, ROW / COLUMN / BOX / CAGE / ALL 7s
  callouts; simultaneous completions escalate to DOUBLE / TRIPLE / QUAD with bigger sound.
- Solve: wave of light from the last cell, fireworks, SOLVED / PERFECT, musical resolution — then
  play keeps going: ~2.4 s later the next level (next unsolved puzzle in the pack, same mode and
  difficulty) arrives on its own. A translucent results banner rides at the top meanwhile (time,
  record or previous best / first clear, mistakes, hints; PERFECT when there are none), never
  blocks input, and fades after ~6 s or on a tap. While it shows, the play screen's top bar,
  progress and stats step aside so nothing shows through it. Open overlays (Learn, Scores…) pause
  the advance until they close.
- **Level entrances** — eight themed styles, rotated so every one plays once per round and never
  twice in a row, each with a matching exit for the solved board: *Warp* (rushes past you / zooms
  up out of deep space), *Rain* (squares drop in and stack from the bottom, Tetris-style),
  *Ripple* (squares well up in rings from one point), *Deal* (cards flip in diagonally), *Vortex*
  (a spiral in from the edge as the board unwinds), *Shards* (pieces fly in and lock together),
  *Hologram* (a scanline projects the board row by row), *Nova* (a flash at the centre blooms
  out). Each has its own arrival sound; a small "LEVEL n" callout marks the arrival (the style is never
  named — it's meant to be felt, not announced). Cells stay live during
  them; Calm effects / reduced motion get a short fade. `?entrance=<style>` pins one (previews,
  tests).
- Mistake: shake, red sparks, muted thud, explanation toast.
- Sound: generative ambient bed per theme; every effect is quantised to the current chord.
- Settings: tabs for Sound & feel (Calm / Vivid / Epic effects, sound, music, haptics), Play,
  Killer, Queens and Data (backup); `prefers-reduced-motion` honoured. Under the tabs, the
  version and a Changelog link that opens `CHANGELOG.md` in a modal (Unreleased shows as "Next
  release" except in a release build).

---

## 6. Stats & storage

Per mode-difficulty: solved ids, best time; total solves; daily streak; per-technique hint counts
(shown on the Learn screen); a results history (last 300 levels: time, mistakes, hints, perfect,
record / first clear). **Scores** (home footer and the in-game menu) shows records per mode and
difficulty and the recent levels, filterable by mode. Levels are numbered by their place in the
pack. Everything is local (localStorage), no accounts.

**Backup** (Settings → Data): *Save backup* writes everything (progress, results, settings, games in
progress) to a `nonet-backup-YYYY-MM-DD.json` file: the share sheet on phones that can share
files, a download elsewhere. *Restore…* reads one back, asks before replacing everything on the
device, and reloads. Not encrypted; it's for moving devices and surviving cleared site data (on
iPhone a Home Screen app keeps its storage apart from Safari).

---

## 7. Non-goals (for now)

Accounts, cloud sync, leaderboards, ads, purchases; variant sudokus beyond classic/killer;
camera import.

## 8. Ideas parking lot

- **Sum calculator tape** for killer — `calc.ts` exists; the manual tape UI, multi-house regions in
  the Σ45 lens, and pinned virtual cages are the next teaching features.
- Technique mastery tracking (new / learning / solid) by classifying the player's own placements.
- "Explain my mistake" replay; daily puzzle; training packs per technique.
- Beat-quantised placements (more musical, less immediate) as an option.
