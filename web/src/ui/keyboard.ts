// The keyboard: arrows turn and tilt (with Shift they move), [ and ] spin, + - and 0 zoom and fit, t cycles the theme,
// ? and i open the help and the details, and Esc closes what is open or lets go of the selection. W A S D Q E fly
// (camera/fly.ts). Keys typed into a field or a popover, and browser or system shortcuts, are left to the page.
import { STEP } from "../config";
import { fit, pan, rotate, zoom } from "../camera/view";
import { beginRotation, releasePivot } from "./pivot";
import { FLY, flying, setShiftHeld } from "../camera/fly";
import { helpPanel } from "./menus";
import { toggleInfo } from "./panels";
import { select } from "./picking";
import { closeUrlForm } from "./loader";
import { cycleTheme } from "./theme";
import { closestOf } from "./dom";

function arrow(dx: number, dy: number, shift: boolean) {
  if (shift) pan(dx, dy, STEP.pan);
  else if (dy) rotate("x", dy * STEP.rotate);
  else rotate("y", -dx * STEP.rotate);
}
const zoomIn = () => zoom(STEP.zoom);
const zoomOut = () => zoom(1 / STEP.zoom);
// Each key's action; a key that shares an action (+ and =, - and _) is listed once per key.
const KEY_ACTIONS: Record<string, (shift: boolean) => void> = {
  ArrowUp: (shift) => arrow(0, 1, shift),
  ArrowDown: (shift) => arrow(0, -1, shift),
  ArrowLeft: (shift) => arrow(-1, 0, shift),
  ArrowRight: (shift) => arrow(1, 0, shift),
  "+": zoomIn,
  "=": zoomIn,
  "-": zoomOut,
  _: zoomOut,
  "0": () => fit(),
  "[": () => rotate("z", -STEP.rotate),
  "]": () => rotate("z", STEP.rotate),
  t: cycleTheme, // Auto → Light → Dark
};

// The keys that turn the view: the arrows (with Shift they move the structure instead) and the [ ] spin.
function isTurnKey(e: KeyboardEvent): boolean {
  return (e.key.startsWith("Arrow") && !e.shiftKey) || e.key === "[" || e.key === "]";
}

// Keys that belong to a field or a popover, or that come with a browser or system modifier.
function isForFieldOrShortcut(e: KeyboardEvent): boolean {
  return closestOf(e.target, "input, textarea, .popover") !== null || e.metaKey || e.ctrlKey || e.altKey;
}

// Runs the shortcut for a key. Returns whether the key was one of ours (and so is not passed on to the page).
function runShortcut(e: KeyboardEvent): boolean {
  if (e.key === "?") {
    helpPanel.togglePopover();
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
  KEY_ACTIONS[e.key](e.shiftKey);
  return true;
}

export function wireKeyboard(): void {
  window.addEventListener("keydown", (e) => {
    setShiftHeld(e.shiftKey);
    // A menu that is open takes the Esc first: the browser closes it after this event (menus.ts), and the selection
    // stays. Read here, before the browser's close, as the popover is still open.
    const menuOpen = document.querySelector(":popover-open") !== null;
    // Esc first closes the URL card back to the scene behind it. It is read before the field check, since the card's
    // input is a field.
    if (e.key === "Escape" && !menuOpen && closeUrlForm()) return;
    if (isForFieldOrShortcut(e)) return;
    if (e.key === "Escape") {
      if (!menuOpen) {
        select(null);
        releasePivot();
      }
      return;
    }
    // A turn starts with the first press of a key; its auto-repeat is the same turn going on.
    if (isTurnKey(e) && !e.repeat) beginRotation();
    if (runShortcut(e)) e.preventDefault();
  });
}
