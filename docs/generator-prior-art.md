# Prior art for difficulty-targeted puzzle generation (Classic, Killer, Queens)

Written 2026-10-14 for the Nonet generator redesign: the literature review behind the Prior art
section of `generator-research.md`. Source code was read from shallow clones and PDFs were read as
text; the downloads are not kept.

## How to read this file

Every claim has a URL and a short quote. Evidence labels:

- **[RAW]** I read the primary text myself: PDF text via `pdftotext`, or a source file from a cloned repo or a
  Debian source mirror. Quotes are verbatim.
- **[FETCH]** The page came back through the WebFetch tool, which summarises with a small model. The quotes are
  as returned. I could not diff them against raw HTML (several hosts put curl behind a Cloudflare challenge),
  so treat the wording as probable, not certain.
- **[SEARCH]** Seen only in a search-result summary, not at the source.
- **UNVERIFIED** Could not be confirmed. Listed again in section 10.

Source provenance for code I read (all cloned shallow):

| Project | What I read | Version |
|---|---|---|
| HoDoKu | GitHub fork `PseudoFish/Hodoku` (the SourceForge original is not browsable from here) | commit `c37fe90`, 2020-01-23; headers still say "Copyright (C) 2008-12 Bernhard Hobiger" |
| Sudoku Explainer / serate | GitHub fork `SudokuMonster/SukakuExplainer` (gsf's "serate" patch on Juillerat's SE) | commit `362854e`, 2021-09-22; headers still say "Copyright (C) 2006-2007 Nicolas Juillerat" |
| Simon Tatham's Solo | `solo.c` in Debian package `sgt-puzzles` | 20250730.a7c7826-1 (also checked 2017, 2019, 2023 builds for one detail) |
| QQWing | `stephenostermiller/qqwing` | commit `6048c90`, 2021-03-30 |
| l2sg | `rafaelfassi/l2sg` | commit `3f30671`, 2021-06-06 |

Juillerat's original SE page (`diuf.unifr.ch/people/juillera/Sudoku/Sudoku.html`) no longer resolves
(ENOTFOUND) and web.archive.org is blocked for the fetch tool, so everything about SE below comes from the
fork's code plus Pelánek's description of it.

---

## 0. Verdicts at a glance

| # | Lead | Verdict |
|---|---|---|
| 1 | HoDoKu | Generate (random full grid, dig while unique), rate with the logical solver, **reject** unless the level matches. Level = max(hardest step's level, level implied by summed score). The generator also applies a **score floor** and an early abort. No steering. |
| 2 | Sudoku Explainer | Puzzle rating = hardest step along an easiest-first solve path. serate adds "pearl" (hardest step up to the first placement) and "diamond" (up to the first candidate elimination). Generator is pure rejection between min/max rating. |
| 3 | SudokuWiki | Old scheme: step points x "rounds" weighting, plus heuristics that reject "easy with one very hard bottleneck". New scheme (1 Oct 2025): sum of step points, each scaled by **candidate density** at that step, then `Log5(score) x 2`. |
| 4 | Pelánek | **"As much as the hardest technique" is not what the papers say.** Dependency (available moves per step) alone is the *weakest* model-based metric overall (r 0.67 / 0.69 vs Serate 0.70 / 0.86) but is the *best* metric on singles-only puzzles (0.73 / 0.78 vs Serate 0.55 / 0.28) and is partly orthogonal, so combining lifts r to 0.84 / 0.95. Neither paper addresses generating to a target difficulty. |
| 5 | Other research | Givens count is a weak lever everywhere I looked. No other paper gives a usable generator. Hunt/Pong/Tucker: UNVERIFIED. |
| 6 | Killer | Open-source write-ups are thin. Tatham's Solo has the closest design (small cages first, merge while the solver still grades at target) but the merge routine looks inert in released code. Stuart gives cage-shape rules. No published cage-size targets per band. |
| 7 | Queens / Star Battle | Generators exist (grow regions from planted queens, check or repair uniqueness). **None grades difficulty by technique.** Star Battle already forbids touching, so 1-star Star Battle is Queens. |
| 8 | General strategy | Dig-while-unique is universal; solver-in-the-loop stripping (Tatham) and clue hill-climbing (l2sg) are the only steered variants found. 17 is the proven minimum clue count. |

---

## 1. HoDoKu (Bernhard Hobiger)

### 1.1 How the generator targets a level: generate, rate, reject

Step A, make a candidate. `SudokuGenerator` is a port of gsf's generator, and it digs holes in random order,
optionally in 180-degree pairs, undoing any removal that breaks uniqueness.

> "This code is actually a Java port of code posted by Glenn Fowler in the Sudoku Player's Forum (http://www.setbb.com/sudoku)."
> "...generates a valid puzzle by deleting cells. If a deletion produces a grid with more than one solution it is of course undone."

- [RAW] https://github.com/PseudoFish/Hodoku/blob/master/src/generator/SudokuGenerator.java (file header, `generateInitPos`).
- It stops at 17 clues at the lowest: `int maxPosToFill = 17; // no less than 17 givens`.

Step B, rate and accept or reject. The background generator loops: make a candidate, solve it logically, keep it
only if the resulting level equals the requested level.

```java
sudoku = creator.generateSudoku(true);
...
boolean ok = solver.solve(level, solvedSudoku, true, null, false, Options.getInstance().solverSteps, mode);
...
if (ok && containsTrainingStep && (solvedSudoku.getLevel().getOrdinal() == level.getOrdinal() || mode == GameMode.LEARNING)) {
```

- [RAW] https://github.com/PseudoFish/Hodoku/blob/master/src/generator/BackgroundGenerator.java
- Budget: `MAX_TRIES = 20000` ("Maximal number of tries, when called from a {@link BackgroundGeneratorThread}."). The
  `true` passed to `solve` is `rejectTooLowScore` (below). `generateSudoku(true)` means the dig is symmetric.
- There is no steering. The only feedback is accept or reject. This is also what the docs say: a puzzle that
  is "too easy" is discarded. [FETCH] https://hodoku.sourceforge.net/en/docs_cre.php:
  "the newly created sudoku is discarded."

### 1.2 How the level is assigned: hardest step and summed score, whichever is higher

In `SudokuSolver.solve` and `getHint` ([RAW] https://github.com/PseudoFish/Hodoku/blob/master/src/solver/SudokuSolver.java):

- Each applied step adds its base score (`score += solverSteps[i].getBaseScore();`) and lifts the running level to
  the step's level if that is higher.
- After the solve, the level is promoted by score. The original comment is German:
  `// wenn der Score größer als der MaxScore der aktuellen Stufe, dann wird das Puzzle höhergestuft.`
  (my translation: if the score is above the current level's max score, the puzzle is moved up a level), followed by
  `while (score > level.getMaxScore()) { level = Options.getInstance().getDifficultyLevel(level.getOrdinal() + 1); }`.
- **Early abort:** `// Wenn das Puzzle zu schwer ist, gleich abbrechen` (my translation: if the puzzle is too hard, stop at once):
  `if (level.getOrdinal() > maxLevel.getOrdinal() || score >= maxLevel.getMaxScore()) { return null; }`.
- **Score floor** (this is the part worth stealing): with `rejectTooLowScore` set, a puzzle whose level is above
  Easy is rejected when its total is below the *previous* level's max score.
  `// umgekehrter Fall: Das Puzzle passt vom Level, aber der Score ist zu niedrig` (my translation: reverse case, the
  level fits but the score is too low), then `if (score < Options.getInstance().getDifficultyLevel(level.getOrdinal() - 1).getMaxScore()) return false;`.

Docs say the same thing in prose [FETCH] https://hodoku.sourceforge.net/en/docs_cre.php:

> "The level of a sudoku cannot be smaller than the level of the hardest step contained in it's solution"
> "if the score of a sudoku is greater than the maximum score of the level of the hardest step ... the difficulty level of the sudoku is determined only by it's score"
> "sudokus containing many hard steps are more difficult than sudokus with only a few hard steps."

Default level ceilings in `Options.DEFAULT_DIFFICULTY_LEVELS` [RAW]
(https://github.com/PseudoFish/Hodoku/blob/master/src/sudoku/Options.java):

| Level | Max score |
|---|---|
| Easy | 800 |
| Medium | 1000 |
| Hard | 1600 |
| Unfair | 1800 |
| Extreme | `Integer.MAX_VALUE` |

Caveat: the file also holds a commented-out older set (Easy 600, Medium 1500, Hard 3500, Unfair 5000). I cannot tell
which set shipped in Hobiger's 2.2.0. **The 2.2.0 defaults are UNVERIFIED**; the fork's values are above. The docs
page says users set the maxima in Preferences and does not list defaults.

Selected default step scores and levels (parsed from `DEFAULT_SOLVER_STEPS`) [RAW]:

| Level | Techniques (score) |
|---|---|
| Easy | Full House 4, Naked Single 4, Hidden Single 14 |
| Medium | Locked Pair 40, Locked Candidates 50, Locked Triple 60, Naked Pair 60, Hidden Pair 70, Naked Triple 80, Hidden Triple 100 |
| Hard | Naked Quad 120, Hidden Quad 150, X-Wing 140, Swordfish 150, Jellyfish 160, Skyscraper 130, 2-String Kite 150, W-Wing 150, XY-Wing 160, XYZ-Wing 180, Remote Pair 110, BUG+1 100, Unique Rectangles 100, Empty Rectangle 120, Simple Colors 150, Multi Colors 200 |
| Unfair | Finned Swordfish 200, Sue de Coq 250, X-Chain 260, XY-Chain 260, Nice Loop 280, ALS-XZ 300, ALS-XY-Wing 320, Death Blossom 360, Franken X-Wing 300 |
| Extreme | Mutant fish 450+, Forcing Chain 500, Forcing Net 700, Templates and Brute Force 10000 |

### 1.3 Technique-targeted puzzles

Learning and Practising modes demand that the solve contains a step of a trained type
(`containsTrainingStep`, set when `step.getType().getStepConfig().isEnabledTraining()`); Learning drops the level match
(`|| mode == GameMode.LEARNING`) and Practising keeps it. The solver sets `acceptAnyway = true` once such a step
appears, so the level cap no longer rejects. The docs recipe for "puzzles with X": give technique X a
huge score, set it as Medium, raise the Medium ceiling, generate Medium, and everything lacking X is discarded
[FETCH]: "Every newly created sudoku will contain at least one of the changed steps." That is rejection sampling on
containment. It guarantees "used on the solver's own path", not "unavoidable".

### 1.4 Applies to Nonet / doesn't

- **Applies, strongly:** the two-part grade. Nonet's grade is "hardest technique tier". HoDoKu adds a summed
  score with promotion and a **minimum-score floor per level**. That floor is the direct precedent for
  Expert meaning advanced techniques are frequent. The Nonet analogue: a board with one tier-4 step in an otherwise easy solve
  is rejected from Expert because its total advanced work is too small. It is also a ready slot for breather / standard
  / stretch: each level is a score interval, so sub-targets are sub-intervals.
- **Applies:** early abort while rating (stop the solve as soon as level or score passes the target ceiling). This
  is the brief's speed item 6.
- **Applies:** accept-on-own-path semantics match Nonet's grade, which is also defined on one easiest-first path.
  Just don't describe it as "required".
- **Doesn't apply:** the numbers (800 / 1000 / 1600 / 1800, ad hoc per-step scores), and the lack of steering.
  HoDoKu's score is position-blind, so it has no notion of "later in the solve". The RNG is unseeded
  (`new Random()`), so nothing is reproducible per seed.

---

## 2. Sudoku Explainer (Nicolas Juillerat) and serate (gsf)

### 2.1 The rating is the hardest step on an easiest-first path

Code [RAW] https://github.com/SudokuMonster/SukakuExplainer/blob/master/diuf/sudoku/solver/Solver.java
(`getDifficulty`): at each iteration `getSingleHint()` returns the first hint found while asking the producers
in order (direct, indirect, chaining, ...). `SingleHintAccumulator` is documented as "Hints accumulator, that
accumulates a single hint (the first that is received) and then stops." Then:

```java
if (ruleDiff > difficulty) { difficulty = ruleDiff; ERtN = ruleName; ... }
...
hint.apply(grid);
```

So the puzzle rating (ER) is the largest single-step rating along that path. Pelánek says the same
([RAW] https://arxiv.org/pdf/1403.7373): "Serate metric Default metric used by the Sudoku Explainer tool [17]; it is a maximal difficulty of a used logic technique."

Original ratings, from the fork's hint classes (with the `revisedRating() == 0` branch) [RAW] and matching
Pelánek's Table 1 ("Hidden single 1.2 ... Naked Single 2.3 ... Pointing 2.6 ... Claiming 2.8"):

| Rating | Technique |
|---|---|
| 1.0 / 1.2 / 1.5 | Hidden Single (last empty cell in a house, per the `isAlone` comment / hidden in a block / hidden in a row or column) |
| 1.7, 1.9, 2.0 | Direct Pointing, Direct Claiming, Direct Hidden Pair |
| 2.3 | Naked Single |
| 2.5 | Direct Hidden Triplet |
| 2.6 / 2.8 | Pointing / Claiming |
| 3.0, 3.6, 5.0 | Naked Pair, Triplet, Quad |
| 3.2, 3.8, 5.2 | X-Wing, Swordfish, Jellyfish |
| 3.4, 4.0, 5.4 | Hidden Pair, Triplet, Quad |
| 4.2, 4.4 | XY-Wing, XYZ-Wing |
| 6.6 to 7.0 plus a length term | Forcing chains (`ForcingChainHint.getDifficulty`) |

Scale: it starts at 1.0. I found **no documented upper bound**. The community "potential hardest sudokus" tables
list ER up to 11.9 [FETCH] https://sw-amt.ws/sudoku/doc/_build/html/potential-hardest-sudokus.html ("up to 11.9"),
so "1.0 to 12" is a safer description than "1.0 to 11". The fork also has a `revisedRating` switch that moves
Naked Single from 2.3 to 1.6 and Hidden Pair from 3.4 to 2.9, a good illustration of how arbitrary the numbers are.

### 2.2 serate: ER, EP, ED

The usage text in the fork's `serate.java` [RAW]
(https://github.com/SudokuMonster/SukakuExplainer/blob/master/diuf/sudoku/test/serate.java):

> %r  The puzzle rating.  This is the highest ER of the methods leading to the puzzle solution.
> %p  The pearl rating.  This is the highest ER of the methods leading to the first cell placement.
> %d  The diamond rating.  This is the highest ER of the methods leading to the first candidate elimination.

(Each sentence is split over two consecutive `System.err.println` lines in the source, and each line ends with a
format-availability flag such as "(F)", which I dropped.) The flags `--pearl` and `--diamond` are documented as
"Terminate rating if the puzzle is not a pearl." and "...not a diamond.", implemented as an early exit in
`Solver.getDifficulty` (`else if (want != 0 && difficulty > pearl) { difficulty = 20.0; ... break; }`).
The README only names the three ratings; it does not define them (WebFetch of https://github.com/SudokuMonster/SukakuExplainer).

So the triple records **where** the hardness sits: ER = EP means the hardest step is already needed by the first
placement, and ER = ED means it is already needed by the first candidate elimination (my reading of the code; I did
not find a written definition of a "pearl puzzle").

### 2.3 Generator

`Generator.generate` [RAW] (https://github.com/SudokuMonster/SukakuExplainer/blob/master/diuf/sudoku/generator/Generator.java):

> "The implementation actually repeatedly generates random grids with the given symmetries until the difficulty is between the given bounds."

The dig removes symmetric cells and keeps the removal if `analyser.getCountSolutions(grid)` is 1. The fork adds include / exclude /
"not the max" technique filters in `Solver.analyseDifficulty`, which also aborts early:
`if (difficulty > max) break;`. Those filters look like fork additions, so don't credit them to Juillerat.

### 2.4 Known criticisms I could verify (there is no single "SE criticisms" source)

- Tool ratings are author-assigned: "This rating is provided by the tool developer, usually based on personal
  experience and common knowledge." ([RAW] Pelánek, https://arxiv.org/pdf/1403.7373).
- Max-only ratings cannot separate singles-only puzzles. On Pelánek's singles-only subset Serate scores r = 0.55 and
  0.28 against 0.73 and 0.78 for the dependency metric (section 4).
- Counting steps helps somewhat: Pelánek's linear model over technique counts ("Serate LM") beats plain Serate on
  fed-sudoku.eu (0.78 vs 0.70) and on the singles-only subsets (0.66 vs 0.28 on sudoku.org.uk), and ties it on the
  full sudoku.org.uk set (0.86).
- Cost: Henz and Truong note that SE 1.2 "is able to solve AI Escargot, but assessing its difficulty reportedly
  takes several minutes." ([RAW] https://www.comp.nus.edu.sg/%7Ehenz/publications/pdf/TAAI2009.pdf)
- The count of "difficult steps" depends on the path. The same paper, on the RMS method: "the choice of steps and
  their order greatly affects the number of steps needed."

### 2.5 Applies to Nonet / doesn't

- **Applies:** Nonet's grade is already ER-style, so the lesson is about what ER cannot see. ED/EP show a cheap way
  to add positional information (running maximum at the first placement / first step) with the early-exit trick.
- **Applies:** rejection with a `min`/`max` bound and an abort as soon as the running maximum passes `max`.
- **Doesn't apply:** the numeric scale, chain-length adders, Latin-square variants. SE's generator is
  unseeded (`new Random()`).

---

## 3. SudokuWiki (Andrew Stuart)

Two documents, two schemes, so date them:

- "Sudoku Creation and Grading", February 2007, updated 2012 and 2023: [RAW]
  https://www.sudokuwiki.org/Sudoku_Creation_and_Grading.pdf
- "Grading Puzzles", created 30 September 2025: [RAW, curl with a browser user agent]
  https://www.sudokuwiki.org/Print_Grading_Puzzles (that URL and https://www.sudokuwiki.org/Grading_Puzzles both
  returned 403 to the fetch tool).

### 3.1 Old scheme (PDF): opportunities and strategies, plus bottleneck rejection

> "Combining the frequency of opportunity with the necessary strategies gives us a score."
> "'Bottlenecks' occur if there are few or only one chance to make a correct deduction and these make a more difficult puzzle."
> "...there is a metric of difficultly, therefore, to be gleaned purely by counting the opportunities to solve at all stages of the game."

The worked example reports "Average Solving Rate: 2.524 cells per round" and a per-strategy table of candidates
removed, cells solved and points. For example "X-Wing : 7, 0, points: 175.0" and "Final Score: 587.2 * (646.0 /
1000.0) = 379.0" (points multiplied by a weighting factor based on how strung out the solve path is).

Quality standard 4, which is the clearest statement of the "bottleneck" rule:

> "The Sudoku should play to the grade through most of the solving process. Normally, even in tough puzzles, you might solve ten cells easily before hitting a wall and the last ten or fifteen cells will solve trivially. But a puzzle should be rejected if it is trivial all the way through except for one very tough bottleneck."

Grade membership rules (his words): Kids "cannot require any note taking"; Gentle: "all solutions can be shown to only
require 'slice and dice'" (hidden singles); Moderates "may require simple strategies as Naked and Hidden Pairs and
Triples"; "Higher grades will entail more sophisticated strategies."

Calibration against humans: self-reported solve times from his daily competition ("2000 to 3000 correct submissions
each day"; time bands from <=5 to >120 minutes). "...about 10% of solvers are struggling with gentles and 10% are finding some
diabolicals easy"; "Only the Tough's seem to have a spread suggesting they vary in difficulty the most."

### 3.2 New scheme (from 1 October 2025): candidate density

> "My recent insight in assessing the grading system is to look at candidate density - the total number of candidates on the board at any one step."
> "The factor F is multiplied by the points for that strategy."
> "Now the sum of the scores for each step is the puzzle score."
> "9x9: Log5 (score) * 2"

His worked table runs F = C / 727 x 20 from 6.0 (219 candidates, step 2) down to 0.2 (8 candidates, step 30). Singles
are damped: "I further reduce their contribution by ignoring how many are found in the step and multiply by 1 and 2 for Naked
and Hidden respectively." Per-step points (before F) include Naked Pair 5 x F, Hidden Pair 10, Pointing Pairs 20,
X-Wing 30, Y-Wing 50, Sword-Fish 50, XYZ Wing 60, X-Cycle 60 + chain length, Jelly-Fish 80, Finned X-Wing 160,
Sue-de-Coq 180, Cell Forcing Chain 180 + chain length, Quad Forcing Chain 200 + chain length.

Bands, 9x9: Kids <3, Gentle 3 to <4, Moderate 4 to <5, Tough 5 to <7, Diabolical 7 to <9, Extreme 9+. Killer: Gentle
<8.8, Moderate 8.8 to <9.2, Tough 9.2 to <9.6, Diabolical 9.6 to <10, Extreme 10+. "Most randomly produced puzzles will
be easy with extremes being the fewest."

Old-scheme heuristics, as he describes them: "filtering rules which removed puzzles from the stock pool or promoted
or demoted a puzzle by a grade. The most important one was recognising easy puzzles with a very hard bottleneck."
And on strategy-versus-grade: "the use of a particular strategy does not immediately make that puzzle belong to the
grade the strategy is grouped in ... in the majority of cases the hardest strategy will be in the same group as the
grade, but not always."

### 3.3 How he generates (PDF)

Fill a grid by place-and-solve with logical strategies, then dig symmetrically: "For the first twenty or so
subtractions four numbers can be removed. Beyond that ... two at a time are subtracted. A low target of 20 clues is
set and by 30 the remaining numbers are tested individually ... over a large run I get a set of puzzles where the
number of clues is a bell-curve centered on 27." Then grade. Clue discipline: "the average number of clues hangs around
27 and is never more than 30. Nikoli ... states as part of his definition that the number of clues should not exceed
32." He also notes that "about 1 in every five thousand randomly produced puzzles" defies logical solution, which is
why a logical-solvability filter matters.

### 3.4 Counting steps per strategy

Yes, both schemes count uses per strategy (old: candidates removed and cells solved per strategy; new: one score per
step, ignoring how many candidates each step removes: "if you have found a pattern then it doesn't really
matter how many candidates are removed").

### 3.5 Applies to Nonet / doesn't

- **Applies, strongly:** the bottleneck rule (standard 4 and the 2025 heuristic) is exactly the failure mode of a
  generator that only checks the hardest tier. It supports requiring several advanced steps for Hard and Expert, and
  rejecting a single stray tier-3 or tier-4 step.
- **Applies:** candidate density gives a principled way to say "advanced step, but late". Weighting a step by the
  number of candidates (or empty cells) left when it fires discounts late steps and boosts early ones. That matches
  the brief's Medium rule "first wall late (≤ ~28 empty cells)". It also yields a continuous within-band score for
  breather / standard / stretch sub-targets.
- **Applies (Killer):** cage rules in section 6.
- **Doesn't apply:** the exact point values, the log scale, and the Kids / Gentle split (Nonet's scan view already
  gives that).

---

## 4. Radek Pelánek: human solving-time data and the "dependency" metric

Papers, both read in full [RAW]:

- FLAIRS-24 (2011), "Difficulty Rating of Sudoku Puzzles by a Computational Model": https://www.fi.muni.cz/~xpelanek/publications/flairs-sudoku.pdf
- arXiv:1403.7373 (2014), "Difficulty Rating of Sudoku Puzzles: An Overview and Evaluation": https://arxiv.org/pdf/1403.7373

### 4.1 What was measured

Mean human solving time per puzzle, from web portals:

- fed-sudoku.eu (2008): 1,089 puzzles, mean 131 solvers per puzzle, per-user times.
- sudoku.org.uk (2006 to 2009): 731 usable puzzles (of 1,331), mean 1,307 solvers, summary means only.
- czech-sudoku.com: move-by-move logs for about 60 users on 15 puzzles (used to test the order in which cells get filled).

> "As a measure of problem difficulty for humans we use the mean solution time."
> "In most cases the correlation coefficient is between 0.85 and 0.95." (this one compares the model's cell-fill order with humans', not solving time)

All correlations below are Pearson r against mean solving time.

### 4.2 Correlations (arXiv Table 3; FLAIRS Table 1 adds the singles-only columns)

| Metric | fed-sudoku all | fed-sudoku singles-only | sudoku.org.uk all | sudoku.org.uk singles-only |
|---|---|---|---|---|
| Number of givens | 0.25 | 0.22 | 0.27 | 0.34 |
| Backtracking steps | 0.16 | | 0.25 | |
| Serate (hardest step) | 0.70 | 0.55 | 0.86 | 0.28 |
| Serate LM (linear model over technique counts) | 0.78 | 0.60 | 0.86 | 0.66 |
| Fowler's | 0.68 | 0.53 | 0.87 | 0.64 |
| Refutation sum | 0.68 | n/a | 0.83 | n/a |
| **Dependency** | 0.67 | **0.73** | 0.69 | **0.78** |
| Combined RD (refutation + dependency) | 0.74 | n/a | 0.88 | n/a |
| Combined SFRD (Serate + Fowler + refutation + dependency) | **0.84** | 0.75 | **0.95** | 0.83 |

The Dependency k-sweep (arXiv Table 2): all puzzles peak at 0.67 (fed-sudoku, k = 20) and 0.76 (sudoku.org.uk,
k = 30 to 35); singles-only peaks at 0.74 and 0.80.

### 4.3 The computational model ("SiSuS")

> "a 'Simple Sudoku Solver' (SiSuS) model ... with two hard-wired logic techniques (hidden single, naked single) of equal difficulty which uses refutation score when the basic techniques are not applicable"

Repeatedly: take the simplest technique that makes progress, pick one of its applications at random, apply it.
When no single applies, a "refutation score" (how many simple steps are needed to refute each wrong candidate,
estimated by randomised runs) stands in for advanced techniques, on the argument that "many advanced logic
techniques are in fact 'short-cuts' for a search". Cell-fill order from the model vs 15 human-played puzzles:
Spearman 0.85 to 0.95 for most puzzles, worse for very easy (many equally good orders) and very hard ones.

### 4.4 Dependency among steps, and singles

Yes, explicitly:

> "An important aspect of human CSP solving is 'the number of possibilities leading to a next step' in each step."
> "...it makes a big difference if we can in the first step apply a logic technique at 10 different cells or only at just 2."

Definition: in every step of the randomised SiSuS run, count how many cells admit a simple technique (naked or hidden
single); average over many runs; take "the mean over the first k steps" with k "generally ... between 20 and 30".
Late steps are dropped on purpose: "in the second half of the solution there are usually many possibilities for all
problems; i.e., these steps probably do not contribute to the difficulty."

Naked versus hidden: the model treats them as one class of "equal difficulty". SE rates Hidden Single 1.2 and Naked
Single 2.3 (his Table 1), and he does not argue for or against that.

### 4.5 Is the claim that move availability matters as much as the hardest technique supported? Partly.

The abstract says "there are two sources of the problem difficulty: complexity of individual steps ... and structure
of dependency among steps." But the evaluation says:

> "Dependency metric, if used alone, is the weakest metric from the model based. But it works well on simple Sudokus, where it works better than the other metrics (since these cannot efficiently discriminate between simple Sudokus). Moreover, the dependency metric is partly orthogonal to other metrics, and thus it enables us to get improved results by using a combined metric."

(A footnote marker after "simple Sudokus" is omitted; the footnote defines them as puzzles solvable by hidden and
naked singles only.)

Reading of the numbers:

- Across the full difficulty range, hardest-step wins (Serate 0.70 / 0.86 vs Dependency 0.67 / 0.69).
- Among singles-only puzzles (Nonet's Easy regime) availability wins by a wide margin (0.73 / 0.78 vs 0.55 / 0.28).
- Adding it to the others gives the best result of the whole study (0.84 / 0.95).
- One more caution from the paper: "Results of difficulty rating are very dependent on the difficulty range of used problem instances." Inside a narrow band, correlations will be lower and finer metrics matter more.

So: "as much as" is too strong overall; "the main lever inside a singles-only band, and independent extra information elsewhere" is what the data support.

### 4.6 Generating puzzles to a target difficulty

**Not addressed.** FLAIRS names generation only as related work ("algorithms for generating puzzles (O'Sullivan and
Horan 2007; Fowler 2009)"). The arXiv text says rating by counting technique use "is the approach used by most Sudoku
generators" and goes no further. Both papers also note that other published difficulty studies compared against a
newspaper's label, "just another rating provided by a computer program (nearly all published puzzles are generated
and rated by a computer)".

### 4.7 Related work on other puzzles

Pelánek's Sokoban, Rush Hour and "Replacement puzzle" work (Jarušek and Pelánek, FLAIRS 2011, "What determines
difficulty of transport puzzles?") finds, in the abstract's words as paraphrased by the search tool, that difficulty
comes mainly from state-space structure that static metrics such as state-space size or solution length do not capture
[SEARCH] https://www.ics.muni.cz/en/research/publications/941424 (PDF: https://cdn.aaai.org/ocs/2518/2518-11200-1-PB.pdf,
not opened). The same arXiv paper reports Nurikabe, where a
constraint-relaxation metric (r = 0.9) beat the technique-model metric (r = 0.8) on 45 puzzles. "Tilt maze" and
"Problem solving metrics": **not checked**.

### 4.8 Applies to Nonet / doesn't

- **Applies, Easy band:** the cheapest evidence-backed knob for "breather vs stretch" inside a singles-only band is
  the mean number of available placements over roughly the first 20 to 30 steps of a replay (the brief's "how many
  moves are available at each step, scan view"). Low mean = bottleneck-heavy = stretch.
- **Applies, Expert "frequent":** counts of advanced steps carry some information the maximum does not. Serate LM
  beats plain Serate on fed-sudoku.eu (0.78 vs 0.70) and on both singles-only subsets (0.60 vs 0.55, 0.66 vs 0.28),
  and ties it on the full sudoku.org.uk set (0.86 vs 0.86). Modest evidence, not a large effect.
- **Applies:** don't use givens as a difficulty lever (r = 0.25 to 0.27).
- **Applies, position:** Pelánek's model drops the second half of the solve because there are "usually many
  possibilities for all problems" there, so a wall late in the solve should cost the solver less than one in the first
  half (my reading). That supports the brief's aim of moving Medium's first wall later: v1 Medium walls sit at a median
  of 38 empty cells, earlier than Hard's 32.
- **Doesn't apply:** he studied only classic Sudoku, timed humans on web portals; Nonet has no human timing data yet.
  Telemetry of per-board solve time is the missing calibration. His advanced-technique costs come from SE's author
  ratings, and the refutation score is a randomised proxy, not something to port.

---

## 5. Other research on human difficulty

| Source | Verified finding that bears on generation | Label | Applies to Nonet? |
|---|---|---|---|
| Simonis, "Sudoku as a constraint problem" (2005), https://ai.dmi.unibas.ch/_files/teaching/fs21/ai/material/ai26-simonis-cp2005ws.pdf | Measures difficulty by which propagation schemes solve a puzzle without search, and says the measure "seems to correlate well with grades". Newspaper grades do not map cleanly onto given counts (table below). "Most of the published puzzles are not locally minimal, they often contain more than 10 redundant hints." Also: "In discussion boards, people often complain about the arbitrary way this difficulty is assigned." | RAW | Partly. Rating by the weakest propagation scheme that solves the puzzle is the same idea as a technique-tier cap, which Nonet already has. No generator. Useful as evidence that grade labels in the wild are inconsistent. |
| Ercsey-Ravasz and Toroczkai, "The Chaos within Sudoku" (2012), https://arxiv.org/pdf/1208.0370 | Dynamical-system "escape rate" as a difficulty scale (eta = -log10 kappa; easy 0 to 1, medium 1 to 2, hard 2 to 3). Clue count: "as a general rule of thumb, the fewer clues are given, the harder the puzzle, however, this is not universally true"; the tested 17- and 18-clue puzzles "are actually easier (1.2 < eta < 2.4) than the hardest instances with more d = 21, 22 clues." | RAW | No as a method (continuous-time solver, unrelated to techniques, Classic only). Yes as a caution against any given-count proxy. |
| Henz and Truong, "SudokuSAT" (TAAI 2009), https://www.comp.nus.edu.sg/%7Ehenz/publications/pdf/TAAI2009.pdf | "A common approach for generating difficult Sudoku puzzles is generate-and-test: generate large numbers of promising candidate puzzles, and test each of these candidates for the Uniqueness Property and difficulty." Lists five rating methods, one of which (RMS, "Ravel Minimal Step") counts "the minimal number of 'difficult steps'". | RAW | Partly. Confirms generate-and-test as the norm. RMS shows that counting hard steps is path-dependent, which is why Nonet should define counts on its one canonical easiest-first path. |
| McGuire, Tugemann and Civario (2012/2013), https://arxiv.org/pdf/1201.0749 | "We have performed an exhaustive computer search for 16-clue sudoku puzzles, and did not find any, thus proving that the answer is indeed 17." | RAW | Only as a hard floor for stripping. Nonet's bands sit far above it (v1 Classic Easy 36 to 37 givens, Medium 27 to 30 per the brief; its `cmedium.mts` prototype reaches 24 to 31). |
| Mantere and Koljonen, "Solving, rating and generating Sudoku puzzles with GA" (CEC 2007), https://ieeexplore.ieee.org/document/4424632 | Abstract only: a GA is used to rate difficulty and to generate. I found nothing on how a target difficulty is steered. Pelánek's criticism applies: such papers correlate with a source's label, not with human data. | SEARCH | No. Metaheuristic, not technique-based, and no usable detail. |
| Lee, Goodwin and Johnson-Laird, "The psychological puzzle of Sudoku" (Thinking & Reasoning 14(4), 2008, doi 10.1080/13546780802236308) | Tactic difficulty tracks "relational complexity" (number of constraints a tactic depends on); harder puzzles need a two-step tactic (infer candidates, then eliminate with them). Only secondary summaries seen, e.g. https://www.bps.org.uk/research-digest/sudoku-puzzles-show-were-all-capable-deductive-reasoning | SEARCH, secondary only | Weak support. It is the psychology behind ordering techniques by how many constraints they juggle, which is what Nonet's tier ladder encodes. Nothing on generation. |
| Higgins, Greenberg and Huang (2025), https://emerginginvestigators.org/articles/24-144 | On 6,000 puzzle-sudoku.com puzzles in three tiers, clue-based features reach 44% test accuracy and adding eight solving-strategy features reaches 78%. Student-research journal, labels come from the site, so **low weight**. | FETCH | Weak corroboration that strategy features beat clue features. |
| "Difficult Sudoku Puzzles Created by Replica Exchange Monte Carlo Method", https://arxiv.org/abs/1303.1886 | Defines difficulty as a spin-glass-like "energy" and minimises it; per the fetch, the author's own added note says the resulting puzzle can be solved easily by hand, so the difficulty definition is considered inappropriate (paraphrase, not a verbatim quote). | FETCH | Cautionary: optimising an unvalidated proxy can produce boards that are not hard for people. Another reason to keep hint-ladder solvability as a hard filter. |
| Hunt, Pong and Tucker, "Difficulty-Driven Sudoku Puzzle Generation" (UMAP Journal, MCM 2008) | Only the title and "Harvey Mudd College" appear in COMAP's MCM-2008 listing (https://www.mathmodels.org/Problems/2008/MCM-B/index.html); the paper needs a COMAP login. **UNVERIFIED.** | UNVERIFIED | Unknown. |
| Jarvis (and Felgenhauer and Jarvis) | Grid enumeration, not difficulty. Not read. | not checked | No. |
| "Xu et al." | No such study found. | not found | Unknown. |

Given counts by published grade (Simonis Table 7, "Preset" columns, min / avg / max) [RAW]. Sources per his text:
Times [28], Telegraph [29], Guardian [30], Independent [31], Sun [33], book [38].

| Source | Easiest grade avg | Middle | Hardest grade avg |
|---|---|---|---|
| Times (n=4/26/45/25) | easy 34.75 | mild 29.12, difficult 27.09 | fiendish 25.32 |
| Telegraph (n=32/66/22/12) | gentle 28.28 | moderate 27.88, tough 28.05 | diabolical 28.00 (flat) |
| Guardian (n=20/40/40) | easy 28.05 | medium 25.10 | hard 22.88 |
| Independent (n=10/50/68) | elementary 31.20 | intermediate 29.02 | advanced 28.43 |
| Sun (n=40/50) | teasers 35.98 | | toughies 35.54 (flat) |
| Book [38] (n=50/60/50/40) | easy 43.32 | medium 35.48, difficult 27.84 | super-difficult 27.68 |

Nonet's own v1 numbers (Classic Easy 36 to 37 givens, Medium 27 to 30) sit inside this range.

Applies / doesn't: all of this says **given count is a weak, source-dependent lever**; keep it as a reported
statistic, not a target. None of these papers gives a usable steered generator.

---

## 6. Killer sudoku generators

Public write-ups are thin. I could not find a thesis or a blog post on difficulty-targeted Killer generation.

### 6.1 Simon Tatham's Solo (Killer mode): the closest design to the brief

[RAW] `solo.c`, https://sources.debian.org/data/main/s/sgt-puzzles/20250730.a7c7826-1/solo.c, functions
`gen_killer_cages`, `merge_some_cages`, `new_game_desc`.

- Start layout: cells are paired into dominoes (right or lower neighbour), left-over singletons are merged into a
  neighbour, and **single-cell cages survive only at the easiest killer level**:
  `kblocks = gen_killer_cages(cr, rs, params->kdiff > DIFF_KSINGLE);`
- Killer puzzles carry no digit givens: "Killer puzzles are different: we just pass the empty grid to the solver, and
  use the puzzle if it comes back solved."
- Merge-to-harden loop, as designed:
  > "We have one that matches our difficulty.  Store it for later, but keep going."
  > "The difficulty level got too high.  If we have a good one, use it, otherwise go back to the last one that was at a lower difficulty and restart the process from there."
  > "Give up after too many tries and either use the good one we found, or generate a new grid."  (`if (++ntries > 50)`)

  Each round merges one random pair of adjacent cages (no repeated digit, size within `max_nr_squares`, which is
  `cr`, i.e. 9) and re-grades with a solver that has two ladders (`DIFF_*` for Sudoku techniques; `DIFF_KSINGLE`,
  `KMINMAX`, `KSUMS`, `KINTERSECT` for cage techniques).
- **Caveat I found, not run:** in `merge_some_cages` the pair counter `npairs` is set to 0, and the code then writes
  `pairs[npairs].b1 = i; pairs[npairs].b2 = j; break;` without ever incrementing it, so `while (npairs > 0)` never
  runs and the function always returns `false`. `grep npairs++` finds nothing in the 2017, 2019, 2023 and 2025 Debian
  builds. If that reading is right, released Solo Killer generation reduces to "accept the first dominoes-plus-merged-
  singletons layout whose grade equals the target, else regenerate everything". Treat Tatham as support for the
  *design*, not as field evidence that merge-to-harden works. Nonet's own prototypes (`ksearch.mts merge`, 8/8 at
  Expert) are the stronger evidence.
- Classic mode in the same file is the "solver as the check" strip (section 8.2).

### 6.2 Andrew Stuart (SudokuWiki PDF, Killer section) [RAW]

> "Some cage grids are discarded - for example if there are too many 2-cages (pairs) or if there are too many single cages (which are useful for gentle and moderate Killers but not suitable for higher grades."
> "I adhere to the convention that cages cannot contain the same solution number."

Grading inputs for Killer: "cage combinations", cages with "only one combination", "innies and outies" and "cage
splitting" are "weighted and factored into the grading process". 2025 Killer strategy points (before the density
factor F): Innies/Outies 5, Easy Combinations 5, Hard Combinations 10, Killer Innies (2+ cells) 30, Killer Cage
Splitting 40, Rule of Parity 50, Killer Cage Comparison 50, Cage/Unit Overlap 60. Killer thresholds are compressed near
the top (Moderate 8.8 to <9.2, Extreme 10+). The page notes that in Killer "all 727 are in play at the start"; that this
explains the compression is my inference, not his statement.

### 6.3 KSudoku (KDE) cage generator [FETCH]

https://lxr.kde.org/source/games/ksudoku/src/generator/cagegenerator.cpp and `.h`: cages grow by random frontier
expansion from a start cell (preferring cells enclosed on three sides), sizes drawn uniformly from 2 to `maxSize`
after the first `mMinSingles` (2) single-cell starts, `hasDuplicates()` rejects repeated digits for Killer, and
uniqueness is checked with a DLX solver capped at two solutions. The header comment: "If there is no unique solution,
the puzzle must be rejected and the user of this class will need to try again." So: random layout, reject, retry. No
repair, no merging, no difficulty control.

### 6.4 Cage sizes per band: what exists

- Stuart: singles only at gentle and moderate; discard layouts with too many 2-cages. No numbers.
- Tatham: no singles above the easiest killer level. Reading the code (inference, not run): if the merge routine is
  inert as described in 6.1, released Solo Killer puzzles keep the initial layout at every level, i.e. dominoes plus
  absorbed singletons, so cages are mostly 2 to 3 cells (occasionally more when several singletons fold into one
  domino). The default "3x3 Killer" preset asks for `DIFF_KINTERSECT`, the top killer technique level, on exactly
  those small cages. So Tatham gives no larger-cage recipe for harder bands.
- Marketing copy [FETCH] https://iphoneaddict.fr/apps/jeux/killer-sudoku-pro-596.html (app "Killer Sudoku Pro"):
  "Easy: 1-3 cell cages, 12 given cells", "Medium: 1-4 cell cages, 6 given cells", "Hard: 1-5 cell cages, 0 given cells
  (pure deduction)". Not a method; low weight.
- No published cage-size distribution targets. How Krazydad, Puzzle Baron or killersudokuonline generate Killer
  puzzles: **UNVERIFIED** (no write-ups found).

### 6.5 Applies to Nonet / doesn't

- **Applies:** start from small cages and merge while the solver still grades at or below target. That is the design
  the brief's `ksearch.mts merge` prototype already uses. A domino-and-trominoes start (Tatham) is a concrete answer to the
  stranded one-cell cages that hurt `kdescent.mts`.
- **Applies:** zero single-cell cages above Easy/Medium is common practice (Stuart, Tatham), so the brief's style
  choice is well supported. Cage-size guard: nobody publishes targets, so the guard is Nonet's own call (the brief
  notes merged boards reach about 12% six-cell cages against 7% in v1).
- **Applies:** Stuart's 2-cage cap is a layout filter worth testing at Hard/Expert.
- **Doesn't apply:** KSudoku's reject-and-retry. It has no repair, no hardening and no difficulty control, so it cannot
  target bands at all.

---

## 7. LinkedIn Queens and Star Battle

### 7.1 Premise correction

Standard Star Battle already forbids touching, diagonals included. Krazydad [FETCH]
https://krazydad.com/how-to-solve-star-battle: "diagonal touching is also forbidden". So 1-star Star Battle on an N x N
grid with N regions is exactly LinkedIn Queens; 2-star and 3-star are the extension.

### 7.2 Generators and uniqueness

- aryanbpatel/queens-solver [FETCH] https://github.com/aryanbpatel/queens-solver: "places N legal queens at random, grows a
  region out from each one", then repairs non-uniqueness: "Each time it finds one, it moves one of that rival
  solution's queen cells into a neighboring region." It reports medians of about 4 ms (6x6) to 7 ms (12x12) per solve.
  Difficulty appears only under ideas: "Rate puzzle difficulty by how many logical deductions it takes, not just board size."
  This is the same recipe Nonet already uses (queens, then regions, then uniqueness repair).
- queens-game-engine [FETCH] https://github.com/alwaysaladdin/queens-game-engine: builds a non-touching layout, then
  "grows connected regions from the Queen cells", keeps a candidate only if the solver finds exactly one solution
  (`maxSolutions: 2`), supports "7x7 through 12x12 boards" and says "Generation is deterministic within an engine
  version." Difficulty is a "roadmap item".
- greentec [FETCH] https://greentec.github.io/linkedin-queens-en/: each queen starts a region, then random unassigned
  neighbours are attached to adjacent regions; no uniqueness check; for N = 8 there are 5,242 queen placements, which
  matches the brief's count.
- Hillel Wayne (SMT solving) and Alireza Soroudi plus hakank's Picat `generate_regions` [SEARCH]: Picat page unreachable
  from here, so its generator details are **UNVERIFIED**. A Star Battle write-up on dev.to that the search surfaced
  returned 404, so claims about it are **UNVERIFIED**.
- qsolve (Rust) [FETCH] https://docs.rs/qsolve: a human-style solver that avoids search ("Humans solve queens by
  iteratively eliminating and confirming squares"); no difficulty grading documented.

### 7.3 Technique catalogs usable as tier vocabulary

- Krazydad, "Advanced Strategies for Two Not Touch Puzzles" [FETCH] https://krazydad.com/twonottouch/adv_tutorial:
  Finished Containers ("the only rule you need to solve the easiest puzzles"), Nosy Neighbors, then Selfish Roommates,
  Crowding, Four-Squares (2-star), Clumps, Container Cabals ("you can do it with three rows and three regions, but not
  with three rows and four regions"), Container Consumption.
- Shaun Shue [FETCH] https://shaunshue.com/SolveLinkedInQueens/: nine steps from "Row-column intersection" and
  "Single-square region" through "Region confined to one row or column" to "Overloading rows or columns".
- davdata Queens helper [FETCH] https://davdata.nl/math/queens-linked-in.html: five hint types, the last being "n columns
  (or rows) whose open cells belong to only n regions". It says the third (a cell whose queen would close off another
  line) is the most common and "hardest to spot".

### 7.4 Board sizes by difficulty

- LinkedIn's own mapping is **UNVERIFIED**. Third-party pages disagree: davdata [FETCH] says puzzles come in sizes
  "7*7, ..., 12*12", while a search summary [SEARCH] cites another site for "typically 7x7 to 9x9". I found no LinkedIn
  statement, and no source ties size to a named difficulty.
- GM Puzzles, for contest-grade Star Battle [FETCH] https://www.gmpuzzles.com/blog/?p=350: "8x8 for 1 star and 10x10 for 2
  stars are the preferred smallest sizes" and "A Grandmaster Star Battle will have a unique solution that can be reached
  by logic alone." Not tied to difficulty tiers.

### 7.5 Difficulty grading for Queens / Star Battle

I found **no generator that grades by technique** (aryanbpatel and queens-game-engine both list it as future work).

### 7.6 Applies to Nonet / doesn't

- **Applies:** grow-from-planted-queens plus uniqueness repair is the public baseline; Nonet is already there and is
  ahead on grading.
- **Applies:** Krazydad's and Shue's catalogs give an independent ordering to check Nonet's tiers against
  (finished containers / single-square first; confined-to-line next; counting arguments such as "n lines, n regions"
  last). The brief says to report disagreements with the tiers, not change them.
- **Doesn't apply:** sizes by difficulty; nothing authoritative to copy.

---

## 8. Generation strategy in general

### 8.1 Dig holes, then rate, then reject (the default)

HoDoKu (section 1), SE (2.3), SudokuWiki (3.3) and QQWing all do this. QQWing's classifier is "highest technique
class present" [RAW] https://github.com/stephenostermiller/qqwing/blob/main/src/cpp/qqwing.cpp:

```cpp
if (getGuessCount() > 0) return SudokuBoard::EXPERT;
if (getBoxLineReductionCount() > 0) return SudokuBoard::INTERMEDIATE;
if (getPointingPairTripleCount() > 0) return SudokuBoard::INTERMEDIATE;
if (getHiddenPairCount() > 0) return SudokuBoard::INTERMEDIATE;
if (getNakedPairCount() > 0) return SudokuBoard::INTERMEDIATE;
if (getHiddenSingleCount() > 0) return SudokuBoard::EASY;
if (getSingleCount() > 0) return SudokuBoard::SIMPLE;
```

and its generator is pure rejection: "Bail out if it didn't meet the difficulty standards for generation"
(`main.cpp`). Note that HoDoKu (Medium) and QQWing (Intermediate) put pointing/claiming **and** pairs in the same
middle tier, and SudokuWiki's 2007 text names pairs and triples at Moderate (it does not say where pointing/claiming
sit). SE rates pointing/claiming 2.6 / 2.8 and naked pair 3.0, i.e. adjacent. The brief moves pairs to Hard; that is
Nonet's own choice, and the Medium band will be narrower than the convention.

### 8.2 Solver-in-the-loop stripping (Tatham, Classic mode)

[RAW] `solo.c`, same URL as 6.1. Remove a (symmetric) clue **only if a solver capped at the target difficulty still
solves the grid**, then accept the finished puzzle only if its difficulty equals the target:

```c
/* abridged from solo.c, new_game_desc() */
solver(cr, blocks, kblocks, params->xtype, grid2, kgrid, &dlev);
if (dlev.diff <= dlev.maxdiff && (!params->killer || dlev.kdiff <= dlev.maxkdiff)) {
    /* ... clear the clue and its symmetric partners ... */
}
...
if (dlev.diff == dlev.maxdiff && (!params->killer || dlev.kdiff == dlev.maxkdiff))
    break;		       /* found one! */
```

Comment in the file: "Loop until we get a grid of the required difficulty. This is nasty, but it seems to be unpleasantly hard to
generate difficult grids otherwise." His docs state the level principle ("each level requires a mode of reasoning
which was not necessary in the previous one" [FETCH] https://www.chiark.greenend.org.uk/~sgtatham/puzzles/doc/solo.html)
and warn that "More symmetry makes the puzzles look prettier but may also make them easier."

This is the brief's "stripping with the solver as the check", already in production in a mature collection. Because every
removal is tested against the capped solver, the board ends up about as hard as the cap allows, which is presumably why
the final grade often lands on the cap (my inference; the brief's `cmedium.mts` result, wall at 17 to 28 empty cells, is
consistent with it).

### 8.3 Clue hill-climbing with a technique target (l2sg)

[RAW] https://github.com/rafaelfassi/l2sg/blob/master/lib/src/Generator.cpp. `generate()` starts from a full grid
with 64 clues removed (about 17 left) and steers with the solver's verdict: "too easy" (-1) removes another clue,
"too hard / unsolved" (+1) restores the last removed clue, 0 stops. When no clue is left to try it "flips" (restores
the removed cells and re-removes a new set), and it restarts from a fresh full grid after 30,000 flips. Clue bounds
are explicit in the code comments ("The minimum valid sudoku must have at least 17 clues"; "Don't generate puzzles
with more than 40 clues").

`generateByTechnique` allows a base technique set plus the requested one and accepts when
`usedTechniques.find(_technique) != usedTechniques.end()`. That is "used on the solver's path", the same semantics as
Nonet's grade, not proof that the technique is unavoidable.

### 8.4 Minimal puzzles, symmetry, clue counts

- Minimum clue count is 17 (McGuire et al., section 5). HoDoKu's digger and l2sg both enforce 17 as a floor.
- Stuart lists "minimal" as a quality standard, yet says "occasionally one or two extra numbers are removed to make the
  puzzle ever so slightly harder" (still unique), so some of his puzzles are slightly asymmetric.
- Simonis: published puzzles are mostly not locally minimal; "more than 10 redundant hints" is typical.
- Tatham: symmetry can make puzzles easier because it forces extra clues. Nonet's 180-degree mirrored removal in the
  brief inherits that effect.
- Given counts: table in section 5; Stuart keeps the mean near 27, never above 30.

### 8.5 Pattern-based generation (fixed given positions)

HoDoKu's generator accepts a user-drawn pattern of given positions (`generateInitPos(boolean[] pattern)` retries up to
`MAX_TRIES = 1000000`). It controls aesthetics, not difficulty. No source found that plants a specific hard technique
by construction; every technique-targeted generator found (HoDoKu training, SE filters, l2sg) is rejection or hill-climb
on "was it used".

### 8.6 Determinism

HoDoKu, SE and l2sg use unseeded RNGs. The only public statement of reproducibility is queens-game-engine's
"deterministic within an engine version". Nonet's `rng.ts` plus recording seed and generator version already goes
beyond the prior art.

---

## 9. How each system defines its middle and top tiers

| System | Easy / low | Middle | High | Position-aware? |
|---|---|---|---|---|
| HoDoKu | Singles (score 4 to 14) | Locked candidates, locked pair/triple, naked/hidden pair and triple (40 to 100) | Hard: quads, fish to jellyfish, wings, kites, UR (100 to 200); Unfair: chains, ALS, finned fish | No |
| SudokuWiki 2025 | Kids: eyeballing; Gentle: hidden singles | Moderate: naked/hidden pairs and triples (his 2007 text) | Tough, Diabolical, Extreme by score | Yes (candidate density F) |
| QQWing | Simple (naked singles), Easy (hidden singles) | Intermediate: pairs, pointing, box/line | Expert: any guess | No |
| SE | 1.0 to 2.8 (singles, pointing, claiming, direct pairs) | 3.0 to 4.4 (naked/hidden sets, fish, wings) | 5+ (quads, jellyfish, chains 6.6+) | Only via EP/ED |
| Tatham Solo | Trivial / Basic: "always fill in some square with a single number" | Intermediate: partial deductions | Advanced, Extreme, Unreasonable | No |
| Pelánek | n/a | n/a | n/a | Yes (first 20 to 30 steps) |

---

## 10. Not verified / not found

- HoDoKu 2.2.0 default level ceilings (the GitHub fork's values are given in 1.2).
- Juillerat's original SE documentation (site gone) and any documented upper bound for SE ratings.
- Hunt, Pong and Tucker's paper (login-gated). Jarvis on difficulty and "Xu et al." (nothing found).
- Mantere and Koljonen's steering method (abstract only). Lee et al. (secondary summaries only).
- How Krazydad, Puzzle Baron and killersudokuonline generate Killer puzzles.
- LinkedIn's Queens board size by weekday or difficulty (third-party sources conflict).
- Any Queens or Star Battle generator that grades by technique (none found).
- hakank's Picat region generator and a dev.to Star Battle write-up (unreachable / 404).
- Pelánek's Tilt-maze and "problem solving metrics" papers (not checked).
- Whether Tatham's Killer merge truly never fires (code reading only, not executed).
- All [FETCH] quotes: wording not diffed against raw HTML.

Effort: about 33 web searches and about 30 page fetches (roughly 10 of them failed or were blocked), plus 5 shallow
repo clones and 8 PDFs read as text. That is over the 25 to 40 target; the extra went to reading source and PDFs
instead of relying on search summaries.

---

## 11. Most useful takeaways

1. **Everyone generates then rates then rejects; the only steered variants are solver-in-the-loop.** Tatham's Solo
   removes a clue only if a difficulty-capped solver still solves the grid and keeps the board only if its grade equals
   the target; l2sg hill-climbs the clue set on the solver's "too easy / too hard" verdict. The brief's "strip with the
   solver as the check" is established practice (sections 8.2, 8.3).
2. **A hardest-step grade needs a frequency term.** HoDoKu takes the higher of the hardest step's level and the level
   implied by summed step scores, and rejects a board whose total is below the previous level's ceiling. That is the
   precedent for making Expert mean frequent advanced steps and for keeping a single stray advanced step out of Hard (section 1.2). Pelánek's
   "Serate LM" (a linear model over technique counts) beats plain Serate on fed-sudoku.eu and on the singles-only
   subsets and ties it on the full sudoku.org.uk set, which is modest support for the same idea (section 4.2).
3. **Pelánek's claim is only partly true.** Available moves per step (mean over the first 20 to 30 steps) is the
   weakest model metric overall (r 0.67 / 0.69 vs Serate 0.70 / 0.86) but the best on singles-only puzzles (0.73 / 0.78
   vs 0.55 / 0.28), and combining the two reaches 0.84 / 0.95. Use it as the within-Easy breather/stretch knob, not as a
   replacement for tier-based bands (section 4.5).
4. **Reject the "one tough bottleneck" board.** Stuart's standard 4 and his 2025 heuristic both drop boards that are
   trivial except for one very hard step. The brief's Expert rule (>= 3 steps at tier 4+) already does this for Expert;
   Hard's "tier 3 without limit" (31/60 v1 Hard boards have exactly one tier-3 step) may want a minimum-advanced-work
   check too (sections 3.1, 3.2).
5. **Position can be priced.** SudokuWiki's 2025 candidate-density factor weights each step by candidates left (6.0
   at step 2 down to 0.2 at step 30). That turns the Medium rule (some advanced steps, late in the solve) into a number and gives a
   continuous within-band score for sub-targets. Pelánek independently finds late steps barely affect solving time
   (section 3.2, 4.4).
6. **Givens count is not a difficulty lever.** r = 0.25 to 0.27 against human time; the 17- and 18-clue puzzles tested
   were easier than the hardest 21- and 22-clue ones; Telegraph grades average 28.28 givens (gentle) to 28.00
   (diabolical). Report it, don't target it (sections 4.2, 5).
7. **Killer: small cages first, merge to harden, few or no singles above the entry level.** Tatham starts from dominoes
   and keeps single-cell cages only at the easiest killer level; Stuart says singles suit gentle and moderate Killers
   only and discards layouts with too many 2-cages. But Tatham's merge routine looks inert in released code (`npairs`
   never incremented), so Nonet's own prototype results remain the real evidence, and nobody publishes cage-size
   targets per band (section 6).
8. **Queens has no graded generator in public.** Grow regions from planted queens and repair or check uniqueness is the
   shared baseline (three independent write-ups); difficulty grading by technique is "future work" in each. Star
   Battle already forbids diagonal touching, so Queens is 1-star Star Battle; Krazydad's and Shue's technique lists
   are the only external tier vocabulary (section 7).
9. **Mid-tier convention is wider than Nonet's Medium.** HoDoKu and QQWing place pointing/claiming together with
   pairs in the middle tier (HoDoKu adds triples), SudokuWiki names pairs and triples at Moderate, and SE rates
   pointing/claiming 2.6 / 2.8 next to naked pair 3.0. If Nonet's Medium (pointing/claiming only) turns out thin, this is
   the convention to point at; it is a tier question for Shawn, not something to change in the generator
   (sections 8.1, 9).
10. **Variety inside a band has no explicit prior art, but the mechanisms exist.** HoDoKu gives each level a score
    interval, SE takes min/max rating bounds, and SudokuWiki publishes a continuous log score cut into bands. Breather /
    standard / stretch are therefore sub-intervals of a within-band score (my inference). On reproducibility, the
    surveyed tools are weaker than Nonet's plan: HoDoKu, SE and l2sg use unseeded RNGs, and only queens-game-engine
    states "deterministic within an engine version", which is the same idea as recording a generator version per board
    (sections 1.4, 2.3, 8.6).
