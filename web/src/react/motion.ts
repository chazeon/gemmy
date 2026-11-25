// A button's hover motion, told by what it does: a turn rocks its icon the way it turns, a move nudges it the way it
// moves, "+" and ✕ turn a quarter. The motion is CSS variables on the button that the overlay's hover rule
// (tailwind.css) reads; a button with none just grows its icon a little.
import type { CSSProperties } from "react";

// How far a nudge goes, and how far a spin turns
const NUDGE_PX = 1.5;
const SPIN_DEG = 30;
const QUARTER_DEG = 90;

// A nudge across the screen: x to the right, y down, in steps.
export function nudge(x: number, y: number): CSSProperties {
  return { "--nudge-x": `${x * NUDGE_PX}px`, "--nudge-y": `${y * NUDGE_PX}px`, "--grow": 1 } as CSSProperties;
}

// A turn of the icon in its plane: clockwise for a positive sign.
export function spin(sign: number, degrees = SPIN_DEG): CSSProperties {
  return { "--spin": `${sign * degrees}deg`, "--grow": 1 } as CSSProperties;
}

export const QUARTER_TURN = spin(1, QUARTER_DEG);

// No motion of the whole icon: the icon moves its own parts (the move buttons, react/move-icon.tsx).
export const STILL = { "--grow": 1 } as CSSProperties;
