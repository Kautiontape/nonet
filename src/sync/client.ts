/**
 * The sync cycle: pull the cloud copy, merge it with what is here, write back what changed, and
 * push when this device has something the cloud lacks. Pure: fetch, storage and the clock come
 * in through `deps`, so it runs and is tested in Node.
 *
 * The server is a file store (one GET/PUT/DELETE per player, see deploy/README.md). Nobody plays
 * on two devices at once, so there is no compare-and-swap: a push simply replaces the file, and
 * the merge makes the order of pushes irrelevant. Nothing here ever blocks play: a failure only
 * changes the status, and the next trigger tries again.
 */
import { bucketId, generateCode, normalizeCode } from "./code";
import { deepEqual } from "./equal";
import { makeEnvelope, readEnvelope } from "./envelope";
import { merge, type Data } from "./merge";

export interface SyncConfig {
  code: string;
  /** The cloud file's ETag after the last pull or push, for conditional GETs. */
  etag?: string;
  /** When the last cycle finished without error (ms since the epoch). */
  lastSync?: number;
  /** Something saved here hasn't reached the cloud. */
  pending: boolean;
}

export type SyncState = "off" | "syncing" | "synced" | "offline" | "error" | "outdated";

export interface SyncStatus {
  state: SyncState;
  lastSync?: number;
  /** What to show when the state alone doesn't say enough. */
  message?: string;
}

export interface SyncDeps {
  fetch: typeof fetch;
  /** Absolute URL of the sync directory, ending in "/". */
  base: string;
  /** The synced keys only (the adapter projects them). */
  store: { read(): Data; write(data: Data): void };
  config: { get(): SyncConfig | null; set(c: SyncConfig | null): void };
  now?: () => number;
}

export interface SyncClient {
  /** One cycle. A call while one runs queues one more; the promise settles when all of it is done. */
  sync(): Promise<void>;
  /** Make a code and push what is here as the first cloud copy. */
  turnOn(): Promise<void>;
  /** Join the sync another device shows. Resolves to null, or the message to show instead. */
  join(text: string): Promise<string | null>;
  turnOff(deleteCloud: boolean): Promise<void>;
  /** Something synced was saved here: push on the next cycle. */
  markPending(): void;
  /** The page is going away: push pending changes without waiting, if the bucket is known. */
  flush(): boolean;
  status(): SyncStatus;
  onStatus(fn: (s: SyncStatus) => void): () => void;
}

export const MESSAGES = {
  offline: "Offline, will sync later",
  error: "Couldn't sync",
  outdated: "Update Nonet to sync",
  badCode: "That doesn't look like a sync code.",
  notFound: "No sync found for that code. Check it and try again.",
  unreachable: "Couldn't reach the sync server. Check your connection and try again.",
  joinNewer: "Update Nonet to join this sync.",
} as const;

export function createSyncClient(deps: SyncDeps): SyncClient {
  const now = deps.now ?? (() => Date.now());
  const listeners = new Set<(s: SyncStatus) => void>();
  let status: SyncStatus = deps.config.get() ? { state: "syncing", lastSync: deps.config.get()?.lastSync } : { state: "off" };
  const setStatus = (s: SyncStatus) => {
    status = s;
    for (const fn of listeners) fn(s);
  };

  // Each code's file URL, remembered so a flush on the way out needs no async work.
  const urls = new Map<string, string>();
  async function fileUrl(code: string): Promise<string> {
    let url = urls.get(code);
    if (!url) {
      url = `${deps.base}${await bucketId(code)}.json`;
      urls.set(code, url);
    }
    return url;
  }

  // Bumped by every local change; a cycle that read the store before a bump leaves `pending` set.
  let version = 0;

  async function cycle(): Promise<void> {
    const cfg = deps.config.get();
    if (!cfg) {
      setStatus({ state: "off" });
      return;
    }
    setStatus({ state: "syncing", lastSync: cfg.lastSync });
    const url = await fileUrl(cfg.code);
    const fail = (state: "offline" | "error" | "outdated") => setStatus({ state, lastSync: cfg.lastSync, message: MESSAGES[state] });

    let res: Response;
    try {
      res = await deps.fetch(url, { cache: "no-store", headers: cfg.etag ? { "If-None-Match": cfg.etag } : {} });
    } catch {
      return fail("offline");
    }
    let remote: Data | null = null; // null: unchanged since the last cycle (304)
    let missing = false;
    let etag = cfg.etag;
    if (res.status === 404) {
      remote = {};
      missing = true;
      etag = undefined;
    } else if (res.ok) {
      const env = readEnvelope(await res.text());
      if (env === "newer") return fail("outdated");
      // Not an envelope at all: nothing to take from it, and the next push replaces it.
      if (!env) missing = true;
      remote = env ? env.data : {};
      etag = res.headers.get("ETag") ?? undefined;
    } else if (res.status !== 304) {
      return fail("error");
    }

    const readAt = version;
    const local = deps.store.read();
    let merged = local;
    if (remote) {
      merged = merge(local, remote);
      if (!deepEqual(merged, local)) deps.store.write(merged);
    }
    const cur = deps.config.get();
    if (!cur || cur.code !== cfg.code) return; // turned off or switched meanwhile
    const push = cur.pending || missing || (remote !== null && !deepEqual(merged, remote));
    if (push) {
      try {
        const put = await deps.fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(makeEnvelope(merged, new Date(now()))),
        });
        if (!put.ok) return fail("error");
        const head = await deps.fetch(url, { method: "HEAD", cache: "no-store" });
        etag = head.ok ? (head.headers.get("ETag") ?? undefined) : undefined;
      } catch {
        return fail("offline");
      }
    }
    const latest = deps.config.get();
    if (!latest || latest.code !== cfg.code) return;
    const lastSync = now();
    deps.config.set({ ...latest, etag, lastSync, pending: version !== readAt });
    setStatus({ state: "synced", lastSync });
  }

  let running: Promise<void> | null = null;
  let again = false;
  function sync(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await cycle();
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    sync,
    status: () => status,
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    markPending() {
      version++;
      const cfg = deps.config.get();
      if (cfg && !cfg.pending) deps.config.set({ ...cfg, pending: true });
    },
    async turnOn() {
      const code = generateCode();
      deps.config.set({ code, pending: true });
      await fileUrl(code);
      await sync();
    },
    async join(text) {
      const code = normalizeCode(text);
      if (!code) return MESSAGES.badCode;
      let res: Response;
      try {
        res = await deps.fetch(await fileUrl(code), { cache: "no-store" });
      } catch {
        return MESSAGES.unreachable;
      }
      if (res.status === 404) return MESSAGES.notFound;
      if (!res.ok) return MESSAGES.error;
      if (readEnvelope(await res.text()) === "newer") return MESSAGES.joinNewer;
      // Pending: what is here goes up too, so joining merges and never replaces.
      deps.config.set({ code, pending: true });
      await sync();
      return null;
    },
    async turnOff(deleteCloud) {
      const cfg = deps.config.get();
      deps.config.set(null);
      if (cfg && deleteCloud) {
        try {
          await deps.fetch(await fileUrl(cfg.code), { method: "DELETE" });
        } catch {
          /* the file stays until the cleanup timer; nothing to tell the player */
        }
      }
      setStatus({ state: "off" });
    },
    flush() {
      const cfg = deps.config.get();
      const url = cfg && urls.get(cfg.code);
      if (!cfg || !url || !cfg.pending) return false;
      const body = JSON.stringify(makeEnvelope(deps.store.read(), new Date(now())));
      void deps.fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      return true;
    },
  };
}
