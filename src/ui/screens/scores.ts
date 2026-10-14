/**
 * Scores: records (best time and levels cleared) for every mode and difficulty, then the history
 * of finished levels, newest first. An overlay, so it opens mid-game without losing the board.
 */
import { DIFFICULTIES } from "../../engine/types";
import { formatTime, h, svgIcon } from "../dom";
import { ICONS } from "../icons";
import { DIFFICULTY_LABEL, MODE_LABEL } from "../messages";
import { sound } from "../sound";
import { loadProgress, loadResults, type ResultEntry } from "../store";

type Filter = "all" | "classic" | "killer" | "queens";

const TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "classic", label: "Sudoku" },
  { id: "killer", label: "Killer" },
  { id: "queens", label: "Queens" },
];

const MODES = ["classic", "killer", "queens"] as const;

/** "Today 14:05", "Yesterday 09:12", "Mon 18:40", or "3 Oct". */
function when(at: number, now = new Date()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function openScores(): void {
  sound.ui("open");
  const progress = loadProgress();
  const results = loadResults();
  const content = h("div", { class: "scores-content" });
  const tabButtons = TABS.map((t) => h("button", { class: "tab", type: "button", role: "tab", "data-tab": t.id, onclick: () => show(t.id) }, t.label));

  const records = (modes: readonly string[]): HTMLElement =>
    h(
      "div",
      { class: "records" },
      ...modes.map((m) =>
        h(
          "div",
          { class: `record-row mode-${m}` },
          h("b", null, MODE_LABEL[m] ?? m),
          ...DIFFICULTIES.map((d) => {
            const best = progress.best[`${m}-${d}`];
            const cleared = progress.beaten[`${m}-${d}`] ?? 0;
            return h(
              "span",
              { class: `record${best === undefined ? " none" : ""}` },
              h("small", null, DIFFICULTY_LABEL[d]!),
              h("b", null, best === undefined ? "—" : formatTime(best)),
              h("small", null, cleared ? `${cleared} cleared` : "not yet"),
            );
          }),
        ),
      ),
    );

  const row = (r: ResultEntry): HTMLElement =>
    h(
      "div",
      { class: `score-row mode-${r.mode}`, "data-testid": "score-row" },
      h("span", { class: "score-level" }, h("small", null, "Lv"), String(r.level)),
      h(
        "span",
        { class: "score-what" },
        h("b", null, `${MODE_LABEL[r.mode] ?? r.mode} · ${DIFFICULTY_LABEL[r.difficulty] ?? r.difficulty}`),
        h("small", null, when(r.at)),
      ),
      h(
        "span",
        { class: "score-stats" },
        h("b", { class: r.record ? "gold" : "" }, formatTime(r.time)),
        h(
          "small",
          null,
          r.perfect ? "Perfect" : [r.mistakes ? `${r.mistakes} ✕` : "", r.hints ? `${r.hints} hint${r.hints === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
          r.record ? h("span", { class: "score-badge" }, "★ record") : r.first ? h("span", { class: "score-badge dim" }, "first") : null,
        ),
      ),
    );

  const show = (f: Filter) => {
    for (const b of tabButtons) b.setAttribute("aria-selected", String(b.dataset.tab === f));
    const list = results.filter((r) => f === "all" || r.mode === f);
    content.replaceChildren(
      h("h3", null, "Records"),
      records(f === "all" ? MODES : [f]),
      h("h3", null, "Recent levels"),
      list.length
        ? h("div", { class: "score-list" }, ...list.map(row))
        : h("p", { class: "scores-empty" }, "Nothing here yet — every level you finish lands here."),
    );
  };

  const close = () => {
    sound.ui("close");
    overlay.classList.add("closing");
    overlay.addEventListener("animationend", () => overlay.remove(), { once: true });
    removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  addEventListener("keydown", onKey);
  const overlay = h(
    "div",
    { class: "overlay scores", role: "dialog", "aria-label": "Scores", "data-testid": "scores" },
    h("header", { class: "sheet-head" }, h("h2", null, "Scores"), h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, svgIcon(ICONS.close))),
    h("nav", { class: "tabs", role: "tablist" }, ...tabButtons),
    content,
  );
  document.body.append(overlay);
  show("all");
}
