import { readFileSync } from "node:fs";
import { boldParts, changelog, HEADING, parseChangelog, versionLabel } from "../../src/ui/changelog";

const SAMPLE = `# Changelog

Intro text, skipped.

## Unreleased

- **Backups.** Save one from Settings.

## 0.2.0 — 2026-10-14

- Hints go one step at a time,
  even in killer.
- Fixed: the timer kept running.

## 0.1.0 - 2026-10-01

## Not a release heading

- Never shown.
`;

describe("changelog", () => {
  it("reads releases, bullets and wrapped lines; empty or unknown sections are dropped", () => {
    expect(parseChangelog(SAMPLE)).toEqual([
      { version: null, date: "", items: ["**Backups.** Save one from Settings."] },
      { version: "0.2.0", date: "2026-10-14", items: ["Hints go one step at a time, even in killer.", "Fixed: the timer kept running."] },
    ]);
  });

  it("leaves Unreleased out of a release build only", () => {
    expect(changelog(SAMPLE, "v0.2.0").map((r) => r.version)).toEqual(["0.2.0"]);
    expect(changelog(SAMPLE, "v0.2.0-3-gabc1234").map((r) => r.version)).toEqual([null, "0.2.0"]);
    expect(changelog(SAMPLE, "abc1234").map((r) => r.version)).toEqual([null, "0.2.0"]);
  });

  it("splits out bold and labels the version", () => {
    expect(boldParts("**Backups.** Save one.")).toEqual(["", "Backups.", " Save one."]);
    expect(versionLabel("v0.2.0", false)).toBe("Version 0.2.0");
    expect(versionLabel("v0.2.0-3-gabc1234", true)).toBe("Beta v0.2.0-3-gabc1234");
    expect(versionLabel("abc1234", false)).toBe("Build abc1234");
  });

  // CHANGELOG.md is shown to players as is: hold it to docs/CHANGELOG-STYLE.md.
  describe("CHANGELOG.md follows the style guide", () => {
    const text = readFileSync("CHANGELOG.md", "utf8");
    const releases = parseChangelog(text);

    it("has only headings the app can read, Unreleased first, versions newest first", () => {
      for (const line of text.split("\n").filter((l) => l.startsWith("## "))) expect(line).toMatch(HEADING);
      const versions = releases.filter((r) => r.version).map((r) => r.version!.split(".").map(Number));
      for (let i = 1; i < versions.length; i++) {
        const [a, b] = [versions[i - 1]!, versions[i]!];
        expect(a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!).toBeGreaterThan(0);
      }
      expect(releases.slice(1).every((r) => r.version)).toBe(true);
    });

    it("keeps releases short and bullets to a sentence or two", () => {
      for (const r of releases) {
        expect(r.items.length, `${r.version ?? "Unreleased"} has more than 8 bullets`).toBeLessThanOrEqual(8);
        for (const item of r.items) expect(item.split(/\s+/).length, item).toBeLessThanOrEqual(30);
      }
    });
  });
});
