/** The changelog as a modal over Settings: each release's bullets, newest first. */
import { boldParts, changelog, versionLabel, type Release } from "../changelog";
import { h, svgIcon } from "../dom";
import { ICONS } from "../icons";
import { sound } from "../sound";
import { markSeen, newSections } from "../whats-new";

function heading(r: Release): string {
  if (!r.version) return "Next release";
  const [y, m, d] = r.date.split("-").map(Number) as [number, number, number];
  return `${r.version} · ${new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}

export function openChangelog(): void {
  sound.ui("open");
  const releases = changelog();
  // Releases since the player last looked get a tag; opening the changelog is the look.
  const tagged = newSections(releases.map((r) => r.version));
  const close = () => {
    sound.ui("close");
    overlay.classList.add("closing");
    overlay.addEventListener("animationend", () => overlay.remove(), { once: true });
    removeEventListener("keydown", onKey, true);
  };
  // Capture, and stop it there: Esc closes this modal, not the Settings sheet under it.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };
  addEventListener("keydown", onKey, true);
  const overlay = h(
    "div",
    { class: "overlay modal", role: "dialog", "aria-modal": "true", "aria-label": "Changelog", "data-testid": "changelog", onclick: (e: Event) => e.target === overlay && close() },
    h(
      "div",
      { class: "modal-card" },
      h(
        "header",
        { class: "sheet-head" },
        h("h2", null, "Changelog"),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, svgIcon(ICONS.close)),
      ),
      h(
        "div",
        { class: "changelog-list" },
        h("p", { class: "changelog-version" }, versionLabel()),
        ...(releases.length
          ? releases.map((r, i) =>
              h(
                "section",
                { "data-version": r.version ?? "unreleased", class: tagged[i] ? "new" : undefined },
                h("h3", null, heading(r), tagged[i] ? h("span", { class: "news-pill" }, "New") : null),
                h("ul", null, ...r.items.map((item) => h("li", null, ...boldParts(item).map((part, i) => (i % 2 ? h("b", null, part) : part))))),
              ),
            )
          : [h("p", null, "Nothing here yet.")]),
      ),
    ),
  );
  document.body.append(overlay);
  markSeen();
}
