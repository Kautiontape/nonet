/**
 * The hold after a Game Over: a cover over the play screen that takes every tap, so the player can
 * read the answer for as long as they like. It opens a moment in, so a tap meant for the board can't
 * skip it, and then a tap anywhere (or Enter) moves on. It goes when the screen does.
 */
import { h } from "../dom";

/** Longer than the answer takes to come up, and than a fast player's next tap. */
const ARM_MS = 1200;

export function lossHold(onContinue: () => void): HTMLElement {
  const el = h(
    "button",
    {
      class: "loss-hold",
      type: "button",
      disabled: true,
      "aria-label": "Continue to the next puzzle",
      "data-testid": "loss-continue",
      onclick: () => {
        el.disabled = true;
        onContinue();
      },
    },
    h("span", null, "Tap to continue"),
  );
  window.setTimeout(() => {
    el.disabled = false;
    el.focus({ preventScroll: true });
  }, ARM_MS);
  return el;
}
