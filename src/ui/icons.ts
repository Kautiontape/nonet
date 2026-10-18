/** Inline SVG icons (stroke-based, currentColor). */
const svg = (body: string, vb = "0 0 24 24") =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  menu: svg('<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>'),
  undo: svg('<path d="M9 7H4V2"/><path d="M4 7a9 9 0 1 1-1.5 7"/>'),
  redo: svg('<path d="M15 7h5V2"/><path d="M20 7a9 9 0 1 0 1.5 7"/>'),
  erase: svg('<path d="M20 20H9L4 15a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11 18.8"/><path d="M9 9l6 6"/>'),
  pencil: svg('<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>'),
  wand: svg('<path d="M4 20L16 8"/><path d="M14 6l4 4"/><path d="M19 3v3M17.5 4.5h3M6 3v2M5 4h2M20 14v2M19 15h2"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/>'),
  crown: svg('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" fill="currentColor" fill-opacity=".18"/><circle cx="3" cy="8" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="21" cy="8" r="1"/>'),
  cross: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: svg('<path d="M4 12l5 5L20 6"/>'),
  play: svg('<path d="M7 4l13 8-13 8z" fill="currentColor" fill-opacity=".2"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
  /** The pause bars with no side margin, to sit snug after the timer. */
  pauseBars: svg('<path d="M3 3v14M9 3v14"/>', "0 0 12 20"),
  grid: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>'),
  cage: svg('<path d="M4 4h9v7h7v9H4z" stroke-dasharray="2.4 2.2"/><text x="6.2" y="10" font-size="6" fill="currentColor" stroke="none" font-weight="700">17</text>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>'),
  sound: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M9 20h6M10 17h4"/>'),
  restart: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  download: svg('<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
  upload: svg('<path d="M12 15V4"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/>'),
} as const;

export type IconName = keyof typeof ICONS;
