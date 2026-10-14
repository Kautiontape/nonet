import { readFileSync } from "node:fs";

/**
 * The service worker, run in Node against fakes: what `install` puts in the cache decides what
 * works offline, and nothing in the e2e suite exercises a worker (the preview server is http).
 */
function loadWorker(html: string, missing = new Set<string>()) {
  const src = readFileSync("public/sw.js", "utf8");
  const handlers: Record<string, (event: unknown) => void> = {};
  const store = new Map<string, string>();
  const requested: string[] = [];
  const cache = {
    add: async (url: string) => {
      const res = await fetchFake(url);
      if (!res.ok) throw new Error(`add ${url}: ${res.status}`);
      store.set(url, await res.text());
    },
    addAll: async (urls: string[]) => {
      for (const u of urls) await cache.add(u);
    },
    put: async (req: string | { url: string }, res: Response) => void store.set(typeof req === "string" ? req : req.url, await res.text()),
    match: async (req: string | { url: string }) => {
      const v = store.get(typeof req === "string" ? req : req.url);
      return v === undefined ? undefined : new Response(v);
    },
    keys: async () => [...store.keys()].map((url) => ({ url })),
  };
  const fetchFake = async (url: string): Promise<Response> => {
    requested.push(url);
    if (missing.has(url)) return new Response(null, { status: 404 });
    if (url === "./") return new Response(html, { status: 200 });
    if (url.startsWith("./packs/") || url.startsWith("./assets/") || url.startsWith("./icons/") || url.endsWith(".webmanifest")) return new Response("{}", { status: 200 });
    return new Response(null, { status: 404 });
  };
  const self = {
    registration: { scope: "https://example.test/" },
    location: { origin: "https://example.test" },
    addEventListener: (name: string, fn: (event: unknown) => void) => (handlers[name] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: cache.match };
  new Function("self", "caches", "fetch", src)(self, caches, fetchFake);
  const fire = async (name: string) => {
    const waits: Promise<unknown>[] = [];
    handlers[name]!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { fire, store, requested };
}

const HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="./assets/index-abc123.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-def456.css">
<link rel="manifest" href="./manifest.webmanifest">
</head><body></body></html>`;

describe("service worker install", () => {
  it("caches every puzzle pack and the page's script and stylesheet, so one online visit makes the app playable offline", async () => {
    const w = loadWorker(HTML);
    await w.fire("install");
    const keys = [...w.store.keys()];
    for (const mode of ["classic", "killer", "queens"])
      for (const d of ["easy", "medium", "hard", "expert"]) expect(keys, `${mode}-${d}`).toContain(`./packs/${mode}-${d}.json`);
    expect(keys).toContain("./packs/examples.json");
    expect(keys).toContain("./assets/index-abc123.js");
    expect(keys).toContain("./assets/index-def456.css");
    expect(keys).toContain("./");
  });

  it("still installs when a file is missing, so one bad file never blocks offline support for the rest", async () => {
    const w = loadWorker(HTML, new Set(["./packs/classic-easy.json", "./assets/index-abc123.js"]));
    await expect(w.fire("install")).resolves.toBeUndefined();
    const keys = [...w.store.keys()];
    expect(keys).toContain("./packs/queens-hard.json");
    expect(keys).toContain("./assets/index-def456.css");
    expect(keys).not.toContain("./packs/classic-easy.json");
    expect(w.requested).toContain("./packs/classic-easy.json");
  });
});
