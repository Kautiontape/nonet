/** Tiny DOM helpers — the UI is framework-free. */

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & {
  class?: string;
  style?: string | Record<string, string>;
  dataset?: Record<string, string>;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function s<K extends keyof SVGElementTagNameMap>(tag: K, props: Record<string, string | number> | null = null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) for (const [k, v] of Object.entries(props)) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

function applyProps(el: HTMLElement, props: Props): void {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "style") {
      if (typeof v === "string") el.setAttribute("style", v);
      else for (const [sk, sv] of Object.entries(v as Record<string, string>)) el.style.setProperty(sk, sv);
    } else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" || typeof c === "number" ? String(c) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Shift on its own: with Ctrl / ⌘ / Alt too, it's a browser combination, not notes. */
export function shiftOnly(e: KeyboardEvent | MouseEvent): boolean {
  return e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** Parse a trusted inline SVG string (our own icon set) into an element. */
export function svgIcon(markup: string, cls = "icon"): SVGSVGElement {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  const el = tpl.content.firstElementChild as SVGSVGElement;
  el.classList.add(...cls.split(" "));
  el.setAttribute("aria-hidden", "true");
  return el;
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  const hr = Math.floor(m / 60);
  return hr ? `${hr}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export const reducedMotion = (): boolean => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const flips = new WeakMap<Element, Animation>();

/** Apply a layout change, then glide `el` from where it was to where it lands (FLIP). */
export function flip(el: HTMLElement, change: () => void, ms = 380): void {
  const before = el.getBoundingClientRect().top;
  flips.get(el)?.cancel();
  change();
  const dy = before - el.getBoundingClientRect().top;
  if (Math.abs(dy) < 1 || reducedMotion() || !el.animate) return;
  flips.set(el, el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: ms, easing: "cubic-bezier(0.2, 1, 0.3, 1)" }));
}

/** How far a running flip() still has `el` displaced vertically (0 once it has landed). */
export function flipOffset(el: Element): number {
  const t = getComputedStyle(el).transform;
  return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0;
}

/** Center of an element in viewport coordinates. */
export function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** How long a press must last to count as a hold, on the pad and the tools. */
export const LONG_PRESS_MS = 380;

/**
 * Tap or hold on a button. A press that lasts LONG_PRESS_MS calls `onHold` (the button carries
 * `long` while it's down); a shorter one calls `onTap` on release. A keyboard press (a click with
 * no pointer) taps. The context menu stays closed, so a hold on a phone doesn't raise it.
 */
export function holdable(el: HTMLElement, onTap: (e: PointerEvent | MouseEvent) => void, onHold: () => void): void {
  let timer = 0;
  let long = false;
  el.addEventListener("pointerdown", (e) => {
    long = false;
    el.setPointerCapture?.(e.pointerId);
    timer = window.setTimeout(() => {
      long = true;
      el.classList.add("long");
      onHold();
    }, LONG_PRESS_MS);
  });
  const end = () => {
    clearTimeout(timer);
    el.classList.remove("long");
  };
  el.addEventListener("pointerup", (e) => {
    end();
    if (!long) onTap(e);
  });
  el.addEventListener("pointercancel", end);
  el.addEventListener("click", (e) => e.detail === 0 && onTap(e));
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}
