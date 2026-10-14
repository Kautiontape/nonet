import { expect, test, type BrowserContext } from "@playwright/test";

interface File {
  body: string;
  etag: string;
}

/** The nginx sync location, in memory: one map, shared by every context routed through it. */
function syncServer() {
  const files = new Map<string, File>();
  let n = 0;
  const route = (context: BrowserContext) =>
    context.route("**/api/sync/*", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const file = files.get(path);
      const headers = { "Cache-Control": "no-store" };
      switch (req.method()) {
        case "GET":
          if (!file) return route.fulfill({ status: 404, headers });
          if (req.headers()["if-none-match"] === file.etag) return route.fulfill({ status: 304, headers });
          return route.fulfill({ status: 200, body: file.body, headers: { ...headers, ETag: file.etag, "Content-Type": "application/json" } });
        case "HEAD":
          return route.fulfill({ status: file ? 200 : 404, headers: file ? { ...headers, ETag: file.etag } : headers });
        case "PUT": {
          const existed = files.has(path);
          files.set(path, { body: req.postData() ?? "", etag: `"e${++n}"` });
          return route.fulfill({ status: existed ? 204 : 201, headers });
        }
        case "DELETE":
          return route.fulfill({ status: files.delete(path) ? 204 : 404, headers });
        default:
          return route.fulfill({ status: 403, headers });
      }
    });
  const only = () => JSON.parse([...files.values()][0]!.body) as { version: number; data: Record<string, unknown> };
  return { files, route, only };
}

const LEGACY_PROGRESS = { solved: { "classic-easy": ["classic-easy-1", "classic-easy-2"] }, best: { "classic-easy": 90_000 }, hinted: { "naked-single": 1 }, total: 2, streak: { last: "", days: 0 } };

test("sync: turn it on from one device and join from another; scores and gameplay settings follow, the feel settings don't", async ({ browser }) => {
  const server = syncServer();
  const a = await browser.newContext();
  const b = await browser.newContext();
  await Promise.all([server.route(a), server.route(b)]);
  const pa = await a.newPage();
  const pb = await b.newPage();

  // Device A has history (in the shape from before sync, so the migration runs too) and Calm effects.
  await pa.goto("/");
  await pa.evaluate((p) => localStorage.setItem("cagecoach.progress", JSON.stringify(p)), LEGACY_PROGRESS);
  await pa.reload();
  await pa.getByTestId("open-settings").click();
  const sa = pa.getByTestId("settings");
  await sa.getByRole("radio", { name: "Calm" }).click();
  await sa.getByRole("tab", { name: "Data" }).click();
  await expect(sa.getByTestId("sync-on")).toBeVisible();
  await sa.getByTestId("sync-on").click();
  await expect(sa.getByTestId("sync-status")).toContainText("Synced");
  const code = (await sa.getByTestId("sync-code").textContent())!;
  expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  await sa.getByTestId("sync-row").screenshot({ path: "test-results/screens/sync-on.png" });
  expect(server.files.size).toBe(1);
  const pushed = server.only();
  expect(pushed.version).toBe(2);
  expect(pushed.data.progress).toMatchObject({ solved: { "classic-easy": ["classic-easy-1", "classic-easy-2"] } });
  expect(Object.values((pushed.data.progress as { counters: Record<string, { total: number }> }).counters).map((c) => c.total)).toEqual([2]);
  expect(pushed.data.settings).toEqual({
    highlightSame: true,
    autoClearNotes: true,
    autoNotes: false,
    checkMistakes: true,
    showTimer: true,
    cageTint: true,
    showCombos: true,
    autoCross: true,
  });
  expect(pushed.data).not.toHaveProperty("device");
  expect(pushed.data).not.toHaveProperty("sync");

  // Device B joins by typing the code, in lower case with spaces.
  await pb.goto("/");
  await pb.getByTestId("open-settings").click();
  const sb = pb.getByTestId("settings");
  await sb.getByRole("tab", { name: "Data" }).click();
  await sb.getByTestId("sync-have-code").click();
  await sb.getByTestId("sync-code-input").fill(code.toLowerCase().replace(/-/g, " "));
  await sb.getByTestId("sync-join").click();
  await expect(sb.getByTestId("sync-code")).toHaveText(code);
  await expect(sb.getByTestId("sync-status")).toContainText("Synced");
  await pb.keyboard.press("Escape");
  await expect(pb.getByTestId("play-classic-easy")).toContainText("2 solved");
  await pb.getByTestId("open-scores").click();
  await expect(pb.getByTestId("scores")).toContainText("2 cleared");
  await expect(pb.getByTestId("scores")).toContainText("1:30");
  await pb.keyboard.press("Escape");

  // B turns the timer off. A gets that on its next sync, and keeps its own effects level.
  await pb.getByTestId("open-settings").click();
  await sb.getByRole("tab", { name: "Play" }).click();
  await sb.locator('input[data-key="showTimer"]').uncheck({ force: true });
  await expect.poll(() => (server.only().data.settings as { showTimer: boolean }).showTimer, { timeout: 10_000 }).toBe(false);
  await pa.reload();
  await pa.getByTestId("open-settings").click();
  await sa.getByRole("tab", { name: "Data" }).click();
  await expect(sa.getByTestId("sync-status")).toContainText("Synced");
  await sa.getByRole("tab", { name: "Play" }).click();
  await expect(sa.locator('input[data-key="showTimer"]')).not.toBeChecked();
  await sa.getByRole("tab", { name: "Sound & feel" }).click();
  await expect(sa.getByRole("radio", { name: "Calm" })).toHaveAttribute("aria-checked", "true");

  // Turning off on B keeps the cloud copy and everything local.
  await sa.getByRole("tab", { name: "Data" }).click();
  await sb.getByRole("tab", { name: "Data" }).click();
  await sb.getByTestId("sync-off").click();
  await sb.getByTestId("sync-off-keep").click();
  await expect(sb.getByTestId("sync-on")).toBeVisible();
  expect(server.files.size).toBe(1);
  await pb.keyboard.press("Escape");
  await expect(pb.getByTestId("play-classic-easy")).toContainText("2 solved");

  await a.close();
  await b.close();
});

test("sync: a code nobody turned on is refused; a sync link opens the join prompt and leaves a clean address", async ({ browser }) => {
  const server = syncServer();
  const ctx = await browser.newContext();
  await server.route(ctx);
  const page = await ctx.newPage();

  await page.goto("/");
  await page.getByTestId("open-settings").click();
  const sheet = page.getByTestId("settings");
  await sheet.getByRole("tab", { name: "Data" }).click();
  await sheet.getByTestId("sync-have-code").click();
  await sheet.getByTestId("sync-code-input").fill("ABCD-2345-EFGH-6789");
  await sheet.getByTestId("sync-join").click();
  await expect(sheet.getByTestId("sync-status")).toContainText("No sync found for that code");
  await sheet.getByTestId("sync-code-input").fill("not a code");
  await sheet.getByTestId("sync-join").click();
  await expect(sheet.getByTestId("sync-status")).toContainText("doesn't look like a sync code");
  await sheet.getByTestId("sync-cancel").click();
  await expect(sheet.getByTestId("sync-on")).toBeVisible();
  await sheet.getByTestId("sync-on").click();
  const code = (await sheet.getByTestId("sync-code").textContent())!;
  await page.keyboard.press("Escape");

  // Another device opens the shared link.
  const other = await browser.newContext();
  await server.route(other);
  const link = await other.newPage();
  await link.goto(`/?sync=${code.replace(/-/g, "")}`);
  const prompt = link.getByTestId("settings");
  await expect(prompt).toContainText("Join this sync?");
  await expect(prompt.getByTestId("sync-code-input")).toHaveValue(code.replace(/-/g, ""));
  expect(new URL(link.url()).search).toBe("");
  await prompt.getByTestId("sync-join").click();
  await expect(prompt.getByTestId("sync-code")).toHaveText(code);
  await expect(prompt.getByTestId("sync-status")).toContainText("Synced");

  await ctx.close();
  await other.close();
});
