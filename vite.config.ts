import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * VITE_CHANNEL=beta builds a copy that announces itself — page title, manifest name (so an
 * installed beta sits beside the real app as "Nonet Beta") and a tag on the home screen (read
 * from import.meta.env.VITE_CHANNEL). The deploy serves it at /beta/; relative paths do the rest.
 */
function channel(): Plugin {
  const name = process.env.VITE_CHANNEL === "beta" ? "Nonet Beta" : null;
  let outDir = "dist";
  return {
    name: "nonet-channel",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    transformIndexHtml(html) {
      return name ? html.replace("<title>Nonet</title>", `<title>${name}</title>`) : html;
    },
    closeBundle() {
      if (!name) return;
      const file = join(outDir, "manifest.webmanifest");
      const m = JSON.parse(readFileSync(file, "utf8")) as { name: string; short_name: string };
      m.name = name;
      m.short_name = name;
      writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
    },
  };
}

/**
 * The build's version, shown under Settings: `git describe` of the checkout, so it is "v0.1.0" at a
 * release tag, "v0.1.0-3-gabc1234" three commits past it, and a bare hash before the first tag.
 */
function version(): string {
  try {
    return execSync('git describe --tags --always --match "v*"', { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return `v${(JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version}`;
  }
}

export default defineConfig({
  // Relative asset paths so the build runs from any sub-path (static hosting, file previews, /beta/).
  base: "./",
  plugins: [channel()],
  define: { __APP_VERSION__: JSON.stringify(version()) },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    globals: true,
    // The solve-on-hints tests take ~1s here but 3–6s on the deploy runner (a shared host running
    // every file at once), where the 5s default failed deploys.
    testTimeout: 20_000,
  },
});
