// The outline width the user sets in the dock's View section (react/style-panel/view-nodes.ts): a multiplier on the automatic
// width that render/draw.ts sets (1 is the automatic width). Any number in OUTLINE_RANGE is kept, clamped to it; a stored
// value that is not a number reads as the default. The choice is kept per browser under OUTLINE_SCALE_KEY, as the theme is
// (theme.ts). The Outlines toggle still turns every outline off; this only scales them.
import { effect, signal } from "@preact/signals-core";
import { setOutlineScale } from "../render/draw";
import { remembered } from "./storage";

const OUTLINE_SCALE_KEY = "gemmy.outline-scale";
// The width's range and the step its control moves in.
export const OUTLINE_RANGE = { min: 0.25, max: 3, step: 0.05 } as const;
// The automatic width: the default the View section's reset returns to.
export const DEFAULT_SCALE = 1;

function clampScale(value: number): number {
  return Math.min(OUTLINE_RANGE.max, Math.max(OUTLINE_RANGE.min, value));
}

const stored = remembered<number>(OUTLINE_SCALE_KEY, (raw) => {
  const value = Number(raw);
  return raw !== null && Number.isFinite(value) ? clampScale(value) : DEFAULT_SCALE;
});
// The width in use. The shader's uniform follows it here; the menu and the redraw follow it elsewhere.
export const outlineScale = signal(stored.read());
effect(() => setOutlineScale(outlineScale.value));

// The View section's choice: it is clamped to the range and kept for the next visit.
export function chooseOutlineScale(scale: number): void {
  if (!Number.isFinite(scale)) throw new Error(`outline width must be a number, not ${scale}`);
  outlineScale.value = clampScale(scale);
  stored.write(outlineScale.value);
}
