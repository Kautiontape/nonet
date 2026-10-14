# Generator research

Phase 2 of the generator work: how to generate Classic, Killer and Queens boards that fit their
band on purpose, measured against the v1 packs. Written 2026-10-14. "Approved bands" is what Phase 3
builds; Shawn approved it the same day.

All timings are from one core of an AMD Ryzen 5 7600X running Node through `tsx`. Cost per board is
the total time of a run divided by the boards it produced, so failed attempts count. Per-board times
vary widely (Killer Expert boards took between 0.1 and 64 s), so costs are averages over 8 to 60
boards. Two runs of the same Killer Expert settings on different seeds came out at 9.8 and 9.9 s a
board. Other jobs share this machine, so repeating a run changed its wall-clock time by up to about
45%; attempt and check counts repeat exactly. Costs under 20 ms come from 40-board runs timed to
0.1 s and are rough. The experiment scripts are in `research/experiments/` in this worktree and stay
out of the repo; Phase 3 moves the chosen methods into `src/engine/` and `scripts/`.

## Terms

- **Basics:** the techniques Easy allows. Singles in Classic; tier 1–2 in Killer (cage arithmetic,
  pointing, pairs) and in Queens. A "step past the basics" is any other step.
- **Wall:** a stretch of the solve where the basics find nothing. In Classic it means scanning the
  digits on the board, without notes, finds no single. In Killer and Queens it is a run of steps past
  the basics. The **first wall** is measured by how much of the board is still open when it starts:
  empty squares in Sudoku, cells that could still hold a queen in Queens. A smaller number means a
  later wall.
- **Early options:** the average number of placements scanning offers over the first 25 states of
  the solve, a version of Pelánek's "dependency" metric (his averages a randomised solver's choices;
  this one follows the hint engine's path; see Prior art). Higher is easier. v1 Classic Easy boards
  range from 5.6 to 25.3, median 14.2; v1 Medium's median is 3.8.
- **Tier-4+ steps:** what Expert has to be full of. Tier 4 is Jellyfish, finned Swordfish, Empty
  Rectangle, W-Wing, simple colouring, quads, unique rectangles and BUG+1; tier 5 is X-chains,
  XY-chains and AICs. In Queens, tier 4 is confinement over 3+ units and tier 5 is contradiction.
- **Sub-targets:** each board's seed draws one before the board is made. About 1 in 4 is a
  **breather** (the gentle end of its band), about 1 in 6 a **stretch** (the top of its band), and the
  rest **standard**.

## Results

| Mode and band | v1 method | New method | What changes, v1 → new | Cost per board, v1 → new |
|---|---|---|---|---|
| Classic Easy | dig to 36 givens | strip with a cross-hatching-only check and a floor on early options | early options set per board (10–14, 14–18 or 18+) instead of anywhere from 5.6 to 25.3; never a naked single | 2.5 ms → about 10 ms |
| Classic Medium | dig to 27+ givens, keep tier 2 | dig, fill back until the wall is late, strip again | first wall at a median of 23–32 empty squares by sub-target, against 38; 1–5 steps past singles, against 1–7 | 35 ms → 0.28–0.38 s |
| Classic Hard | dig to minimal, keep tier 3 | dig, fill to the tier-3 limit, strip again | boards with a single tier-3 step become breathers only | 27 ms → 62 ms |
| Classic Expert | dig to minimal, keep tier 4+ | the same dig, keeping boards with 3+ tier-4+ steps | every board has 3+ tier-4+ steps, against 30 of 60 | ≤ 0.1 s → 42 ms |
| Killer Easy | lay out cages, split to repair | the same; stretch boards also merge cages | cage count set per board | 44 ms → 0.16–0.23 s |
| Killer Medium | lay out, repair at tier 3 | lay out, repair, merge until 1–4 single-house 45s | the 45 rule is used 1–4 times, set per board, against 1–18 | 0.23 s → 0.26–0.35 s |
| Killer Hard | lay out, repair | lay out, repair with one-cell cages allowed, merge | no attempt fails at repair | 0.39 s → 0.25 s |
| Killer Expert | lay out, repair; 6 of 14 seeds fail | lay out, repair, merge to harden, with a cage-size guard | 2–9 tier-4+ steps (2, 3–4 or 5+ by sub-target), against a median of 1 in the v1 pack (range 1–5) | 9.9 s → about 11 s |
| Queens, all bands | grow regions, repair, grade | the same, with rules on size, how often you're stuck, and contradiction count | Medium and Hard differ by how often you're stuck; Expert capped at 8 contradiction steps | 2–37 ms → 0.5 ms to 0.26 s |

- The v1 Killer costs above already include a solver change from this phase (commit `583830e`,
  "Solver speed" below), which makes every Killer solve 2.4–2.9× faster, so the columns compare
  methods. Before it, v1 Killer Expert took about 28 s a board. The v1 Classic Expert figure was
  measured before this phase.
- Every new method ends with the same check: the hint engine's own solve, with every
  technique the hints use, must finish and meet the band's rules. Classic boards also get an exact
  uniqueness check (0.04 ms).

## Approved bands

Shawn approved these on 2026-10-14, after changing the first proposal in five places (listed after
the table). Phase 3 builds them. Cells marked "to measure" have no run behind them yet; Phase 3
measures them and adjusts if they don't hold.

| Band | Every board | Breather | Standard | Stretch |
|---|---|---|---|---|
| Classic Easy | singles found by cross-hatching only (never a naked single); no walls; at every point at least two squares can be filled by looking | early options 18+ | 14–18 | 10–14 |
| Classic Medium | singles, pointing and claiming; pairs only in stretches; one or two walls | first wall ≤ 24 empty squares; 1 step past singles | ≤ 28; 2–3 steps | ≤ 34; 3–5 steps, pairs allowed |
| Classic Hard | tier 1–3 only, with at least one tier-3 step (pairs alone don't count) | one tier-3 step | two | three or more |
| Classic Expert | 3+ tier-4+ steps; no hardest-step technique on more than about 40% of the pack | no chains (hardest step at tier 4) | 3–5 tier-4+ steps | 6+ |
| Killer Easy | tier 1–2; up to six one-cell cages | 5–6 one-cell cages | 3–4 | 1–2, cages merged toward the tier-2 limit (to measure) |
| Killer Medium | tier 3 only through 45s over one house; the first 45 is needed before 11 squares are filled | one 45, plus one or two one-cell cages | two 45s, no one-cell cages | three or four 45s, no one-cell cages |
| Killer Hard | a 45 over 2+ houses or a tier-3 sudoku technique; stuck past the basics at 3+ separate points; no tier-4+ step; no one-cell cages | 5 or fewer 45-rule steps (to measure) | 6–11 | 12+ (to measure) |
| Killer Expert | 2+ tier-4+ steps; no one-cell cages; at most two 6-cell cages | 2 tier-4+ steps | 3–4 | 5+ |
| Queens Easy | tier 1–2 with at least one tier-2 step; never stuck | 6×6 | 6×6 or 7×7 | 7×7 |
| Queens Medium | touch and counting steps (tier 3–4); stuck once or twice; no contradiction | 7×7, stuck once | 8×8, once or twice | 8×8, twice |
| Queens Hard | touch and counting steps; stuck at 3+ separate points; no contradiction | 8×8, three times | 9×9, three times | 9×9, four or more |
| Queens Expert | contradiction ("what if") 2–8 times | 9×9, two | 9×9 or 10×10, three to five | 10×10, six to eight |

Changes from the first proposal:

- **Classic Easy is gentler, for players who don't use pencil marks.** The first proposal made
  standard Easy slightly harder (early options 10–14). With floors of 10, 14 or 18 early options, none
  of 120 test boards needed a naked single and none ever had fewer than two squares to fill, so
  "cross-hatching only" costs nothing extra. Floors of 18 give boards of 30–46 givens (median 34) at
  about 10 ms each.
- **Pairs go in Classic Medium stretches.** HoDoKu, QQWing and SudokuWiki put pairs in their middle
  level, and Nonet's tiers put pairs with pointing and claiming. A naked pair is hard to see without
  notes, so breather and standard Medium boards keep to pointing and claiming. Hard boards always
  need a tier-3 step; pairs alone no longer make a board Hard.
- **Killer hands out one-cell cages at Easy, and Medium breathers get one or two.** With up to six
  allowed, Easy boards came out with 2–6 (most 4–6) at 0.08 s each. With up to two allowed, 11 of 16
  Medium boards got two, at 0.14 s each. SudokuWiki's generator says one-cell cages are "useful for
  gentle and moderate Killers but not suitable for higher grades"; Simon Tatham's Solo keeps them only
  at its easiest Killer level.
- **Killer Medium always opens with a 45.** Requiring the first 45 before 11 squares are filled
  costs 0.31 s a board; 11 of 16 boards need it before any square is filled anyway. Making Killer
  Hard's first 45 come late isn't workable: all 16 test Hard boards need one before the first square,
  and requiring it after 20 produced no board in 11 minutes. Requiring Hard's first 45 to span several
  houses worked but cost about 2.5 minutes a board. Hard boards already need a 45 or harder step again
  and again (stuck at 3–12 separate points, median 6, against 1–2 in Medium), so that is Hard's rule.
- **Queens bands are built on three ideas instead of on tiers.** See the Queens section: a count of 2
  and a count of 3 are the same idea, and what separates boards is how often nothing on the board
  tells you anything on its own.

## The v2 packs

`npm run gen -- --mode all --max 100` built all 12 packs in 12 minutes on 8 workers (about 97 CPU
minutes). Every band has 100 boards: 25 breathers, 58 standard and 17 stretches, every board fitting
the approved rules. Killer Expert took 10.4 of the 12 minutes; no other band took more than 33 seconds.
Packs are 26–59 KB each. Against the v1 packs (`npm run stats`):

| Band | v1 | v2 |
|---|---|---|
| Classic Easy | 36–37 givens; early options 5.6–25.3 (median 14.2); 1 of 60 needs a naked single | 27–48 givens; early options 10–22 (14.6); none needs a naked single; at least two squares to fill at every point |
| Classic Medium | first wall at 18–48 empty squares (median 38); 1–7 steps past singles; pairs on 13 of 60 | 18–34 (median 27); 1–5 steps; pairs on 6 of 100, all stretches |
| Classic Hard | one tier-3 step on 31 of 60 | one tier-3 step on 25 of 100 (the breathers); median 2 |
| Classic Expert | 3+ tier-4+ steps on 30 of 60; AIC the hardest step on 22 | 3+ on all 100; AIC the hardest on 40, the cap |
| Killer Easy | 0–2 one-cell cages | 1–6 (median 4) |
| Killer Medium | the 45 rule 1–18 times (at most twice on 30 of 60); first 45 before 11 squares filled on 57 of 60 | 1–4 times (median 2); first 45 before 11 squares filled on all 100 |
| Killer Hard | stuck at 1–13 points | 3–11 (median 6); the 45 rule 4–17 times |
| Killer Expert | 29 boards; tier-4+ steps 1–5 (median 1), 3+ on 3 | 100 boards; 2–19 (median 3), 3+ on 75 |
| Queens Medium | all 8×8; stuck 1–4 times | 7×7 or 8×8; stuck once or twice |
| Queens Hard | all tier 4; stuck 1–4 times | stuck 3–5 times; 80 of 100 are tier 3 |
| Queens Expert | 1–25 contradictions | 2–8 (median 3) |

Three things the packs show that the approved rules leave open:

- Killer Expert's hardest step is a chain on 68 of 100 boards (AIC 52, XY-chain 16). The 40% cap was
  approved for Classic Expert only. A cap here would need a larger pool, at about 32 worker-seconds per
  Killer Expert board in this run.
- Some Classic Easy breathers have up to 48 givens: on some grids, 18+ early options takes that many.
- Killer Hard boards have up to five 6-cell cages; the 6-cell limit was approved for Expert only.

## Classic

A full logical solve takes 0.1–4 ms on v1 boards and an exact uniqueness check 0.04 ms.

### Easy

Stripping with a singles-only check, the method Simon Tatham's Solo uses, takes boards down to 26–33
givens. Those boards give scanning less to work with than v1's: early options 3.4–12 (median 6.2)
against v1's 14.2.

| Stopping rule (40 boards each) | Givens | Early options | Cost per board |
|---|---|---|---|
| strip as far as singles allow | 26–33 (median 28) | 3.4–12 (6.2) | 5 ms |
| givens floor 30 | 30–33 (30) | 4.1–12.5 (8.2) | 5 ms |
| givens floor 36 (as v1) | 36–37 (36) | 6–20.7 (13.2) | 3 ms |
| givens floor 38 | 38–39 (38) | 8.4–23.1 (14.4) | 3 ms |
| early-options floor 7 | 27–32 (29) | 7–10.4 (8.3) | 12 ms |
| early-options floor 10 | 27–52 (30) | 7.2–14.2 (10.8) | 12 ms |
| early-options floor 14 | 28–53 (32) | 7.2–16.4 (14.7) | 10 ms |

At 36 givens, early options still range from 6 to 20.7; a floor of 10 on early options holds most
boards between 10 and 14. Among singles-only puzzles, Pelánek's version of the metric correlated with
human solving time at r = 0.73–0.78, and the number of givens at 0.22–0.34. These runs only checked
the floor once 30 or more squares were empty, because a nearly full board has too few states to
average; a few boards therefore stopped with 50+ givens and early options under the floor. The final
check rejects them.

### Medium

Stripping under a Medium check (singles, pointing and claiming; wall at 28 or fewer empty squares;
at most 3 steps past singles) works, but most attempts end as Easy boards: 40 boards took 2,722
attempts.

| Method (wall ≤ 28, ≤ 3 steps past singles) | Attempts for 40 boards | Cost per board | First wall | Steps past singles |
|---|---|---|---|---|
| strip under the Medium check | 2,722 | 0.41 s | 18–28 (26) | 1–3 (1) |
| strip until singles alone stop, then strip under the Medium check | 6,200 | 1.35 s | 17–28 (25) | 1–2 (1) |
| strip with no wall limit, then add givens back at the wall | 1,142 | 0.22 s | 18–28 (27) | 1–3 (1) |
| dig with the exact solver, fill back, strip again | 1,141 | 0.15 s | 19–28 (27) | 1–3 (1) |
| v1 (dig to 27+, keep tier-2 boards without pairs) | 705 | 35 ms | 24–46 (37) | 1–6 (2) |

A board stripped as far as pointing and claiming allow usually doesn't need them: 89% of those
strips end as Easy boards, because pointing and claiming solve little that singles can't. A board
that stalls early can be repaired from the other side: adding a given never invalidates a deduction,
so digits put back at the stall point move the wall later while the board stays solvable by the same
techniques. Dig, fill, strip uses this. The exact solver digs a minimal unique board; about two
thirds of those come out singles-only, which makes them minimal Easy boards, usable as Easy stretch
boards. For the rest, mirrored pairs go back in at the stall point until the board fits the Medium
techniques and the wall target, and a second strip removes the givens the target doesn't need.

Every stripping method gives a median of one step past singles. Asking for more works; for the 2–3
and 3–5 rows below, the second strip takes, at each point, the removal that adds the most steps past
singles:

| Sub-target (dig, fill, strip; 40 boards each) | Cost per board | First wall | Steps past singles | Walls |
|---|---|---|---|---|
| wall ≤ 24, exactly 1 step | 0.38 s | 19–24 (23) | 1 | 1 on all 40 |
| wall ≤ 28, 2–3 steps | 0.36 s | 21–28 (27) | 2–3 (2) | 2 on 2 of 40 |
| wall ≤ 34, 3–5 steps | 0.28 s | 24–34 (32) | 3–5 (3) | 2 on 3 of 40 |
| wall ≤ 22, exactly 1 step | 0.83 s | 18–22 (21) | 1 | 1 on all 40 |

### Hard

| Method (60 boards each) | Cost per board | Tier-3 steps per board | Hardest step |
|---|---|---|---|
| v1: dig to minimal, keep tier 3 | 27 ms | 1 on 32, 2 on 18, 3 on 6, 4 on 3, 9 on 1 | Skyscraper 27, XY-Wing 20, hidden pair 6 |
| dig, fill to the tier-3 limit, strip again | 62 ms | 1 on 29, 2 on 19, 3 on 9, 4–7 on 3 | Skyscraper 28, XY-Wing 16, hidden pair 4 |

The fill keeps boards that dug past tier 3: digits go back until tier 1–3 solves them, so they
become Hard boards, and 424 attempts were needed against 581. It is also the Medium pipeline with a
different technique limit, which is why it was chosen. Sub-targets select from what it produces:
about half the boards have one tier-3 step, a third have two, and a fifth have three or more, so a
standard board costs about 0.2 s and a stretch board about 0.3 s. Boards whose hardest step is a
pair are tier 2 and were not collected in these runs.

### Expert

| Method (30 boards each, same seeds; keep boards with 3+ tier-4+ steps) | Cost per board | Tier-4+ steps |
|---|---|---|
| v1 dig to minimal with the exact solver, then grade | 47 ms | 3–12 (median 4) |
| strip with the full logical solver as the check | 0.56 s | 3–12 (4) |
| strip, trying 8 removals each time and keeping the one with the most tier-4+ steps | 0.49 s | 3–18 (6) |

Stripping with every sound technique as the check produced 28 of the same 30 boards as digging with
the exact solver, 12× slower in this run: with chains available, "the logical solver finishes" and
"the board is unique" almost always agree. Trying 8 removals at a time lifts the median from 4 tier-4+
steps to 6.

A larger run of the v1 method (60 boards, 42 ms each) gives the sub-target shares: 3 tier-4+ steps on
24 boards, 4 on 13, 5 on 5 and 6+ on 18; 6% of attempts qualify at all. Stretch boards (6+) are 30% of
what the plain dig keeps, about 0.14 s each, so the greedy strip isn't needed for them. The hardest step is a chain on
56 of the 60 (AIC 35, XY-chain 20, X-chain 1). The other four have a Jellyfish, a unique rectangle,
an Empty Rectangle or a W-Wing as their hardest step; those are the breathers, about 7% of qualifying
boards, at about 0.6 s each. 19 of the 60 use a unique rectangle or BUG+1 on the hint path. Both are
sound only on unique boards, so the strip checks leave them out and the exact check keeps every
board unique.

## Killer

### Solver speed

Profiling the Killer solver on the v1 packs showed cage combinations (checked against candidates)
at 52% of solve time and cage pointing at 17%, about 100 µs a call each. Both redo a matching for
every cage on every step, though most cages don't change between steps. Each cage now keeps its last
check, keyed by its cells' digits and candidates (`checkedView` in `techniques/killer.ts`). Mean solve
times on v1 boards went from 6.0 / 9.5 / 14.6 / 25.0 ms to 2.5 / 3.5 / 5.7 / 8.5 ms (Easy to Expert),
and the steps are identical on all 37,252 steps of the v1 Killer packs. A test scribbles over each
step's explain data before the next step and checks the solve doesn't change.

The profile's per-state scan, over the candidates auto-notes would show, costs five to six times a
Killer solve, so generators run the profile with `scan: false`.

### Method

1. Lay out cages over a random solved grid with Medium cage-size weights. For Expert they were the
   fastest start tried: 9.9 s a board against 13.5 s from Easy sizes and 22.6 s from Expert's own
   (paired runs), and 10.8 s against 12.8 s from Hard sizes. The other bands use them untested
   against alternatives.
2. Repair: solve with the band's techniques; if the solve stalls, split a stalled cage, picked at
   random with weight growing with its open candidates. One-cell cages are allowed at this stage.
3. Harden: merge two neighbouring cages (no repeated digit, size cap and guard respected) when the
   board still solves with the band's techniques and moves toward the target. Merges that absorb a
   one-cell cage go first; Hard and Expert boards must end with none.
4. Check the board with the hint engine's full solve.

With one-cell cages banned during repair, as in v1 above Medium, 74% of Expert attempts failed
there: 2- and 3-cell cages can only split off a one-cell cage, so a stalled board often had no legal
split. With them allowed and absorbed while hardening, no attempt failed at repair. Together with
Medium starting sizes, Killer Hard went from 0.40 s to 0.25 s a board (26 attempts for 16 boards).

### Results per band

| Band | Boards | Cost per board | 45-rule steps | Cages | v1 for comparison |
|---|---|---|---|---|---|
| Easy, as laid out | 16 | 0.16 s | 0 | 30–36 (33) | 44 ms, 29–36 cages (32) |
| Easy, merged as far as tier 1–2 allows | 16 | 0.23 s | 0 | 26–33 (28) | |
| Medium, at most two 45s | 16 | 0.26 s | 1–2 (1) | 22–31 (28) | 0.23 s; 8 of 20 v1 boards fail the approved rule |
| Medium, three or four 45s | 16 | 0.35 s | 3–4 (4) | 25–30 (28) | |
| Hard | 16 | 0.25 s | 6–21 (8) | 22–27 (25) | 0.39 s, 3–19 45-rule steps (10) |
| Expert, 3+ tier-4+ steps | 16 | 10.7 s | 2–18 (10) | 21–28 (23) | 9.9 s on 8 boards; 6 of 14 seeds fail; 1–2 tier-4+ steps on those 8 |

The Hard boards stop hardening at the first board that qualifies, and the smallest had 6 45-rule
steps, so the Hard breather and stretch targets in the table need their own runs in Phase 3.

Killer Medium boards need their 45 early: the first wall comes with 52–81 squares open (median 80).
Adding "first wall at 60 or fewer open squares" as a rule gave boards whose first 45 comes after
21–68 placements (median 26), at 4.9 s a board.

### Expert

Cost by the number of tier-4+ steps required, with the new method (16 boards each):

| Required | Cost per board | Tier-4+ steps | Hardest step |
|---|---|---|---|
| 1+ | 3.5 s | 1–8 (1) | AIC 6, naked quad 4, W-Wing 3 |
| 2+ | 7.4 s | 2–9 (3) | AIC 9, naked quad 3 |
| 3+ | 10.7 s | 3–9 (4) | AIC 11, XY-chain 2 |
| 5+ | 20.1 s | 5–9 (6) | AIC 14, XY-chain 2 |

With repair failures gone, 83–89% of attempts end with every merge failing while the board still
needs no tier-4 step: the 45 rule and cage arithmetic solve most fully merged layouts. Expert boards
are the minority of merged layouts that need fish, wings, colouring, quads or chains. In paired runs
of 12 boards, these made no clear difference: trying 30 merges per round instead of 10 (9.7 s
against 10.8 s), a random walk over solvable merges that keeps the best board (9.9 s with and
without), and snakier or more compact cages (9.6 s, 10.6 s). Allowing 7-cell cages and dropping the
size guard were slower (13.4 s each against 10.8 s).

The breather, standard and stretch boards don't need separate runs. A pool made with the 2+ rule
split 6 / 6 / 4 into exactly 2, 3–4 and 5+ tier-4+ steps (16 boards, 7.4 s each). Filling a quarter
breathers, most standard and a sixth stretch from such a pool takes about 1.5 pool boards per kept
board, so about 11 s a board.

Most failed Expert attempts end as fully merged tier-3 boards. The ones without one-cell cages meet
the Hard rule, so a generator that fills several packs at once could keep them as Hard boards (not yet
measured).

### Cage sizes

| | Cages per board | Sizes over all boards | Mean size | 6-cell cages per board |
|---|---|---|---|---|
| v1 Expert (29 boards) | 22–28 (26) | 2:285 3:226 4:139 5:61 6:40 | 3.1 | 0–4 (1) |
| new Expert, 3+ (16 boards) | 21–28 (23) | 2:102 3:113 4:91 5:61 6:14 | 3.4 | 0–2 (1) |
| new Expert without the guard (12 boards) | 20–27 (24) | 2:81 3:80 4:53 5:50 6:18 | 3.4 | 0–3 (2) |

The guard (at most two 6-cell cages, none larger) rarely binds. One-combination cages stay at 0–4 per
board (v1: 0–3).

## Queens

Per attempt, generating a board and profiling it takes 0.3 ms (6×6) to 2.2 ms (10×10), and 32–91% of
attempts give a unique board. Counts below are out of 2,000 attempts (1,500 at 9×9, 1,000 at 10×10).

| Size, region style | Tier 1–2 | Tier 3 | Tier 4 | Tier 5 | Steps at the top tier |
|---|---|---|---|---|---|
| 6×6, Easy | 1,628 (1,188 with a tier-2 step) | 178 | 0 | 23 | |
| 7×7, Medium | 1,146 | 396 | 16 | 56 | tier 3: one on 138, two on 81 |
| 8×8, Medium | 825 | 427 | 27 | 66 | tier 3: one on 137, two on 84, three or four on 116 |
| 9×9, Hard | 309 | 338 | 51 | 63 | tier 4: one on 44, two on 7 |
| 9×9, Expert | 281 | 305 | 62 | 63 | tier 5: one on 15, two on 12, three to five on 20, six to eight on 7, nine or more on 9 |
| 10×10, Expert | 92 | 149 | 42 | 37 | tier 5: one on 9, two on 10, three to five on 5, six to eight on 9, nine or more on 4 |

Queens has four ideas: the last cell (a row, column or region with one cell left), touching (a
queen on a cell would knock out every cell of some region or line), counting (n regions confined to
n lines, or the reverse) and contradiction ("what if": place a queen, follow the forced moves, find a
dead end). The tiers order them, but tier 3 and tier 4 split counting by its size: a count of 2 is
tier 3, a count of 3 or more tier 4, and a region confined to one line (a count of 1) is tier 2.
Measured over the same sizes (2,000 attempts each, 1,500 at 9×9, 1,000 at 10×10):

| Measure | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
|---|---|---|---|---|
| States where no row, column or region says anything on its own (median share) | 7–11% | 28–38% | 38–47% (8×8 and up) | 50–53% |
| Boards needing the mixed touch step | none | 95–97% | 82–100% | 75–98% |
| Boards needing a count of 2 | none | 33–67% | 45–57% | 40–70% |
| Stuck at 3+ separate points | none | 6–10% | 21–25% (8×8 and up) | 39–50% |

- What separates Queens boards is how often nothing on the board says anything on its own, more than
  the size of the count. Tier-3 boards are mostly about touching (95–97% need it), and only 33–67%
  need even a count of 2.
- The longest contradiction chain is one forced move on 79% (10×10) to 97% (8×8) of tier-5 boards, so
  contradiction difficulty comes from how often it's needed.
- So the approved bands use three ideas: the basics (Easy), touch and counting (Medium and Hard, which
  differ by how often you get stuck), and contradiction (Expert). Medium is stuck once or twice; Hard
  is stuck at three or more points, about 1 in 10 tier 3–4 boards.

Costs per board for the approved sub-targets: Medium about 4 ms (7×7, stuck once), 3 ms (8×8, once or
twice) and 10 ms (8×8, twice); Hard about 27 ms (8×8, three times), 46 ms (9×9, three or more) and
0.26 s (9×9, four or more); Expert about 0.16 s (9×9, two contradictions), 0.1 s (9×9, three to five)
and 0.24 s (10×10, six to eight). The cap of 8 contradictions removes 14% of 9×9 tier-5 boards and
11% at 10×10; v1 Expert has a board with 25.
- Twins under rotation or reflection: none in the v1 packs, and none among 1,000 generated 6×6 and
  1,000 7×7 Easy boards. The pack builder will still drop them; the check costs microseconds.

## Speed

The full build (12 bands × 100 boards, pools of 150) took 12 minutes on 8 workers, 10.4 of them
for Killer Expert: about 5,000 worker-seconds for 157 seeds, or 32 s a seed, against about 15 s a
board in single-process benches. Other jobs shared the machine during the run (load average about 7
before it started).

Shawn decided that boards are generated on a computer ahead of time and shipped in packs, so phone
speed doesn't constrain the generators. They stay pure, synchronous per board and seeded through `rng.ts`,
and every pack entry records its seed and generator version, so any board can be made again.

Changes that cut generation time: the Killer cage memo (2.4–2.9× per solve); skipping the auto-note
scan inside generators (6–7× per Killer profile); and limiting a check to the band's techniques,
which makes a tier-1–3 solve of a v1 Classic Expert board 0.65 ms against 4 ms with every technique.
Checks also stop as soon as a limit is passed (`profileSudoku`'s `stop`); that saving wasn't
measured. Reusing solver work between edits beyond the cage memo wasn't tried: a removed given or a
merged cage changes which step the solver picks, so most of a solve would need redoing.

## Pool and select

Each seed draws its sub-target first, so a pack's mix of breathers and stretches is set by design,
and the generator aims at that sub-target. A selection pass over a pool of about 1.5× the pack then
caps any one hardest-step technique at about 40% of the pack. Classic Expert needs it most: AIC is the
hardest step on 58% of qualifying boards and XY-chain on 33%. The no-chain breathers fill a quarter
of the pack, which leaves the AIC cap reachable with a pool of 1.5×. Killer Expert is similar (AIC
on 11 of 16 boards at 3+). For Killer Expert the same pool also supplies the sub-targets, by count
(Killer section). This pass is designed and has not been run yet.

## Prior art

Sources were read directly where possible (source code, PDFs). Fuller notes with quotes, and the
claims that couldn't be verified, are in `generator-prior-art.md`.

- **Simon Tatham's Solo** removes a clue only if a difficulty-capped solver still solves the grid,
  then keeps the board if its grade equals the target: the brief's stripping with the solver as the
  check. Its Killer mode starts from 2-cell cages and is written to merge them while the grade
  allows; in the released code the merge list counter is never incremented, so the merge step never
  runs (from reading the code, not running it).
  [solo.c](https://sources.debian.org/data/main/s/sgt-puzzles/20250730.a7c7826-1/solo.c)
- **HoDoKu** generates, rates and rejects. Its level is the higher of the hardest step's level and
  the level its summed step scores imply, and it rejects boards whose total is below the previous
  level's ceiling: a frequency rule like this proposal's Expert rule.
  [SudokuSolver.java](https://github.com/PseudoFish/Hodoku/blob/master/src/solver/SudokuSolver.java)
- **QQWing** grades by the hardest technique class and puts pointing, box/line reduction and pairs in
  one "Intermediate" class. [qqwing.cpp](https://github.com/stephenostermiller/qqwing/blob/main/src/cpp/qqwing.cpp)
- **Sudoku Explainer** rates a puzzle by its hardest step; its generator rejects until the rating
  falls in a range. [Solver.java](https://github.com/SudokuMonster/SukakuExplainer/blob/master/diuf/sudoku/solver/Solver.java)
- **SudokuWiki** (Andrew Stuart) rejects a puzzle that is "trivial all the way through except for one
  very tough bottleneck", and since October 2025 weights each step by the candidates left on the
  board. [Creation and grading](https://www.sudokuwiki.org/Sudoku_Creation_and_Grading.pdf),
  [Grading puzzles](https://www.sudokuwiki.org/Print_Grading_Puzzles)
- **Radek Pelánek** compared rating metrics with mean human solving times on two puzzle sites
  (1,820 puzzles). The hardest step correlates at r = 0.70 and 0.86. Moves available per step
  ("dependency", the mean over the first 20–30 steps) is weaker overall (0.67, 0.69) but the best
  metric among singles-only puzzles (0.73, 0.78, against 0.55, 0.28 for the hardest step), and
  combining metrics reaches 0.84 and 0.95. Givens count: 0.25 and 0.27 overall, 0.22 and 0.34 among
  singles-only puzzles. Neither paper covers generation. [arXiv 1403.7373](https://arxiv.org/pdf/1403.7373),
  [FLAIRS 2011](https://www.fi.muni.cz/~xpelanek/publications/flairs-sudoku.pdf)
- **Queens** is 1-star Star Battle, which already forbids queens touching diagonally. Three public
  generators grow regions from planted queens: one repairs uniqueness as Nonet does, one rejects
  boards that aren't unique, and one doesn't check. None of them grades by technique.

## Notes on grading

No tier or rating changes. Two existing behaviours matter for the bands:

- v1's Killer grading sends tier 3 with rating 3.2 or less to Medium, so an X-Wing (3.2) counts as
  Medium. No v1 Medium board uses one. The approved rules read technique ids and house counts from the
  profile, so an X-Wing makes a board Hard.
- The full solver can take a different path from a capped check. Inside a Killer check limited to
  tier 2, a hidden pair (3.4) may be the next step where the full solver would first take a 45-rule
  step (3.0); one v1 Killer Easy board teaches a 45 this way. The final check therefore re-solves with
  every technique.

## Measuring boards

`src/engine/profile.ts` replays the hint engine's easiest-first solve and records
for every board: steps per tier and per technique, the hardest step, steps past the basics, tier-4+
steps, walls and the first wall, what scanning offers at each state (placements in Sudoku, with
Killer scanning the candidates auto-notes would show; rows, columns and regions that tell you
something on their own in Queens), early options, 45-rule steps over one house and over two or more,
Killer cage stats (count, sizes, one-combination cages, cages inside a box or a line), and Queens size
and region sizes. In Killer, scanning almost never offers a placement (median early options 0.1 in
Easy, 0 above), so 45-rule counts and cage stats describe Killer boards instead.

`npm run stats` profiles every pack, v1 beside v2. On the v1 packs it reproduces the numbers measured
before this phase: Classic Medium boards hit one wall (53 boards) or two (7); the first wall comes at a
median of 38 empty squares in Medium and 32 in Hard; 41 of 60 Medium boards stay within 3 steps past
singles; 13 of 60 need pairs; 31 of 60 Hard boards have exactly one tier-3+ step; 30 of 60 Classic
Expert and 3 of 29 Killer Expert boards have 3+ tier-4+ steps; 30 of 60 Killer Medium boards use the
45 rule at most twice; 26 of 60 Queens Medium boards have at most two tier-3 steps.

`contentId` (same commit) names a board by what the player sees: the cyrb53 hash of the givens, the
cage map and sums with cages relabelled in a fixed order, or n and the relabelled regions. Golden
tests pin six v1 boards.
