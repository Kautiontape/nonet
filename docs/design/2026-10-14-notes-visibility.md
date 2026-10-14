# Notes you can read without them shouting

*Design, 2026-10-14. Decided in a brainstorm with Shawn; this file is the why. Build from it.*

## Problem

A player had to stop playing: they could not make out the notes, the 1s least of all. The
auto-note layer was drawn at 45% opacity of a dim grey, about 2:1 against the board, at ~10px in
a font whose 1 is a single thin stroke. The first fix (0f1c5eb) made every note bigger, bolder
and much brighter, and the player's own notes went near-white: now they looked like the board's
big digits. v0.2.1 is the stopgap: every note, the player's and the layer's, in one grey at 4.5:1
or better, a little larger, weight 600.

Shawn named four things wrong with notes, all of which the stopgap leaves open:

1. With Auto notes on, especially in killer, nearly every empty square shows up to nine digits:
   a wall the eye can't scan.
2. Since v0.2.1 the player's own notes and the layer's are identical, so you can't see what you
   decided versus what the rules merely allow.
3. Notes compete with the placed digits when scanning for a number; they must read as secondary.
4. A way to clear the view on demand, without losing the notes or opening Settings.

Constraint that stays: no note colour may drop below 4.5:1 against any background it can sit on,
in any theme. `tests/ui/notes-contrast.test.ts` enforces it; dimming is not a tool we have.

## Decisions

**Hiding is focus that follows the selection, not a button.** The selected square and every
square in its row, column, box and cage (the `sel`, `msel`, `peer` and `cage-peer` classes the
board already sets) show notes at full strength. Everywhere else notes are *quiet*: still readable
(about 6:1), but clearly stepped back. Nothing selected means everything quiet, which is the calm
"scan the board" state. No sixth tool in a bar that has five, no gesture to discover, no setting.
Alternatives considered: a sticky "Hide notes" tool (explicit, but a sixth button and a mode to
remember), hold-to-peek (invisible), a digit lens only (no way to quiet the board in general).

**Whose note it is comes from hue, not brightness.** The player's notes are warm (pencil cream);
the layer's are cool (steel grey / blue-white). Hue survives the quiet and focus levels, so both
kinds stay readable and apart in every state. Weight stays 600 for both. Alternatives: bold vs
regular (too subtle at 12px in the quiet state), a dot or underline (more ink in dense squares).

**Quiet auto notes stay visible.** Hiding the layer outside the focus would thin killer boards
dramatically, but takes away scanning for a square with one candidate left. Visible-but-quiet
first; hide-outside-focus is a one-rule change if it turns out wanted.

## Colours

| | Quiet (away from the selection) | Focus (selected square, its houses and cage) |
| --- | --- | --- |
| Own notes (warm) | `#aa9f84`, worst case 6.9:1 | `#f3e9cb`, worst case 9.4:1 |
| Auto layer (cool) | `#8e9ac3`, worst case 6.5:1 | `#cfd8f6`, worst case 8.0:1 |

Worst cases are over every background that state meets, in all four themes: quiet over the plain
board and each killer cage tint; focus over peer, cage-peer, selected (gradient at the mean of
its stops, since notes sit across the square), drag-selected and notes-mode-selected squares.
Matching-digit notes keep the accent glow on top. In notes mode the selected square's own notes
stay white, as before. The hint sheet's rule (notes outside the hint's squares hidden) stays.

## Hide on demand

Shawn still wants a way to take every note off the board at once. For now it is a **hold on the
Notes tool** (the same 380 ms hold as a pad digit, shared in `holdable()` in `ui/dom.ts`): every
note goes out of view, the tool reads "Hidden", the stats line says how to get them back, and a
toast says so the first time. Holding again shows them; so does a tap, since pencil mode is for
writing notes. V on a keyboard. The state is not saved: a new game shows its notes, so nobody
opens a game wondering where their notes went. A hint's picture still draws while notes are
hidden, since hinting shows and hides notes by its own rules.

Later, when the bottom bar needs more than tap-and-hold can carry (hide notes, note style,
the Σ45 lens, …), a popup from the Notes tool is the place for these; the hold stays as the
shortcut.

## Mechanism

Pure CSS in `src/ui/style.css`, no JavaScript: the quiet colours are the defaults on `.notes` and
`.notes i.auto`; the focus colours are two rules keyed on `:where(.cell.sel, .cell.msel,
.cell.peer, .cell.cage-peer)`, placed before `.notes i.match` and with `:where()` so the match
rule still wins. `color` joins the existing 0.15s transition on `.notes i`; it is colour only, so
reduced motion needs nothing.

## Tests

- `tests/ui/notes-contrast.test.ts` reads the stylesheet and checks each state's colours against
  the backgrounds that state meets, 4.5:1 or better, in every theme; that focus is brighter than
  quiet; that own notes are warm and auto notes cool; that the layer is at full opacity; and the
  size and weight floors.
- e2e: with Auto notes on, a square's peers take a different note colour once it is selected and
  a far square's notes keep the quiet colour.
- Board screenshots at the Pixel 7 viewport, quiet and with a middle square selected, in classic
  and killer, before committing.

## Not doing

- No Settings toggle for focus. The quiet level is fully readable, so nobody is locked out. If
  someone asks, it is one row under Settings → Play and a body class.
- No change to size or weight; v0.2.1's are kept.
