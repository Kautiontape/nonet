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

export default defineConfig({
  // Relative asset paths so the build runs from any sub-path (static hosting, file previews, /beta/).
  base: "./",
  plugins: [channel()],
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    globals: true,
  },
});
