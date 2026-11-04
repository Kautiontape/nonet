/** Player settings with persistence and change notification. */
import { load, save, saveQuiet } from "./store";

export type EffectsLevel = "low" | "normal" | "epic";

/** Yes: mistakes never end a game. Limited: `mistakeLimit` of them are forgiven. Hardcore: none are. */
export const ALLOW_MISTAKES = ["yes", "limited", "hardcore"] as const;
export type AllowMistakes = (typeof ALLOW_MISTAKES)[number];

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
  allowMistakes: AllowMistakes;
  /** Mistakes forgiven under Limited. Kept while another mode is on, so it's there to come back to. */
  mistakeLimit: number;
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
  allowMistakes: "yes",
  mistakeLimit: 3,
  showTimer: true,
  cageTint: true,
  showCombos: true,
  autoCross: true,
};

/**
 * The settings that follow the player between devices: how the game plays. Sound, haptics,
 * volume and the effects level are about the device and stay with it.
 */
export const SYNCED_KEYS = ["highlightSame", "autoClearNotes", "autoNotes", "checkMistakes", "allowMistakes", "mistakeLimit", "showTimer", "cageTint", "showCombos", "autoCross"] as const;
export type SyncedKey = (typeof SYNCED_KEYS)[number];
export type SyncedSettings = Pick<Settings, SyncedKey>;

const LIMIT_MAX = 99;

/** A number from the Limited box as the setting holds it: whole, 1 to 99 (0 is Hardcore). */
export const clampLimit = (n: number): number => Math.min(LIMIT_MAX, Math.max(1, Math.round(n)));

/** Mistakes a game forgives before it's lost; null when they never end one. */
export function mistakesAllowed(s: Settings): number | null {
  return s.allowMistakes === "yes" ? null : s.allowMistakes === "hardcore" ? 0 : s.mistakeLimit;
}

/** Whether wrong digits are flagged and counted. A limit needs them counted, so it keeps this on. */
export function flagsMistakes(s: Settings): boolean {
  return s.checkMistakes || s.allowMistakes !== "yes";
}

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

/** Whether a value from another device is one this setting can hold. */
function validSynced(k: SyncedKey, v: unknown): boolean {
  if (k === "allowMistakes") return (ALLOW_MISTAKES as readonly unknown[]).includes(v);
  if (k === "mistakeLimit") return typeof v === "number" && v === clampLimit(v);
  return typeof v === "boolean";
}

/**
 * Settings the merge brought in from another device: applied and saved, with that device's
 * time, but not stamped as a change made here (or two devices would hand them back and forth).
 */
export function applySyncedSettings(values: Partial<SyncedSettings>, at: number): void {
  const patch: Partial<Settings> = {};
  for (const k of SYNCED_KEYS) {
    const v = values[k];
    if (validSynced(k, v) && v !== current[k]) Object.assign(patch, { [k]: v });
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
