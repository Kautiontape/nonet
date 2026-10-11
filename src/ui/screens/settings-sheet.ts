/** Settings as a bottom sheet with toggles and a segmented effects control. */
import { h, svgIcon } from "../dom";
import { ICONS } from "../icons";
import { settings, updateSettings, type EffectsLevel, type Settings } from "../settings";
import { sound } from "../sound";

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const GROUPS: { title: string; rows: { key: BoolKey; label: string; hint?: string }[] }[] = [
  {
    title: "Sound & feel",
    rows: [
      { key: "sfx", label: "Sound effects", hint: "Every move plays a note in the music." },
      { key: "music", label: "Ambient music" },
      { key: "haptics", label: "Haptics", hint: "Vibration on supported phones." },
    ],
  },
  {
    title: "Play",
    rows: [
      { key: "checkMistakes", label: "Flag mistakes instantly", hint: "Explains why a digit is wrong." },
      { key: "autoClearNotes", label: "Auto-remove notes", hint: "Placing a digit clears the notes it rules out." },
      { key: "autoNotes", label: "Show auto-notes", hint: "Dim digits the rules still allow; tap one in notes mode to strike it." },
      { key: "highlightSame", label: "Highlight matching digits" },
      { key: "showTimer", label: "Show timer" },
    ],
  },
  {
    title: "Killer",
    rows: [
      { key: "cageTint", label: "Tint cages" },
      { key: "showCombos", label: "Show cage combinations", hint: "Lists the sums a selected cage can make." },
    ],
  },
  {
    title: "Queens",
    rows: [{ key: "autoCross", label: "Auto-cross attacked cells", hint: "Shows ✕ where a queen rules cells out." }],
  },
];

export function openSettings(): void {
  sound.ui("open");
  const rows: HTMLElement[] = [];
  const effects = h(
    "div",
    { class: "segmented", role: "radiogroup", "aria-label": "Effects" },
    ...(["low", "normal", "epic"] as EffectsLevel[]).map((lvl) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(settings().effects === lvl),
          onclick: (e: Event) => {
            updateSettings({ effects: lvl });
            sound.ui("toggle");
            for (const b of (e.currentTarget as HTMLElement).parentElement!.children) b.setAttribute("aria-checked", String(b === e.currentTarget));
          },
        },
        lvl === "low" ? "Calm" : lvl === "normal" ? "Vivid" : "Epic",
      ),
    ),
  );
  rows.push(h("div", { class: "set-row" }, h("div", null, h("b", null, "Effects"), h("small", null, "Calm is easiest on battery and motion.")), effects));
  for (const g of GROUPS) {
    rows.push(h("h3", null, g.title));
    for (const r of g.rows) {
      const input = h("input", { type: "checkbox", role: "switch", "data-key": r.key }) as HTMLInputElement;
      input.checked = settings()[r.key];
      input.addEventListener("change", () => {
        updateSettings({ [r.key]: input.checked } as Partial<Settings>);
        sound.ui("toggle");
      });
      rows.push(h("label", { class: "set-row" }, h("div", null, h("b", null, r.label), r.hint ? h("small", null, r.hint) : null), h("span", { class: "switch" }, input, h("i"))));
    }
  }
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
    { class: "overlay settings", role: "dialog", "aria-label": "Settings", "data-testid": "settings" },
    h("header", { class: "sheet-head" }, h("h2", null, "Settings"), h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, svgIcon(ICONS.close))),
    h("div", { class: "settings-list" }, ...rows),
  );
  document.body.append(overlay);
}
