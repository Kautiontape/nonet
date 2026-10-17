# Architecture

## Stack

TypeScript + Vite, vanilla DOM (no framework), Canvas 2D for effects, Web Audio for sound.
Vitest for the engine and game models, Playwright (Pixel 7 viewport) for end-to-end flows.

Why web over a game engine: the app is a grid, panels and text plus a light-show layer. A PWA
installs on Android without a store, the same TS engine runs in the browser and in Node (pack
generation, tests), and the test loop is fast. The effects that make it feel like Tetris Effect —
additive particles, a blurred nebula, synthesized music — are cheap in Canvas 2D and Web Audio.

## Layout

```
src/
  engine/                 # pure TS, no DOM — runs in Node and the browser
    types.ts              # Puzzle (classic|killer), Cage, Step (+ candidate marks, chain links)
    geometry.ts           # rows/cols/boxes, flat house ids, peers, user-facing names
    combos.ts             # cage combination tables + bit helpers
    candidates.ts         # basic candidates, cage support via matching, sum support
    exact.ts              # exact solver (count / solve) for classic + killer
    state.ts              # SolverState (grid + candidate bitmasks) and step application
    logical.ts            # easiest-first technique loop (nextStep / solveLogically)
    techniques/           # one technique per export; registry in index.ts sorted by rating
      singles.ts intersections.ts subsets.ts killer.ts innies.ts advanced.ts (+ fish, wings, …)
    region.ts             # 45-rule analysis (innies/outies) — shared by technique + calculator
    calc.ts               # calculator tape engine (UI not built yet)
    grade.ts              # difficulty from a solve path
    generate.ts           # solved grids, symmetric digging, cage partition, uniqueness repair
    puzzles.ts            # difficulty-targeted classic + killer generation
    pack.ts               # compact pack JSON
    catalog.ts            # Learn-screen technique guide (+ catalog-advanced.ts)
    hints/                # format helpers, per-technique templates, sudokuHint() ladder
    hint-types.ts         # mode-independent ladder + TechniqueInfo types
    rng.ts                # seeded PRNG (mulberry32) — all engine randomness
    queens/               # the Queens engine: types, geometry, exact, state, techniques,
                          # logical, grade, generate, hints, catalog, pack
  game/                   # pure TS game models (no DOM)
    sudoku-game.ts        # digits, notes, undo/redo, mistake reasons, completion events, hints
    queens-game.ts        # marks, gestures (tap/double tap/hold/drag), scratch layer, conflicts, events, hints
    packs.ts              # fetch + decode packs, pick next unsolved
  sync/                   # pure TS, never imports ui/: sync across devices
    code.ts               # the sync code (Crockford base32), its hash = the cloud file's name
    envelope.ts           # the { app, version, exported, data } header backups and the cloud copy share
    progress.ts           # stored progress shape, per-device counters, legacy migration
    merge.ts              # the join of two copies, key by key (union / min / later-wins / max per device)
    client.ts             # the sync cycle over injected fetch, store and config
    equal.ts              # deepEqual, canonical JSON
  ui/
    app.ts                # screen router, global layers, stage themes, saved games
    sync.ts               # sync wired to the browser: store adapter, triggers, home refresh
    screens/              # home, sudoku-play, queens-play, learn, settings-sheet, changelog, scores
    components/           # sudoku-board (+ cage-paths), queens-board, numpad, hint-sheet, toast,
                          # result-banner (post-level stats strip), pause (cover + timer button)
    fx/                   # background (nebula), particles (FX canvas), callout,
                          # levels (8 themed entrances/exits) + level-order (rotation, spiral, level no.)
    audio/                # synth.ts (engine), theory.ts (themes/harmony), dsp.ts (IR, noise)
    sound.ts              # façade the UI calls; silent until the synth is connected
    cell-refs.ts          # square names in hint text → shared colours for text chips and board rings
    changelog.ts          # CHANGELOG.md (bundled ?raw) parser, build version from `git describe`
    palette.ts settings.ts store.ts haptics.ts icons.ts messages.ts dom.ts style.css
  main.ts
public/
  packs/                  # generated puzzle packs
  sw.js manifest.webmanifest icons/
scripts/
  generate-pack.ts        # parallel pack generator (child processes)
  queens-stats.ts         # queens generator report
  audio-check.ts          # renders the synth offline in Chromium and checks levels
tests/
  engine/ game/ ui/       # Vitest
  e2e/                    # Playwright
deploy/                   # the host: nginx site (source of truth), sync rate-limit zone,
  README.md               # cleanup timer, and sync-setup.sh that installs them; README says
  sync-setup.sh           # how to stand up a new server
```

## Engine

- `CellId` 0..80 row-major; user-facing names `r{row}c{col}` (1-based). Houses have flat ids
  0..26 (rows, cols, boxes). Candidates are `Uint16Array(81)` bitmasks (bits 1–9).
- **Exact solver** — bitmask backtracking, minimum-remaining-values, hidden-single forcing, and
  cage pruning (a cell may only take digits that appear in a combination completing its cage).
  Used for uniqueness and validation, never for hints.
- **Logical solver** — asks techniques in rating order, applies the first step found, repeats.
  Every step is a sound deduction. Techniques flag `killerOnly`, `classicOnly` and
  `assumesUnique` (unique rectangles, BUG+1); the latter are excluded when a solve is used as a
  uniqueness proof.
- **Steps** carry structured `explain` data, `focus` (where to look), `marks` (candidate roles:
  place / elim / key / alt / on / off / digit), `links` (chain arrows), `sources` (digits that
  justify a single) and `virtualCages` (45-rule cages). Templates in `hints/` turn `explain` into
  the four rung texts; the board turns the rest into visuals. Square names in those texts are
  coloured by `ui/cell-refs.ts`; each board computes the colours for the visible rungs itself
  (`refColors`), and the hint sheet asks the board for the same map, so text and rings always
  agree.
- **Hints** reason from the board (basic candidates), never from the player's notes, and always
  aim at a placement: `sudokuHint` runs the solver ahead a few placements, traces each one's
  candidate dependencies back through the steps before it (digit-aware: a hidden single of 7 only
  needs earlier eliminations of 7 in its house; arithmetic placements need none), and picks the
  placement with the fewest. A direct probe first asks every placing technique (singles, cage
  last cell, 45-rule sums) about the board itself. A placement that needs narrowing first becomes
  a **route** (`SudokuHint.route`): up to three narrowing steps, then the placement when it's
  within reach, each entry a complete single-step hint with its own ladder and marks; the hint
  itself mirrors the first entry, and `target` names the digit's square. The play screen walks
  the route, one entry per Apply. Everything a hint rules out goes into `SudokuGame.known`
  (saved) and back in as `HintInput.known`, so steps build on each other. `hintMarks` is the one
  list of squares a step pencils — the board draws ghosts there, and applying a narrowing step
  writes `shownCandidates` (what a note may hold, less `known`) into the same squares. Notes are
  only checked for digits that are impossible (`impossibleNotes`, over the same
  `legalCandidates`); auto-clear on placement removes exactly those (cage sums included), so
  notes a step wrote never trip it.
- **Auto-note layer.** `SudokuGame.layer()` is never stored: `candidatesNow()` (cage-sum
  candidates in killer, basic in classic) less `known`, the player's strikes (`hidden`, saved)
  and their own notes; the board draws it (`.notes i.auto`) cool where the player's notes are
  warm, quiet away from the selection and at full strength in its houses and cage (pure CSS on
  the `sel`/`peer`/`cage-peer` classes; see docs/design/2026-10-14-notes-visibility.md). With the layer on, `effectiveKnown()` adds what it rules out to `known` for
  the hint engine — sound, since the layer comes from the rules — so hints never re-teach it,
  and `visibleNotes()` (own notes plus the layer) goes in as `HintInput.visible`, used only to
  mark a route step `already` shown.

### Generation
- Classic: random solved grid → dig 180°-symmetric pairs while the exact solver says unique →
  logical solve → keep when the grade matches the target difficulty.
- Killer: random solved grid → grow cages (no repeated digit; size mix per difficulty) →
  logical solve with no uniqueness-assuming techniques. A complete solve *proves* uniqueness.
  If the solver gets stuck, split the stuck cage with the most open candidates and retry. This is
  far faster than exact counting on loose layouts (which can take millions of nodes), and it
  guarantees every killer puzzle is hintable end to end. Single-cell cages are capped per
  difficulty.
- Queens: random valid queen placement → grow regions from the queens with per-difficulty region
  styles → exact uniqueness repair → logical grade.

## UI

- Screens are plain objects `{ el, destroy() }` mounted by `App`. `App.play` destroys the current
  screen *before* building the next so a stale autosave can't overwrite a new game.
- Everything saved goes through `store.ts` (`localStorage`, keys prefixed `cagecoach.`). A backup
  is every prefixed key but `device` as JSON under an `{ app, version, exported }` header
  (`sync/envelope.ts`). Restoring replaces them all, then turns `save`/`remove` into no-ops and
  loads the page again (plain path, never `?play=`), so an open game's autosave or the cached
  settings can't write over the backup. Progress keeps solve and hint counts per device
  (`counters[deviceId]`; the screens see the sums); a cleared game leaves `{ clearedAt }` in its
  slot and saves carry `savedAt`; `settingsAt` says when a synced setting last changed here.
- Sync (`docs/design/2026-10-14-cross-device-sync.md`): the cloud copy is a backup envelope of
  the synced keys, one file per player on the server, named by the hash of a sync code (the
  server is an nginx DAV location, see `deploy/README.md`). `sync/client.ts` pulls, merges
  (`sync/merge.ts`, a join: same result in any order), writes what changed and pushes when this
  side had more. `ui/sync.ts` wires it: saves to synced keys mark it pending and push after a
  short debounce; the page coming into view or online, and start-up, pull; `pagehide` fires a
  keepalive push. A pull rebuilds the home screen if it is showing; a play screen keeps its own
  game, whose next autosave is newer and wins. Pulled settings go through
  `applySyncedSettings`, which doesn't stamp `settingsAt`, so two devices never ping-pong.
- Game models emit events (`place`, `complete`, `solved`, …); play screens translate events into
  board animations, particles, callouts, sound and haptics. Models never touch the DOM.
- The sudoku board is DOM cells (crisp text, accessible `gridcell`s) under an SVG overlay
  (grid lines, cage outlines traced from cell boundaries and inset at corners, tints, hint
  layer). Killer cage outlines are closed polygons so they can be animated (light runs around a
  completed cage).
- Effects: a low-resolution nebula canvas stretched by CSS (free blur, cheap on phones) and a
  full-screen additive particle canvas using pre-rendered glow sprites (no `shadowBlur`); the
  particle loop sleeps when idle. Effects level scales particle counts and disables ambient motion.
- Sound: see the design notes at the top of `src/ui/audio/synth.ts`.

## Performance

Hints run synchronously on the main thread; the logical solver's step search is milliseconds on
typical positions. Pack generation runs in Node across CPU cores.
