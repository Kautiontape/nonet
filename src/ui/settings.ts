/** Player settings with persistence and change notification. */
import { load, save, saveQuiet } from "./store";

export type EffectsLevel = "low" | "normal" | "epic";

export interface Settings {
  sfx: boolean;
  music: boolean;
  volume: number;
  haptics: boolean;
  effects: EffectsLevel;
  highlightSame: boolean;
  autoClearNotes: boolean;
  /** Show the auto-note layer: digits the rules still allow, under the player's own notes. */
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

/**
 * The settings that follow the player between devices: how the game plays. Sound, haptics,
 * volume and the effects level are about the device and stay with it.
 */
export const SYNCED_KEYS = ["highlightSame", "autoClearNotes", "autoNotes", "checkMistakes", "showTimer", "cageTint", "showCombos", "autoCross"] as const;
export type SyncedKey = (typeof SYNCED_KEYS)[number];
export type SyncedSettings = Pick<Settings, SyncedKey>;

type Listener = (s: Settings, changed: (keyof Settings)[]) => void;
const listeners = new Set<Listener>();

let current: Settings = { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>("settings", {}) };
if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches && !load("settings", null))
  current.effects = "low";

export function settings(): Settings {
  return current;
}

const isSynced = (k: keyof Settings): k is SyncedKey => (SYNCED_KEYS as readonly string[]).includes(k);

export function updateSettings(patch: Partial<Settings>): void {
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== current[k]);
  if (!changed.length) return;
  current = { ...current, ...patch };
  save("settings", current);
  // The time a synced setting last changed here decides which device's choice wins a merge.
  if (changed.some(isSynced)) save("settingsAt", Date.now());
  for (const fn of listeners) fn(current, changed);
}

/** The synced settings as they are now. */
export function syncedSettings(): SyncedSettings {
  return Object.fromEntries(SYNCED_KEYS.map((k) => [k, current[k]])) as SyncedSettings;
}

/**
 * Settings the merge brought in from another device: applied and saved, with that device's
 * time, but not stamped as a change made here (or two devices would hand them back and forth).
 */
export function applySyncedSettings(values: Partial<SyncedSettings>, at: number): void {
  const patch: Partial<Settings> = {};
  for (const k of SYNCED_KEYS) {
    const v = values[k];
    if (typeof v === "boolean" && v !== current[k]) patch[k] = v;
  }
  const changed = Object.keys(patch) as (keyof Settings)[];
  current = { ...current, ...patch };
  saveQuiet("settings", current);
  saveQuiet("settingsAt", at);
  if (changed.length) for (const fn of listeners) fn(current, changed);
}

export function onSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
