// The outline width the user picks in the dock's View section (react/style-panel/view-nodes.ts): a multiplier on the automatic
// width that render/draw.ts sets (1 is the automatic width). The choice is kept per browser under OUTLINE_SCALE_KEY, as the
// theme is (theme.ts). The Outlines toggle still turns every outline off; this only scales them.
import { effect, signal } from "@preact/signals-core";
import { setOutlineScale } from "../render/draw";
import { remembered } from "./storage";

const OUTLINE_SCALE_KEY = "gemmy.outline-scale";
// Thin, Normal and Bold: the choices of the outline width, with their labels.
export const OUTLINE_WIDTHS = [
  { value: 0.5, label: "Thin" },
  { value: 1, label: "Normal" },
  { value: 1.75, label: "Bold" },
] as const;
const OUTLINE_SCALE_CHOICES: readonly number[] = OUTLINE_WIDTHS.map((width) => width.value);
const DEFAULT_SCALE = 1;

function isOutlineScale(value: unknown): value is number {
  return OUTLINE_SCALE_CHOICES.some((choice) => choice === value);
}

const stored = remembered<number>(OUTLINE_SCALE_KEY, (raw) => {
  const value = Number(raw);
  return isOutlineScale(value) ? value : DEFAULT_SCALE;
});
// The width in use. The shader's uniform follows it here; the menu and the redraw follow it elsewhere.
export const outlineScale = signal(stored.read());
effect(() => setOutlineScale(outlineScale.value));

// The View section's choice: it is kept for the next visit.
export function chooseOutlineScale(scale: number): void {
  outlineScale.value = scale;
  stored.write(scale);
}
