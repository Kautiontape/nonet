/**
 * Digit pad. Tap = place (or pencil in notes mode, or with Shift held); hold = light that digit up
 * across the grid, placing nothing. Each key shows how many of that digit are still missing; finished digits dim.
 */
import { h, holdable, shiftOnly } from "../dom";
import { DIGIT_COLORS } from "../palette";

export interface NumpadHandlers {
  /** asNote: Shift was held, so pencil it in. */
  onDigit(d: number, asNote: boolean): void;
  /** The key was held: show where that digit is, don't place it. */
  onHold(d: number): void;
}

export class Numpad {
  readonly el: HTMLElement;
  private keys: HTMLButtonElement[] = [];
  private counts: HTMLElement[] = [];

  constructor(handlers: NumpadHandlers) {
    this.el = h("div", { class: "numpad", role: "group", "aria-label": "Digits" });
    for (let d = 1; d <= 9; d++) {
      const count = h("small", null, "");
      // In notes mode the digit moves to where that note sits inside a cell (1 top-left … 9 bottom-right).
      const pos = `${Math.floor((d - 1) / 3) + 1} / ${((d - 1) % 3) + 1}`;
      const key = h(
        "button",
        { class: "num", type: "button", "aria-label": `Digit ${d}`, "data-digit": String(d), style: { "--dc": DIGIT_COLORS[d]!, "--pos": pos } },
        h("span", null, String(d)),
        count,
      );
      holdable(key, (e) => handlers.onDigit(d, shiftOnly(e)), () => handlers.onHold(d));
      this.keys.push(key);
      this.counts.push(count);
      this.el.append(key);
    }
  }

  /** remaining[d] = how many more of digit d are needed. */
  update(remaining: number[], notesMode: boolean, active: number): void {
    this.el.classList.toggle("notes-mode", notesMode);
    this.keys.forEach((k, i) => {
      const left = remaining[i + 1] ?? 0;
      k.classList.toggle("done", left <= 0);
      k.classList.toggle("active", active === i + 1);
      this.counts[i]!.textContent = left > 0 ? String(left) : "✓";
    });
  }
}
