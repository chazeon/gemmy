// The outline width the user picks in the ☰ menu: a multiplier on the automatic width that render/draw.ts sets (1 is
// the automatic width). The choice is kept per browser under OUTLINE_SCALE_KEY, as the theme is (theme.ts). The Outlines
// toggle still turns every outline off; this only scales them.
import { setOutlineScale } from "../render/draw";

const OUTLINE_SCALE_KEY = "gemmy.outline-scale";
// Thin, Normal and Bold, the values the menu's segments carry (data-outline-scale).
export const OUTLINE_SCALE_CHOICES: readonly number[] = [0.5, 1, 1.75];
const DEFAULT_SCALE = 1;

export function isOutlineScale(value: unknown): value is number {
  return OUTLINE_SCALE_CHOICES.some((choice) => choice === value);
}

// A stored value that is not one of the choices counts as the default, as does a value that storage refuses to give.
function readStoredScale(): number {
  try {
    const value = Number(localStorage.getItem(OUTLINE_SCALE_KEY));
    return isOutlineScale(value) ? value : DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
}
function storeScale(scale: number): void {
  try {
    localStorage.setItem(OUTLINE_SCALE_KEY, String(scale));
  } catch {
    // storage refused: the choice lasts for this visit only
  }
}

// Who is told when the choice changes (the menu's segments).
type ScaleListener = (scale: number) => void;
const listeners: ScaleListener[] = [];
export function onOutlineScaleChange(listener: ScaleListener): void {
  listeners.push(listener);
}

let current = readStoredScale();
setOutlineScale(current);

// The width in use: the Blender-side counterpart is not set from here (camera/framing.ts leaves the render settings alone).
export function outlineScale(): number {
  return current;
}

export function chooseOutlineScale(scale: number): void {
  current = scale;
  storeScale(scale);
  setOutlineScale(scale);
  for (const listener of listeners) listener(scale);
}
