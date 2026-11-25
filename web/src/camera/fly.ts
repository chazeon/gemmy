// WASD and Q/E: the camera flies while the keys are held. The keys are read in keyboard.ts. The scroll wheel is
// different on purpose: it is the trackball's dolly, which orbits towards the target and stops at minDistance and
// maxDistance (scene/load.ts). Only W/S fly on, through the structure and past it.
// The held turns, pans and zooms (the arrows, [ ], Shift+arrows, and the toolbar's buttons) are presses on the same
// frame loop: a press moves by its tap step, then keeps moving at the rate for as long as it is held.
import { RATE, STEP } from "../config";
import { type ScreenAxis, flyForward, isPersp, pan, rotate, zoom } from "./view";

// Animation frame times are in milliseconds.
const MS_PER_SECOND = 1000;
// A frame that comes late (a stalled tab) counts at most this many seconds, so the view does not jump.
const MAX_FRAME_SECONDS = 0.05;
// The first frame of a hold has no previous frame to measure, so it moves a frame's worth: a tap still moves.
const FIRST_STEP_SECONDS = 1 / 60;

// The keys held down now, and the time of the last frame they moved (0 when none is held).
export const flying = new Set<string>();
let flyLast = 0;
let shiftHeld = false;

// A held key is either a flight (+1 forward, -1 back) or a pan (dx, dy in screen directions, see view.ts pan).
type Move = ["fly", number] | ["pan", number, number];

// W/S in and out, A/D left and right, E/Q up and down, like Blender's fly mode. Keyed by e.code, so these are the same
// physical keys on any keyboard layout. `pan` moves the structure, so the camera moving right is the structure
// moving left.
export const FLY: Record<string, Move> = {
  KeyW: ["fly", 1],
  KeyS: ["fly", -1],
  KeyA: ["pan", 1, 0],
  KeyD: ["pan", -1, 0],
  KeyE: ["pan", 0, -1],
  KeyQ: ["pan", 0, 1],
};
// With Shift held, W/S move up and down instead of in and out (so W/A/S/D pan like the arrow pad).
const FLY_SHIFT: Record<string, Move> = { KeyW: ["pan", 0, -1], KeyS: ["pan", 0, 1] };

// What a held input moves. `step` is what a press moves at once (a tap), `rate` what it moves per second while held, and
// `move` applies an amount of it to the view.
export interface Motion {
  step: number;
  rate: number;
  move: (amount: number) => void;
}
// One press in progress: how far it has moved, and whether it has been let go (its tap still finishes after that).
export interface Held {
  motion: Motion;
  moved: number;
  released: boolean;
}
const holds = new Set<Held>();

export const turnMotion = (axis: ScreenAxis, sign: number): Motion => ({
  step: STEP.rotate,
  rate: RATE.rotate,
  move: (amount) => rotate(axis, sign * amount),
});
export const panMotion = (dx: number, dy: number): Motion => ({
  step: STEP.pan,
  rate: RATE.pan,
  move: (amount) => pan(dx, dy, amount),
});
// Zoom adds up in logarithms: a step and a rate are amounts of the logarithm of the zoom factor.
export const zoomMotion = (sign: number): Motion => ({
  step: Math.log(STEP.zoom),
  rate: Math.log(RATE.zoom),
  move: (amount) => zoom(Math.exp(sign * amount)),
});

// Starts a press. It moves on the next frame, and keeps moving until it is let go.
export function press(motion: Motion): Held {
  const held: Held = { motion, moved: 0, released: false };
  holds.add(held);
  return held;
}
// Lets a press go: it stops after its tap, if it has not yet moved that far. `cancel` drops it where it is.
export function letGo(held: Held, cancel = false): void {
  if (cancel) holds.delete(held);
  else held.released = true;
}

// The one place shift is recorded: the keys' own events and the window's blur go through here.
export function setShiftHeld(held: boolean): void {
  shiftHeld = held;
}

// The move a held key makes. Shift swaps W/S for up and down.
function moveFor(code: string): Move {
  return (shiftHeld && FLY_SHIFT[code]) || FLY[code];
}

// W (+1) or S (-1). In perspective the camera flies along its view direction, and the target flies with it. An
// orthographic camera has no depth on screen, so moving forward changes nothing visible: W/S zoom there instead.
// A flight covers the same share of the view height per second as a pan, so flying and panning feel alike.
function advance(direction: number, seconds: number): void {
  if (isPersp()) flyForward(direction * RATE.pan * seconds);
  else zoom(RATE.zoom ** (direction * seconds)); // the orthographic clip planes are fixed (scene/load.ts)
}

// A press moves by the rate for this frame, or by what is left of its tap once it is let go.
function advanceHeld(held: Held, seconds: number): void {
  const { step, rate, move } = held.motion;
  const amount = held.released ? Math.min(rate * seconds, step - held.moved) : rate * seconds;
  if (amount > 0) {
    move(amount);
    held.moved += amount;
  }
  if (held.released && held.moved >= step) holds.delete(held);
}

// Called once per animation frame with its timestamp in milliseconds. Every held key moves the camera a step.
export function fly(now: number): void {
  if (!flying.size && !holds.size) {
    flyLast = 0;
    return;
  }
  const seconds = flyLast ? Math.min((now - flyLast) / MS_PER_SECOND, MAX_FRAME_SECONDS) : FIRST_STEP_SECONDS;
  flyLast = now;
  for (const code of flying) {
    const move = moveFor(code);
    if (move[0] === "fly") advance(move[1], seconds);
    else pan(move[1], move[2], RATE.pan * seconds);
  }
  for (const held of holds) advanceHeld(held, seconds);
}

// Releasing a key stops it; switching windows loses the key-up events, so nothing may stay stuck in the flying state
// or in a held press.
export function wireFlyKeys(): void {
  window.addEventListener("keyup", (e) => {
    flying.delete(e.code);
    setShiftHeld(e.shiftKey);
  });
  window.addEventListener("blur", () => {
    flying.clear();
    holds.clear();
    setShiftHeld(false);
  });
}
