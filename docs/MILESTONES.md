# Milestones

Each milestone ends with `npm run check` green (typecheck + unit tests + build) and, for UI work,
`npm run test:e2e` green.

## M0 — Scaffold ✅
Vite + TS + Vitest + Playwright; combo tables, calculator tape engine, validation.

## M1 — Exact solver + candidates ✅
`candidates.ts`, `exact.ts` (MRV + hidden-single forcing + cage pruning); patterned fixture counts
2 solutions; Wikipedia puzzle solves uniquely; layouts derived from a solution admit it.

## M2 — Generators ✅
Seeded PRNG, random solved grids, symmetric classic digging, killer cage partition with
logical-proof uniqueness and cage-splitting repair, Queens generator; parallel pack script.

## M3 — Playable boards ✅
Sudoku (classic + killer) and Queens boards, notes, long-press pencil, undo/redo, auto-clear notes
(incl. cage peers), "why it's wrong" messages, autosave/resume, keyboard, drag across cells to
pencil a digit into all of them, and a long-press number wheel (hold an empty square, flick toward
a digit to enter it as answer or note).

## M4 — Calculator ⏳ (Region mode and cage totals done)
The killer cage bar shows the selected cage's combinations, and its **Σ45 lens** is Region mode:
pick the selected cell's row, column or box and it writes out the 45-rule equation
("45 − (22+10) = 13, so r4c4 + r6c5 = 13") and rings the innies/outies — using the same
`region.ts` as the hint technique. Selecting cells across several cages adds those cages up on
the bar (`cageTally` in `calc.ts`) and lights them. *Deferred: the manual tape UI (`calc.ts`
engine exists and is tested), multi-house regions in the lens, pinned virtual cages.*

## M5 — Logical solver + hints ✅
Technique registry tiers 1–5 (sudoku, killer, queens), hint ladder with mistake and notes checks,
templates for every technique, SudokuWiki-style board visuals, Learn screen.

## M6 — Grading + packs ✅
Difficulty grading per mode; packs for every mode × difficulty. *Deferred: the full "interesting"
filter from the original spec (break-in requirements, early-singles rejection).*

## M7 — Advanced techniques ✅
Fish (incl. finned), single-digit patterns, wings, colouring, uniqueness (classic only), chains.

## M8 — PWA polish ✅ (mostly)
Manifest, icons, offline service worker, dark stage themes, haptics, effects levels, stats
(solved, best times, streak, per-technique hint counts), generative audio.
Learn screen worked examples: a real position per technique, drawn with the hint layer.
Squares named in hints, examples and the Σ45 lens are colour-matched to rings on the board.
*Deferred: install prompt UI, daily puzzle, technique mastery (new / learning / solid).*

Queens input: tap ✕ on/off, double-tap queen, hold to clear, one undo step per drag; a Scratch
layer for what-if queens that never counts and wipes back to your spot (or is kept).

Levels flow: auto-advance after a solve with a translucent results banner; eight themed level
entrances with matching exits and arrival sounds; Scores (records + history).

Hints aim at the next digit: board-only reasoning, placement lookahead with digit-aware
dependency tracing; only impossible notes are flagged. A digit that needs narrowing first is a
route, taught one step at a time on the sheet ("Step 1 of 3 · toward r5c6"), with credit for
steps already in your notes. A hint pencils only the squares its step marks (other notes step
aside while it's open); applying a narrowing step writes those notes, and auto-clear drops what a
killer cage's sum rules out, so they never go stale.

Backup: Settings → Data saves everything to a JSON file and restores it (replace, after a confirm).
Settings in tabs, with the build's version and a Changelog modal read from `CHANGELOG.md`.

Sync across devices: a sync code (no accounts) pairs devices; scores, streak, hint counts,
gameplay settings and games in progress merge as a join (`src/sync/`, property-tested), the cloud
copy is a backup envelope on an nginx DAV location (`deploy/`), and nothing ever blocks play.

Auto notes is a layer of digits under your own (strike, unstrike, erase), a setting that
follows you between levels; with it on, hints take what it shows as known, so a killer route
never re-teaches a cage sum you can already see.

## M9 — Puzzle generator v2 ⏳
Bands that say what a player meets, with breather / standard / stretch boards on purpose
(`docs/generator-research.md`). Done: board profile, permanent content ids, bands as data, Classic,
Killer and Queens generators, the v2 pack builder, 100 boards for each of the 12 bands in
`public/packs/v2/`, `npm run stats`, and Killer solves 2.4–2.9× faster. The app reads the v2 packs and
picks a random unsolved board (New puzzle moves on; once all are solved, random replays); the level
number counts every solve per mode and difficulty, synced, plus v1 solves. *To do: convert saved v1
ids to content ids once a format version stops 0.3 phones syncing them back.*

## Next
- Calculator tape UI and multi-house lens (M4).
- Technique mastery tracking by classifying the player's own placements.
- Training packs; "explain my mistake" replay.
