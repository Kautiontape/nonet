/**
 * Mode-independent hint shapes. Sudoku (classic + killer) and Queens both produce hints as a
 * four-rung ladder so the UI can render every hint the same way:
 *
 *   1 where — which part of the board to look at (no technique named)
 *   2 what  — the technique name and a one-line nudge
 *   3 why   — the full reasoning, with cells and candidates highlighted
 *   4 do    — what applying the step changes
 *
 * Rung 0 (mistakes / bad notes) is expressed as a hint of kind "mistake" or "notes" with the same
 * ladder, so it climbs the same way.
 */

export type HintKind = "mistake" | "notes" | "step" | "solved" | "stuck";

export interface LadderText {
  where: string;
  what: string;
  why: string[];
  do: string;
}

export interface HintCommon {
  kind: HintKind;
  /** Short title, e.g. "Hidden Single" or "Check your notes". */
  title: string;
  /** Technique id for catalog lookups (step hints only). */
  technique?: string;
  /** 1..5 difficulty tier of the technique (step hints only). */
  tier?: number;
  ladder: LadderText;
}

export type TechniqueFamily = "sudoku" | "killer" | "queens";

/** Static description of a technique for the Learn screen and the "what" rung. */
export interface TechniqueInfo {
  id: string;
  name: string;
  family: TechniqueFamily;
  tier: number;
  rating: number;
  /** One line: what it is. */
  summary: string;
  /** How to spot it on the board. */
  spot: string;
  /** Why the deduction is valid. */
  why: string;
  /** Optional practical tip. */
  tip?: string;
  /** Other names players may know it by. */
  aka?: string[];
}

export const TIER_NAMES: Record<number, string> = {
  1: "Basic",
  2: "Easy",
  3: "Intermediate",
  4: "Advanced",
  5: "Expert",
};
