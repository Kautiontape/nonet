/**
 * The changelog shown under Settings: CHANGELOG.md, bundled as text and read with a parser that
 * knows only the format docs/CHANGELOG-STYLE.md allows (release headings, bullets, **bold**).
 */
import changelogText from "../../CHANGELOG.md?raw";

export interface Release {
  /** "0.1.0", or null for the Unreleased section. */
  version: string | null;
  /** YYYY-MM-DD; empty for Unreleased. */
  date: string;
  items: string[];
}

/** `## Unreleased` or `## 0.1.0 — 2026-10-14` (an en/em dash or a hyphen between). */
export const HEADING = /^## (?:Unreleased|(\d+\.\d+\.\d+) [—–-] (\d{4}-\d\d-\d\d))\s*$/;

/** Releases in file order (newest first). Anything else (title, intro, blank lines) is skipped. */
export function parseChangelog(text: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      const m = HEADING.exec(line);
      current = m ? { version: m[1] ?? null, date: m[2] ?? "", items: [] } : null;
      if (current) releases.push(current);
    } else if (current && line.startsWith("- ")) {
      current.items.push(line.slice(2).trim());
    } else if (current && current.items.length && /^\s{2,}\S/.test(line)) {
      // A bullet wrapped onto the next line.
      current.items[current.items.length - 1] += ` ${line.trim()}`;
    }
  }
  return releases.filter((r) => r.items.length);
}

/** Split `**bold**` out of a bullet: odd-indexed parts are bold. */
export function boldParts(item: string): string[] {
  return item.split(/\*\*(.+?)\*\*/);
}

/** The newest release the changelog names ("1.0.0"); Unreleased isn't one. Null before the first. */
export function latestRelease(text = changelogText): string | null {
  return parseChangelog(text).find((r) => r.version)?.version ?? null;
}

/** This build's `git describe`: "v0.1.0" at a release, "v0.1.0-3-gabc1234" past one. */
export const VERSION = __APP_VERSION__;

/** Built exactly at a release tag (production), as opposed to a beta or local build. */
export const isRelease = (v: string): boolean => /^v\d+\.\d+\.\d+$/.test(v);

export function versionLabel(v = VERSION, beta = import.meta.env.VITE_CHANNEL === "beta"): string {
  if (isRelease(v)) return `Version ${v.slice(1)}${beta ? " beta" : ""}`;
  return `${beta ? "Beta" : "Build"} ${v}`;
}

/** What the modal lists: a release build leaves out Unreleased, which isn't in it. */
export function changelog(text = changelogText, v = VERSION): Release[] {
  const all = parseChangelog(text);
  return isRelease(v) ? all.filter((r) => r.version) : all;
}
