// The outline width the user picks in the ☰ menu: a multiplier on the automatic width that render/draw.ts sets (1 is
// the automatic width). The choice is kept per browser under OUTLINE_SCALE_KEY, as the theme is (theme.ts). The
// Outlines toggle still turns every outline off; this only scales them.
import { effect, signal } from "@preact/signals-core";
import { setOutlineScale } from "../render/draw";
import { remembered } from "./storage";

const OUTLINE_SCALE_KEY = "gemmy.outline-scale";
// Thin, Normal and Bold, the values the menu's segments carry (data-outline-scale).
const OUTLINE_SCALE_CHOICES: readonly number[] = [0.5, 1, 1.75];
const DEFAULT_SCALE = 1;

function isOutlineScale(value: unknown): value is number {
  return OUTLINE_SCALE_CHOICES.some((choice) => choice === value);
}

const stored = remembered<number>(OUTLINE_SCALE_KEY, (raw) => {
  const value = Number(raw);
  return isOutlineScale(value) ? value : DEFAULT_SCALE;
});
// The width in use. The shader's uniform follows it here; the menu's segments and the redraw follow it elsewhere.
export const outlineScale = signal(stored.read());
effect(() => setOutlineScale(outlineScale.value));

// The menu's choice: it is kept for the next visit.
export function chooseOutlineScale(scale: number): void {
  outlineScale.value = scale;
  stored.write(scale);
}

// ---- the outline width row of the ☰ menu ----
// Thin, Normal and Bold, as the theme's segments work: the one in use is pressed.
const outlineSegments = [...document.querySelectorAll<HTMLButtonElement>("[data-outline-scale]")];
for (const segment of outlineSegments) {
  segment.addEventListener("click", () => chooseOutlineScale(Number(segment.dataset.outlineScale)));
}
effect(() => {
  for (const segment of outlineSegments) {
    segment.setAttribute("aria-pressed", String(Number(segment.dataset.outlineScale) === outlineScale.value));
  }
});
