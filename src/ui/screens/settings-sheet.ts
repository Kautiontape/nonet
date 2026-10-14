/** Settings as a bottom sheet with toggles, a segmented effects control and a save backup. */
import { h, svgIcon } from "../dom";
import { ICONS } from "../icons";
import { settings, updateSettings, type EffectsLevel, type Settings } from "../settings";
import { sound } from "../sound";
import { backupSolved, makeBackup, parseBackup, restoreBackup, todayKey, type Backup } from "../store";

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
  rows.push(h("h3", null, "Backup"), backupRow());
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

/**
 * Save everything to a file, or restore from one. A restore replaces what's here and loads the
 * page again, so every screen starts from the backup. Toasts sit under this sheet: messages go
 * in the row itself.
 */
function backupRow(): HTMLElement {
  const status = h("small", { class: "backup-status", role: "status", "data-testid": "backup-status" });
  const file = h("input", { type: "file", hidden: true, "data-testid": "restore-file" }) as HTMLInputElement;
  const actions = h(
    "div",
    { class: "backup-actions" },
    h("button", { class: "btn", type: "button", "data-testid": "backup-save", onclick: () => void saveBackup(status) }, svgIcon(ICONS.download), "Save backup"),
    h("button", { class: "btn", type: "button", "data-testid": "backup-restore", onclick: () => file.click() }, svgIcon(ICONS.upload), "Restore…"),
  );
  const confirm = h("div", { class: "backup-confirm", hidden: true });
  const ask = (b: Backup) => {
    const when = new Date(b.exported);
    const solved = backupSolved(b);
    confirm.replaceChildren(
      h(
        "p",
        null,
        `Replace everything here with the backup${Number.isNaN(when.getTime()) ? "" : ` from ${when.toLocaleDateString(undefined, { dateStyle: "medium" })}`}`,
        ` (${solved} solved)? Scores, settings and games in progress are all swapped for it.`,
      ),
      h(
        "div",
        { class: "backup-actions" },
        h("button", { class: "btn", type: "button", onclick: () => show(false) }, "Cancel"),
        h(
          "button",
          {
            class: "btn primary",
            type: "button",
            "data-testid": "restore-confirm",
            onclick: () => {
              if (!restoreBackup(b)) return show(false, "This browser wouldn't let Nonet save. Nothing was restored.");
              // A plain load of the page: a ?play= link would start a game and save over the backup.
              location.assign(`${location.pathname}?restored`);
            },
          },
          "Replace",
        ),
      ),
    );
    show(true);
  };
  const show = (asking: boolean, message = "") => {
    actions.hidden = asking;
    confirm.hidden = !asking;
    status.textContent = message;
  };
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    file.value = ""; // so picking the same file again still fires
    if (!picked) return;
    const b = parseBackup(await picked.text());
    if (b) ask(b);
    else show(false, "That file isn't a Nonet backup this version can read.");
  });
  return h(
    "div",
    { class: "set-row backup" },
    h(
      "div",
      null,
      h("b", null, "Your progress"),
      h("small", null, "Scores, settings and games in progress live in this browser only. Save a backup file to keep them safe or move them to another device."),
    ),
    actions,
    confirm,
    status,
    file,
  );
}

/** The share sheet on a phone (save to Files or Drive, or send it on), a download elsewhere. */
async function saveBackup(status: HTMLElement): Promise<void> {
  const name = `nonet-backup-${todayKey()}.json`;
  const file = new File([JSON.stringify(makeBackup())], name, { type: "application/json" });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      /* sharing refused: download it instead */
    }
  }
  const url = URL.createObjectURL(file);
  const a = h("a", { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  status.textContent = `Saved ${name}.`;
}
