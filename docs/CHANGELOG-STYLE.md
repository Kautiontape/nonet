# Changelog style

`CHANGELOG.md` is shown to players as is, under Settings → Changelog. Write it for someone who
plays Nonet on their phone and has never seen the code.

## What goes in

- Anything a player would notice: a new feature, a change to how something works or looks, a
  fixed bug they could have hit.
- Leave out deploys, refactors, tests, docs, packs regenerated with no visible change, and
  anything that only touches the beta.
- Add your bullet under `## Unreleased` in the same commit as the change.

## How to write a bullet

- **One sentence, at most 30 words.** Say what the player can do now or what's different, not
  how it was built.
- **Start with the change.** "Save a backup from Settings → Data", not "Added backup support".
- **Name things the way the screen does:** Settings → Data, Hint, Auto notes, Σ45, Scores.
  Squares are `r5c6`. No internal names (`autoNotes`, `store.ts`, "layer API").
- **Fixes say what went wrong:** "Fixed: the timer kept running behind the results banner."
- **Big changes get a bold lead** of two to five words, then the sentence:
  `**Back up your progress.** Settings → Data saves …`. Small ones are a plain sentence.
- **Biggest first**, at most 8 bullets per release. Fold leftovers into one bullet:
  "Smaller fixes and polish."

| Instead of | Write |
| --- | --- |
| Refactored hint engine to emit single-step routes. | **Hints go one step at a time.** When a digit needs groundwork first, the hint teaches each step in turn. |
| Added localStorage export/import with JSON schema v1. | **Back up your progress.** Settings → Data saves your scores to a file you can restore on another device. |
| Fixed bug #12 in sudoku-play.ts. | Fixed: Backspace could leave the game on some keyboards. |

## Format

The app reads only this; `tests/ui/changelog.test.ts` fails if the file drifts from it.

```markdown
## Unreleased

- **Bold lead.** One sentence.
- Plain sentence. A long bullet may wrap onto lines
  indented by two spaces.

## 0.2.0 — 2026-10-14

- …
```

- Headings are `## Unreleased` or `## X.Y.Z — YYYY-MM-DD`, newest first. Nothing else uses `##`.
- Bullets start with `- `. The only markup is `**bold**`. No links, no nested lists.
- Beta and local builds show Unreleased as "Next release"; a release build hides it.

## Releasing

1. Rename `## Unreleased` to `## X.Y.Z — YYYY-MM-DD` (today) and commit:
   `release: X.Y.Z`. Leave no Unreleased heading until there's a new bullet for it.
2. Push it, then tag that commit and push the tag:
   `git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z`. Production builds the
   tag, and its Settings shows "Version X.Y.Z".

To label a beta before releasing, tag `vX.Y.Z-beta.N` instead and push it with main. Production
ignores tags with a suffix; the beta's Settings shows "Beta vX.Y.Z-beta.N", and the changelog
keeps its Unreleased heading until the real release.

To try a branch on the beta before it reaches main, tag its last commit `vX.Y.Z-beta.N`, push
the tag, and run the beta deploy on it: `gh workflow run deploy-beta.yml --ref vX.Y.Z-beta.N`.
Each new commit needs the next beta number and another run. The next push to main replaces it.

Versions: bump the patch for fixes only, the minor for anything new.
