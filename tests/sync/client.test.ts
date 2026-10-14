import { bucketId } from "../../src/sync/code";
import { createSyncClient, MESSAGES, type SyncConfig, type SyncStatus } from "../../src/sync/client";
import { BACKUP_VERSION, makeEnvelope } from "../../src/sync/envelope";
import type { Data } from "../../src/sync/merge";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  keepalive?: boolean;
}

/** A file store like the nginx location: GET with ETags and 304, HEAD, PUT, DELETE. */
function fakeServer() {
  const files = new Map<string, { body: string; etag: string }>();
  const calls: Call[] = [];
  let n = 0;
  let fail: "network" | number | null = null;
  let gate: (() => void) | null = null; // when set, each request waits until released
  const fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, headers, ...(typeof init.body === "string" ? { body: init.body } : {}), ...(init.keepalive ? { keepalive: true } : {}) });
    if (gate) await new Promise<void>((r) => (gate = r));
    if (fail === "network") throw new TypeError("Failed to fetch");
    if (typeof fail === "number") return new Response(null, { status: fail });
    const file = files.get(url);
    switch (method) {
      case "GET":
        if (!file) return new Response(null, { status: 404 });
        if (headers["If-None-Match"] === file.etag) return new Response(null, { status: 304 });
        return new Response(file.body, { status: 200, headers: { ETag: file.etag } });
      case "HEAD":
        return file ? new Response(null, { status: 200, headers: { ETag: file.etag } }) : new Response(null, { status: 404 });
      case "PUT": {
        const existed = files.has(url);
        files.set(url, { body: init.body as string, etag: `"e${++n}"` });
        return new Response(null, { status: existed ? 204 : 201 });
      }
      case "DELETE":
        return new Response(null, { status: files.delete(url) ? 204 : 404 });
      default:
        return new Response(null, { status: 403 });
    }
  };
  return {
    files,
    calls,
    fetch: fetch as typeof globalThis.fetch,
    setFail: (f: typeof fail) => (fail = f),
    hold: () => (gate = () => {}),
    release: () => {
      const g = gate;
      gate = null;
      g?.();
    },
    methods: () => calls.map((c) => c.method),
    put: async (code: string, data: Data, version = BACKUP_VERSION) =>
      files.set(`https://x/api/sync/${await bucketId(code)}.json`, { body: JSON.stringify({ ...makeEnvelope(data), version }), etag: `"e${++n}"` }),
    file: async (code: string) => {
      const f = files.get(`https://x/api/sync/${await bucketId(code)}.json`);
      if (!f) return null;
      const { version, data } = JSON.parse(f.body) as { version: number; data: Data };
      return { version, data };
    },
  };
}

function harness(local: Data = {}, config: SyncConfig | null = null) {
  const server = fakeServer();
  const writes: Data[] = [];
  const statuses: SyncStatus[] = [];
  let cfg = config;
  let clock = 1_000_000;
  const client = createSyncClient({
    fetch: server.fetch,
    base: "https://x/api/sync/",
    store: {
      read: () => structuredClone(local),
      write: (d) => {
        local = d;
        writes.push(d);
      },
    },
    config: { get: () => cfg, set: (c) => (cfg = c) },
    now: () => clock,
  });
  client.onStatus((s) => statuses.push(s));
  return { server, client, writes, statuses, local: () => local, config: () => cfg, tick: (ms = 1000) => (clock += ms) };
}

const CODE = "ABCD2345EFGH6789";

describe("sync client", () => {
  it("turning on makes a code, pushes what is here as the first cloud copy, and remembers the ETag", async () => {
    const h = harness({ seen: ["a"] });
    await h.client.turnOn();
    const cfg = h.config()!;
    expect(cfg.code).toMatch(/^[0-9A-Z]{16}$/);
    expect(cfg.pending).toBe(false);
    expect(cfg.etag).toBe('"e1"');
    expect(cfg.lastSync).toBe(1_000_000);
    expect(h.server.methods()).toEqual(["GET", "PUT", "HEAD"]);
    expect(await h.server.file(cfg.code)).toEqual({ version: BACKUP_VERSION, data: { seen: ["a"] } });
    expect(h.server.calls[1]!.headers["Content-Type"]).toBe("application/json");
    expect(h.writes).toEqual([]);
    expect(h.client.status()).toEqual({ state: "synced", lastSync: 1_000_000 });
  });

  it("pulls what the cloud has and writes the merge locally; pushes only when this side had more", async () => {
    const h = harness({ seen: ["a"] }, { code: CODE, pending: false });
    await h.server.put(CODE, { seen: ["a", "b"], results: [] });
    await h.client.sync();
    expect(h.writes).toEqual([{ seen: ["a", "b"], results: [] }]);
    expect(h.server.methods()).toEqual(["GET"]);
    expect(h.config()!.etag).toBe('"e1"');

    // Now the cloud has less than we do (another device would have pushed more; here, a new local key).
    h.local().seen = ["a", "b"];
    const h2 = harness({ seen: ["a", "b", "c"] }, { code: CODE, pending: false });
    await h2.server.put(CODE, { seen: ["a", "b"] });
    await h2.client.sync();
    expect(h2.writes).toEqual([]);
    expect(h2.server.methods()).toEqual(["GET", "PUT", "HEAD"]);
    expect((await h2.server.file(CODE))!.data).toEqual({ seen: ["a", "b", "c"] });
  });

  it("a 304 means nothing to merge; a pending change still goes up", async () => {
    const h = harness({ seen: ["a"] });
    await h.client.turnOn();
    h.server.calls.length = 0;
    await h.client.sync();
    expect(h.server.methods()).toEqual(["GET"]);
    expect(h.server.calls[0]!.headers["If-None-Match"]).toBe('"e1"');
    expect(h.writes).toEqual([]);

    h.local().seen = ["a", "b"];
    h.client.markPending();
    expect(h.config()!.pending).toBe(true);
    h.server.calls.length = 0;
    await h.client.sync();
    expect(h.server.methods()).toEqual(["GET", "PUT", "HEAD"]);
    expect(h.config()).toMatchObject({ pending: false, etag: '"e2"' });
    expect((await h.server.file(h.config()!.code))!.data).toEqual({ seen: ["a", "b"] });
  });

  it("leaves a newer app's cloud copy alone and says so", async () => {
    const h = harness({ seen: ["a"] }, { code: CODE, pending: true });
    await h.server.put(CODE, { seen: ["z"] }, BACKUP_VERSION + 1);
    await h.client.sync();
    expect(h.server.methods()).toEqual(["GET"]);
    expect(h.writes).toEqual([]);
    expect(h.client.status()).toMatchObject({ state: "outdated", message: MESSAGES.outdated });
    expect(h.config()!.pending).toBe(true);
  });

  it("treats a file that isn't an envelope as empty and replaces it", async () => {
    const h = harness({ seen: ["a"] }, { code: CODE, pending: false });
    h.server.files.set(`https://x/api/sync/${await bucketId(CODE)}.json`, { body: "garbage", etag: '"g"' });
    await h.client.sync();
    expect(h.server.methods()).toEqual(["GET", "PUT", "HEAD"]);
    expect((await h.server.file(CODE))!.data).toEqual({ seen: ["a"] });
  });

  it("offline keeps the change pending and the status says so; a server error likewise", async () => {
    const h = harness({ seen: ["a"] }, { code: CODE, pending: true });
    h.server.setFail("network");
    await h.client.sync();
    expect(h.client.status()).toMatchObject({ state: "offline", message: MESSAGES.offline });
    expect(h.config()).toEqual({ code: CODE, pending: true });
    h.server.setFail(500);
    await h.client.sync();
    expect(h.client.status()).toMatchObject({ state: "error", message: MESSAGES.error });
    expect(h.config()!.pending).toBe(true);
    h.server.setFail(null);
    await h.client.sync();
    expect(h.client.status().state).toBe("synced");
    expect(h.config()!.pending).toBe(false);
  });

  it("joining needs a real code and an existing cloud copy, then merges rather than replaces", async () => {
    const h = harness({ seen: ["mine"] });
    expect(await h.client.join("nope")).toBe(MESSAGES.badCode);
    expect(await h.client.join("abcd-2345-efgh-6789")).toBe(MESSAGES.notFound);
    expect(h.config()).toBeNull();
    expect(h.client.status().state).toBe("off");

    await h.server.put(CODE, { seen: ["theirs"] });
    h.server.calls.length = 0;
    expect(await h.client.join(" abcd 2345 efgh 6789 ")).toBeNull();
    expect(h.config()).toMatchObject({ code: CODE, pending: false });
    expect(h.local()).toEqual({ seen: ["mine", "theirs"] });
    expect((await h.server.file(CODE))!.data).toEqual({ seen: ["mine", "theirs"] });
    expect(h.client.status().state).toBe("synced");
  });

  it("joining can't reach the server, or finds a newer app's copy: a message and nothing saved", async () => {
    const h = harness();
    h.server.setFail("network");
    expect(await h.client.join(CODE)).toBe(MESSAGES.unreachable);
    h.server.setFail(null);
    await h.server.put(CODE, {}, BACKUP_VERSION + 1);
    expect(await h.client.join(CODE)).toBe(MESSAGES.joinNewer);
    expect(h.config()).toBeNull();
  });

  it("turning off forgets the code, and deletes the cloud copy only when asked", async () => {
    const h = harness({ seen: ["a"] });
    await h.client.turnOn();
    const code = h.config()!.code;
    await h.client.turnOff(false);
    expect(h.config()).toBeNull();
    expect(h.client.status()).toEqual({ state: "off" });
    expect(await h.server.file(code)).not.toBeNull();
    expect(h.server.methods()).not.toContain("DELETE");

    await h.client.join(code);
    await h.client.turnOff(true);
    expect(h.server.methods()).toContain("DELETE");
    expect(await h.server.file(code)).toBeNull();
    await h.client.sync();
    expect(h.client.status()).toEqual({ state: "off" });
  });

  it("runs one cycle at a time; a change during a cycle is not lost", async () => {
    const h = harness({ seen: ["a"] });
    await h.client.turnOn();
    h.server.calls.length = 0;
    h.server.hold();
    const first = h.client.sync();
    await new Promise((r) => setTimeout(r, 0)); // let the cycle reach its GET
    // While the GET is in flight: a local change and two more requests to sync.
    h.local().seen = ["a", "b"];
    h.client.markPending();
    const second = h.client.sync();
    const third = h.client.sync();
    expect(h.server.methods()).toEqual(["GET"]);
    h.server.release();
    await Promise.all([first, second, third]);
    // The first cycle saw a 304 and nothing pending when it read the store, but the change came
    // after: it pushes anyway (pending was set before it checked) and the queued rerun is quiet.
    expect(h.server.methods().filter((m) => m === "PUT")).toHaveLength(1);
    expect((await h.server.file(h.config()!.code))!.data).toEqual({ seen: ["a", "b"] });
    expect(h.config()!.pending).toBe(false);
  });

  it("flush fires a keepalive push of what is pending without waiting, and only when there is something", async () => {
    const h = harness({ seen: ["a"] });
    expect(h.client.flush()).toBe(false);
    await h.client.turnOn();
    expect(h.client.flush()).toBe(false);
    h.local().seen = ["a", "b"];
    h.client.markPending();
    h.server.calls.length = 0;
    expect(h.client.flush()).toBe(true);
    expect(h.server.calls).toEqual([expect.objectContaining({ method: "PUT", keepalive: true })]);
    expect(JSON.parse(h.server.calls[0]!.body!).data).toEqual({ seen: ["a", "b"] });
  });
});
