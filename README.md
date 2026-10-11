# Nonet

Sudoku, Killer Sudoku and Queens — with a coach that teaches every technique, wrapped in a
Tetris Effect–inspired light-and-sound show. Installable PWA, works offline, built for phones.

- **Three puzzles.** Classic sudoku, killer (cage sums, no givens), and the colour-region
  *Queens* puzzle (one queen per row, column and colour; queens never touch).
- **A coach, not an answer key.** Every hint takes you to the next digit you can *know* from your
  board, revealed one rung at a time — *where* → *what* (technique) → *why* (full reasoning, drawn
  on the board, with any narrowing it needs first) → *do*. It checks for wrong digits and for
  notes that are impossible — but never treats loose notes as mistakes. Hints never guess: every
  puzzle in the packs is solvable start to finish by the same techniques the hints use.
- **SudokuWiki-style visuals.** Candidates coloured by role (placed, eliminated, pattern, chain
  colours), sight lines from the digits that justify a single, chain arrows, dashed 45-rule cages.
- **Squares you can find at a glance.** Every square a hint names ("r9c8") gets an accent colour
  in the text and a ring of the same colour on the board; squares listed together share one, and
  tapping a name pulses its square. In Queens a name takes its region's colour. While a hint is
  open the board sits fully above the sheet, so no ringed square hides behind it.
- **Learn screen.** Rules plus every technique the hint engine knows, grouped by tier: how to spot
  it, why it works, tips, how often hints have shown it to you, and a worked example on a real
  board drawn with the same hint visuals.
- **Killer helpers.** The cage bar lists a cage's combinations; its **Σ45 lens** works the 45 rule
  for any row, column or box ("45 − (22+10) = 13, so r4c4 + r6c5 = 13") and rings the cells.
  Select cells across several cages and it adds those cages up: "54 = 11 + 12 + 12 + 19".
- **Comfortable input.** Hold a digit to light it up across the grid; drag (or Shift / Ctrl-click)
  to select several cells, then pencil a digit into all of them or erase them all at once;
  auto-notes; unlimited undo. On desktop: hold Shift for notes mode, Space toggles notes, Shift+arrow
  or Shift/Ctrl-click selects several, H / Enter climb the hint, Esc steps back, Ctrl+Z / Y. In Queens: tap for ✕ (tap again to
  take it off), double-tap for a queen, hold to clear, drag to ✕ many.
- **Levels that keep coming.** Finish one and the next drops in on its own — with one of eight
  themed entrances (Warp, Rain, Ripple, Deal, Vortex, Shards, Hologram, Nova) — while a
  translucent banner shows your time, record, mistakes and hints. **Scores** keeps the history.
- **Queens scratch.** Try queens and ✕s on a what-if layer that never counts — no mistakes, no
  right/wrong tells — then wipe back to exactly where you were, or keep it.
- **Mistakes that teach.** "Row 6 already has a 5." "That cage already has a 7." "This 3-cell cage
  sums to 6, so it can only be 1+2+3 — no 9."
- **Feel.** A slow aurora that blooms where you play; sparks in each digit's colour; light sweeping
  across completed rows, columns, boxes and cages; ROW / DOUBLE / TRIPLE callouts; a solve finale.
  Generative ambient music where every placement plays a note quantised to the current chord.
  Haptics on Android. Effects levels (Calm / Vivid / Epic) and reduced-motion support.

## Setup

```bash
npm install
npm run check        # typecheck + unit tests + build
npm run test:e2e     # Playwright, Pixel 7 viewport (set PW_CHROMIUM_PATH to reuse a local Chromium)
npm run dev          # http://localhost:5173  (?play=killer-medium jumps straight into a game)
```

### Puzzle packs

Packs live in `public/packs/{classic,killer,queens}-{easy,medium,hard,expert}.json` and are
generated offline, deterministically per seed:

```bash
npm run gen -- --mode all --count 60          # everything
npm run gen -- --mode killer --difficulty hard --count 60 --seed 1
npm run examples                              # refresh the Learn screen's worked examples
```

Classic puzzles are dug from a random grid while the exact solver confirms uniqueness, then graded
by the hardest technique the logical solver needs. Killer puzzles use a full logical solve as the
uniqueness proof: when the solver gets stuck, the loosest stuck cage is split and the solve reruns.
Queens puzzles grow colour regions around a valid queen placement and repair until unique.

## Deploying

Two copies on one host, both built by a self-hosted GitHub Actions runner on **ktn** after
`npm ci`, the typecheck and the unit tests (a failing build leaves the old `dist/` in place):

- **Beta** — [nonet.kautiontape.com/beta/](https://nonet.kautiontape.com/beta/). Every push to
  `main` checks that commit out in `/opt/services/nonet-beta` and builds it with
  `VITE_CHANNEL=beta`, so it calls itself "Nonet Beta" (title, manifest, a tag on the home
  screen) and installs beside the real app (`.github/workflows/deploy-beta.yml`). The workflow
  clones that directory from production's remote if it isn't there yet.
- **Production** — [nonet.kautiontape.com](https://nonet.kautiontape.com). Moves only on a
  release: push a tag like `v0.1.0` (`git tag v0.1.0 && git push origin v0.1.0`, or publish a
  GitHub Release), and the runner checks that tag out in `/opt/services/nonet` and builds it
  (`.github/workflows/deploy.yml`; it can also be run by hand from the Actions tab).

The host nginx serves `/opt/services/nonet/dist/` at the root and needs a block for the beta:

```nginx
location /beta/ {
    alias /opt/services/nonet-beta/dist/;
    try_files $uri $uri/ /beta/index.html;
}
```

The build uses relative paths, so the same `dist/` works from either path. Each copy registers
its own service worker (`/sw.js`, `/beta/sw.js`): a worker only answers requests inside its scope
and keeps a cache of its own, so the beta never feeds production stale pages or the other way
round. Pull requests run `npm run check` on GitHub's runners (`.github/workflows/ci.yml`).

## Docs

- What it does: `docs/SPEC.md`
- How it's built: `docs/ARCHITECTURE.md`
- Status and next steps: `docs/MILESTONES.md`
- Rules for Claude Code: `CLAUDE.md`
