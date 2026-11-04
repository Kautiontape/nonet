/** Player feedback wording ("mistakes that teach"). */
import { aDigit, comboText } from "../engine/hints/format";
import { houseName } from "../engine/geometry";
import type { MistakeReason } from "../game/sudoku-game";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `over`: this was the mistake that lost the game, so Hint can't be offered. */
export function mistakeText(reason: MistakeReason | undefined, digit: number, over = false): string {
  if (!reason) return "That doesn't match the solution.";
  switch (reason.kind) {
    case "house":
      return `${cap(houseName(reason.house))} already has ${aDigit(digit)}.`;
    case "cage-dup":
      return `That cage already has ${aDigit(digit)}.`;
    case "cage-sum": {
      const combos = reason.combos.map(comboText);
      const lead =
        reason.rem === reason.sum
          ? `This ${reason.size}-cell cage sums to ${reason.sum}`
          : `This cage needs ${reason.rem} more from its empty cells`;
      if (!combos.length) return `${lead}, and ${aDigit(digit)} can't make that work.`;
      return `${lead}, so it can only be ${combos.length > 4 ? `${combos.slice(0, 4).join(", ")}…` : combos.join(" or ")} — no ${digit}.`;
    }
    default:
      return over ? "That doesn't match the solution." : "That doesn't match the solution. Hint can show you why.";
  }
}

/** The stats line's mistake count, against the limit if there is one. */
export function mistakeCount(mistakes: number, limit: number | null): string {
  if (limit === null) return `Mistakes ${mistakes}`;
  return limit ? `Mistakes ${mistakes} / ${limit}` : "Hardcore";
}

export const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Expert",
};

export const MODE_LABEL: Record<string, string> = {
  classic: "Classic",
  killer: "Killer",
  queens: "Queens",
};
