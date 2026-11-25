// The keyboard: arrows turn and tilt (with Shift they move), [ and ] spin, + - and 0 zoom and fit, t cycles the theme,
// ? and i open the help and the details, and Esc closes what is open or lets go of the selection. W A S D Q E fly
// (camera/fly.ts). The arrows and [ ] are held: a tap steps, a hold keeps going (camera/fly.ts press). Keys typed into a
// field or a popover, and browser or system shortcuts, are left to the page.
import { STEP } from "../config";
import { fit, zoom } from "../camera/view";
import { FLY, type Held, type Motion, flying, letGo, panMotion, press, setShiftHeld, turnMotion } from "../camera/fly";
import { beginRotation, releasePivot } from "./pivot";
import { toggleHelp } from "./menus";
import { toggleInfo } from "./panels";
import { select } from "./picking";
import { cycleTheme } from "./theme";
import { closestOf } from "./dom";

// The shortcuts as the tooltips and the ☰ menu name them, each key one shadcn Kbd cap. The handler below takes the keys
// from its own tables (HELD_KEYS, KEY_ACTIONS); this table is the labels, so a control's tip reads its key from here.
export const SHORTCUT = {
  turnUp: ["↑"],
  turnDown: ["↓"],
  turnLeft: ["←"],
  turnRight: ["→"],
  moveUp: ["Shift", "↑"],
  moveDown: ["Shift", "↓"],
  moveLeft: ["Shift", "←"],
  moveRight: ["Shift", "→"],
  spinAnticlockwise: ["["],
  spinClockwise: ["]"],
  zoomIn: ["+"],
  zoomOut: ["−"],
  fit: ["0"],
  info: ["i"],
  theme: ["t"],
  help: ["?"],
} as const;

// The keys that move the view while they are held, by key: the arrows turn (with Shift they pan) and [ ] spin.
const HELD_KEYS: Record<string, (shift: boolean) => Motion> = {
  ArrowUp: (shift) => (shift ? panMotion(0, 1) : turnMotion("x", 1)),
  ArrowDown: (shift) => (shift ? panMotion(0, -1) : turnMotion("x", -1)),
  ArrowLeft: (shift) => (shift ? panMotion(-1, 0) : turnMotion("y", 1)),
  ArrowRight: (shift) => (shift ? panMotion(1, 0) : turnMotion("y", -1)),
  "[": () => turnMotion("z", -1),
  "]": () => turnMotion("z", 1),
};
// Each other key's action; a key that shares an action (+ and =, - and _) is listed once per key.
const KEY_ACTIONS: Record<string, () => void> = {
  "+": () => zoom(STEP.zoom),
  "=": () => zoom(STEP.zoom),
  "-": () => zoom(1 / STEP.zoom),
  _: () => zoom(1 / STEP.zoom),
  "0": () => fit(),
  t: cycleTheme, // Auto → Light → Dark
};

// The held keys' presses, by key code: the key's keyup lets its press go.
const presses = new Map<string, Held>();

// Keys typed into a field or a popover, or that come with a browser or system modifier. The ☰ panel is the exception:
// it stays open while the scene is used (react/main-menu.tsx), so the shortcuts work with the focus in it.
const KEYS_OF_THEIR_OWN =
  "input, textarea, [data-slot=dropdown-menu-content], [data-slot=popover-content]:not(#main-panel)";

function isForFieldOrShortcut(e: KeyboardEvent): boolean {
  return closestOf(e.target, KEYS_OF_THEIR_OWN) !== null || e.metaKey || e.ctrlKey || e.altKey;
}

// A held key starts its press on its first keydown. The OS auto-repeat after it is the same press, so it is ignored. A
// turn starts its pivot rule first (ui/pivot.ts); a pan does not turn. Returns whether the key is one of these.
function pressHeldKey(e: KeyboardEvent): boolean {
  if (!Object.hasOwn(HELD_KEYS, e.key)) return false;
  if (!e.repeat && !presses.has(e.code)) {
    const pans = e.shiftKey && e.key.startsWith("Arrow");
    if (!pans) beginRotation();
    presses.set(e.code, press(HELD_KEYS[e.key](e.shiftKey)));
  }
  return true;
}

// Runs the shortcut for a key. Returns whether the key was one of ours (and so is not passed on to the page).
function runShortcut(e: KeyboardEvent): boolean {
  if (e.key === "?") {
    toggleHelp();
    return true;
  }
  if (e.key === "i" && !e.shiftKey) {
    toggleInfo();
    return true;
  }
  if (FLY[e.code]) {
    flying.add(e.code);
    return true;
  }
  if (!Object.hasOwn(KEY_ACTIONS, e.key)) return false;
  KEY_ACTIONS[e.key]();
  return true;
}

export function wireKeyboard(): void {
  window.addEventListener("keydown", (e) => {
    setShiftHeld(e.shiftKey);
    // A menu that is open takes the Esc first: the menu closes itself after this event, and the selection stays.
    // Read here, as the menu is still in the page.
    const menuOpen =
      document.querySelector(":popover-open, [data-slot=dropdown-menu-content], [data-slot=popover-content]") !== null;
    if (isForFieldOrShortcut(e)) return;
    if (e.key === "Escape") {
      if (!menuOpen) {
        select(null);
        releasePivot();
      }
      return;
    }
    if (pressHeldKey(e) || runShortcut(e)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    const held = presses.get(e.code);
    if (!held) return;
    letGo(held);
    presses.delete(e.code);
  });
  // Switching windows loses the key-up events: no press may stay held.
  window.addEventListener("blur", () => {
    for (const held of presses.values()) letGo(held, true);
    presses.clear();
  });
}
