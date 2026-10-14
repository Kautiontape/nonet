/** Player settings with persistence and change notification. */
import { load, save } from "./store";

export type EffectsLevel = "low" | "normal" | "epic";

export interface Settings {
  sfx: boolean;
  music: boolean;
  volume: number;
  haptics: boolean;
  effects: EffectsLevel;
  highlightSame: boolean;
  autoClearNotes: boolean;
  /** Show the auto-note layer: lighter digits the rules still allow, under the player's own notes. */
  autoNotes: boolean;
  checkMistakes: boolean;
  showTimer: boolean;
  /** Killer: tint cages in alternating colours. */
  cageTint: boolean;
  /** Killer: show the selected cage's combinations under the board. */
  showCombos: boolean;
  /** Queens: cross out cells a placed queen attacks. */
  autoCross: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sfx: true,
  music: true,
  volume: 0.8,
  haptics: true,
  effects: "normal",
  highlightSame: true,
  autoClearNotes: true,
  autoNotes: false,
  checkMistakes: true,
  showTimer: true,
  cageTint: true,
  showCombos: true,
  autoCross: true,
};

type Listener = (s: Settings, changed: (keyof Settings)[]) => void;
const listeners = new Set<Listener>();

let current: Settings = { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>("settings", {}) };
if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches && !load("settings", null))
  current.effects = "low";

export function settings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== current[k]);
  if (!changed.length) return;
  current = { ...current, ...patch };
  save("settings", current);
  for (const fn of listeners) fn(current, changed);
}

export function onSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
