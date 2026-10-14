/**
 * Build a self-contained copy of the app for sharing as a hosted page (e.g. a claude.ai artifact):
 *
 *   npx tsx scripts/build-artifact.ts <outDir>
 *
 * Produces <outDir>/nonet.html (page body only — the host supplies doctype/head/body), plus
 * assets/ and packs/ beside it, and prints the supporting-file list. Service worker registration is
 * compiled out (VITE_TARGET=artifact), and the screen sizing adapts to a host frame that already
 * pads for safe areas.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? "dist-artifact");
const build = join(out, ".build");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

execFileSync("npx", ["vite", "build", "--outDir", build, "--emptyOutDir"], {
  stdio: "inherit",
  env: { ...process.env, VITE_TARGET: "artifact" },
});

const html = readFileSync(join(build, "index.html"), "utf8");
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]!);
const js = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]!);
if (!css.length || !js.length) throw new Error("couldn't find built assets in index.html");

// Inside a host frame the root already pads for safe areas: size screens to the frame, not 100dvh.
const frameFit = `html,body{height:100%}#app{height:100%}.play{height:100%;padding-top:0}.home{min-height:100%;padding-top:24px}`;
const page = [
  `<title>Nonet</title>`,
  `<meta name="theme-color" content="#03040c">`,
  ...css.map((href) => `<link rel="stylesheet" href="${href.replace(/^\.\//, "")}">`),
  `<style>${frameFit}</style>`,
  `<div id="app"></div>`,
  ...js.map((src) => `<script type="module" src="${src.replace(/^\.\//, "")}"></script>`),
].join("\n");
writeFileSync(join(out, "nonet.html"), page + "\n");

cpSync(join(build, "assets"), join(out, "assets"), { recursive: true });
cpSync(join(build, "packs"), join(out, "packs"), { recursive: true });
// The app doesn't read the v2 packs yet; they stay out of the artifact until it does.
rmSync(join(out, "packs", "v2"), { recursive: true, force: true });
rmSync(build, { recursive: true, force: true });

const files = [
  ...readdirSync(join(out, "assets")).map((f) => `assets/${f}`),
  ...readdirSync(join(out, "packs")).map((f) => `packs/${f}`),
];
console.log(JSON.stringify({ page: join(out, "nonet.html"), root: out, files }, null, 2));
