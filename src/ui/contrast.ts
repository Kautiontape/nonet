/**
 * WCAG 2.x relative luminance and contrast ratio, and alpha blending, for checking that small
 * board text (notes) stays readable over every background it can land on. Pure: no DOM.
 */
import { hexToRgb } from "./palette";

export type Rgb = [number, number, number];

/** Relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours, 1 (same) to 21 (black on white). */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` composited over an opaque `bg`. */
export function blend(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => fg[i]! * alpha + bg[i]! * (1 - alpha)) as Rgb;
}

export const rgb = (hex: string): Rgb => hexToRgb(hex);
