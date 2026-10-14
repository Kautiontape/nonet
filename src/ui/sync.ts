/**
 * Sync, wired to this browser: the pure client (src/sync) over the store, the settings and
 * fetch, plus the triggers that run it. The only module that knows both the store and the
 * client. Nothing here blocks play; failures only change the status the Settings row shows.
 */
import { createSyncClient, type SyncClient, type SyncConfig } from "../sync/client";
import type { Data } from "../sync/merge";
import type { App } from "./app";
import { applySyncedSettings, syncedSettings, type SyncedSettings } from "./settings";
import { load, loadProgress, makeBackup, onChange, remove, save, saveQuiet } from "./store";

/** Not in the single-page artifact build: it is hosted away from the sync location. */
export const SYNC_AVAILABLE = import.meta.env.VITE_TARGET !== "artifact";

/** The keys that travel. `settings` goes as the synced subset only; `settingsAt` says when it last changed. */
const SYNCED = new Set(["progress", "results", "seen", "settings", "settingsAt", "game.classic", "game.killer", "game.queens"]);
/**
 * Saves that mean something to push. `settings` is left out: it is saved for a volume change
 * too, and `settingsAt` moves whenever a synced setting does.
 */
const TRIGGERS = new Set([...SYNCED].filter((k) => k !== "settings"));

/** How long after the last save to push, so a run of moves is one request. */
const DEBOUNCE_MS = 2000;

function read(): Data {
  // The once-only migration of an old progress record runs before the record is read raw.
  loadProgress();
  const data: Data = {};
  for (const [k, v] of Object.entries(makeBackup().data)) if (SYNCED.has(k) && k !== "settings") data[k] = v;
  data.settings = syncedSettings();
  return data;
}

let onWrite: (() => void) | null = null;

function write(data: Data): void {
  for (const [k, v] of Object.entries(data)) {
    if (!SYNCED.has(k) || k === "settings" || k === "settingsAt") continue;
    saveQuiet(k, v);
  }
  if (data.settings) applySyncedSettings(data.settings as Partial<SyncedSettings>, typeof data.settingsAt === "number" ? data.settingsAt : 0);
  onWrite?.();
}

const config = {
  get: () => load<SyncConfig | null>("sync", null),
  set: (c: SyncConfig | null) => (c ? save("sync", c) : remove("sync")),
};

/** The code this browser syncs with, or null while sync is off. */
export const syncCode = (): string | null => config.get()?.code ?? null;

let client: SyncClient | null = null;

/** The one client for this page, made on first use. */
export function syncClient(): SyncClient {
  client ??= createSyncClient({ fetch: (input, init) => fetch(input, init), base: `${location.origin}/api/sync/`, store: { read, write }, config });
  return client;
}

/**
 * Run sync: now, when the page comes back into view or online, soon after anything synced is
 * saved, and on the way out. A pull that changes anything rebuilds the home screen if it is
 * showing; a play screen keeps its own game (its next autosave is newer and wins).
 */
export function startSync(app: App): void {
  const c = syncClient();
  onWrite = () => app.refreshHome();
  let timer = 0;
  onChange((key) => {
    if (!TRIGGERS.has(key) || !config.get()) return;
    c.markPending();
    clearTimeout(timer);
    timer = window.setTimeout(() => void c.sync(), DEBOUNCE_MS);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void c.sync();
  });
  addEventListener("online", () => void c.sync());
  addEventListener("pagehide", () => {
    clearTimeout(timer);
    c.flush();
  });
  void c.sync();
}
