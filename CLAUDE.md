# CLAUDE.md — Nonet

Sudoku, Killer Sudoku and Queens PWA with a teaching hint ladder and a Tetris Effect–inspired
feel. Read `docs/SPEC.md` (what), `docs/ARCHITECTURE.md` (how), `docs/MILESTONES.md` (status).
`CHANGELOG.md` is for players; `docs/CHANGELOG-STYLE.md` says how to write it and how to release.

## Commands
- `npm test` — Vitest (engine, game models, ui helpers). Fast; run constantly.
- `npm run test:e2e` — Playwright at the Pixel 7 viewport. Set `PW_CHROMIUM_PATH` to reuse a
  preinstalled Chromium (e.g. `/opt/pw-browsers/chromium`).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run check` — typecheck + unit tests + build. Must be green before work is "done".
- `npm run dev` — Vite dev server. `?play=classic-easy` (or `killer-…`, `queens-…`) opens a game;
  `?play=classic-easy-c21u8fyyj3eh` opens that board (picks are random, so e2e tests name theirs).
- `npm run gen -- --mode all --max 100` — build the v2 packs in `public/packs/v2/` (append-only; keeps
  entries that still fit). The app reads them. The v1 packs (`public/packs/*.json`) are frozen: installs
  that haven't updated read them, and `npm run examples` refreshes the Learn screen's worked examples
  from them.
- `npm run stats` — profile every pack, v1 beside v2. `npx tsx scripts/gen-bench.ts` — generator cost
  and sub-target mix per band.
- `npm run build:artifact` — a copy for hosting as a single page (no service worker), in `dist-artifact/`.
- `npx tsx scripts/audio-check.ts` — offline render + level checks for the synth (needs Chromium).

## Rules
- **`src/engine/`, `src/game/` and `src/sync/` are pure TypeScript.** No DOM, no `window`, and
  `src/sync/` never imports from `src/ui/`. They run in Node.
- **Test-first for engine code.** Every technique gets a fixture test with the exact expected step.
  Every bug fix gets a regression test.
- **Solvers never guess.** Hints only come from the logical solver. The exact solver is for
  uniqueness/validation. Techniques that assume uniqueness are flagged `assumesUnique`; techniques
  invalid in killer are `classicOnly`.
- **Hint text comes from templates over structured `Step.explain` data** (`src/engine/hints/`,
  `src/engine/queens/hints.ts`). No prose in techniques. No LLM in the hint path.
- **Every pack puzzle must be solvable by the logical solver.** Don't ship a puzzle a hint can't
  explain.
- **The calculator's Region mode and the 45-rule technique share `region.ts`.**
- **Cell naming in user-facing text: `r{row}c{col}`, 1-indexed.** Internally `CellId` is 0..80.
- Candidates are `Uint16Array(81)` bitmasks (bits 1–9). Use helpers in `combos.ts` / `techniques/util.ts`.
- All randomness in engine/generators via `rng.ts`. No `Math.random()` there (UI effects may use it).
- UI stays framework-free: screens are `{ el, destroy() }`, built with `h()` from `ui/dom.ts`.
  Game models emit events; screens turn them into visuals, sound (`ui/sound.ts`) and haptics.
- The look is dark-only by design. Colours come from `ui/palette.ts` / CSS custom properties.
- Respect effects levels and `prefers-reduced-motion`; effects must never block input.
- Mobile-first: design and test at 412×915-ish. Tap targets ≥ 44px.

## Puzzle JSON
Pack formats are in `src/engine/pack.ts` (classic/killer) and `src/engine/queens/pack.ts`; v2 entries
add a content id, seed, generator version, sub-target and profile summary (`src/engine/pack-v2.ts`).
Band rules live in `src/engine/bands.ts`, written against `src/engine/profile.ts`.
Engine `Puzzle`: `{ id, kind, cages, givens?, solution, meta? }` — `solution` is 81 digits,
`givens` keys are CellIds.

## Definition of done
1. `npm run check` green; `npm run test:e2e` green for UI changes.
2. New behaviour has tests; e2e for user-visible flows.
3. A player would notice it → one bullet under `## Unreleased` in `CHANGELOG.md`, written to
   `docs/CHANGELOG-STYLE.md` (the app shows that file under Settings → Changelog).
4. Update `docs/MILESTONES.md` if a milestone moves.
5. Commit.
