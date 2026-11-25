// The toolbar's buttons: what each one does this time, a click (one step) or a held button (for the seconds it was held
// in a frame). A press steps once and, if held, keeps going smoothly. Toolbars that do not fit scroll sideways.
import { RATE, STEP } from "../config";
import { isScreenAxis, fit, pan, rotate, zoom } from "../camera/view";
import { beginRotation } from "./pivot";
import { MAX_FRAME_SECONDS, MS_PER_SECOND } from "../camera/fly";
import { watchOverflow } from "./overflow";

const HOLD_DELAY_MS = 300; // a press moves once; after this pause it keeps moving

type Amount = { held: false } | { held: true; seconds: number };
const CLICK: Amount = { held: false };

function act(button: HTMLElement, amount: Amount) {
  const kind = button.dataset.act;
  const sign = Number(button.dataset.sign);
  if (kind === "rotate") {
    const turn = amount.held ? RATE.rotate * amount.seconds : STEP.rotate;
    const axis = button.dataset.axis;
    if (isScreenAxis(axis)) rotate(axis, sign * turn);
  } else if (kind === "pan") {
    const move = amount.held ? RATE.pan * amount.seconds : STEP.pan;
    pan(Number(button.dataset.dx), Number(button.dataset.dy), move);
  } else if (kind === "zoom") {
    const factor = amount.held ? RATE.zoom ** amount.seconds : STEP.zoom;
    zoom(factor ** sign);
  } else if (kind === "fit") {
    fit();
  }
}

interface Press {
  waitsForRelease: boolean; // a finger: the step waits for the release, see waitsForRelease
  last: number; // timestamp of the last repeat frame
  repeating: boolean;
  timer: number; // the pause before repeating
  frame: number; // the pending repeat frame
}

// A finger's press waits for its release: a swipe across the toolbar scrolls it (the browser cancels the press) instead
// of turning the view. A mouse steps at once.
const waitsForRelease = (e: PointerEvent): boolean => e.pointerType === "touch";
const isRotateButton = (button: HTMLElement): boolean => button.dataset.act === "rotate";

function wirePressButton(button: HTMLElement) {
  let press: Press | null = null;
  const stop = () => {
    if (!press) return;
    cancelAnimationFrame(press.frame);
    window.clearTimeout(press.timer);
    press = null;
  };
  const repeatWhileHeld = () => {
    if (!press) return;
    press.repeating = true;
    const tick = (t: number) => {
      if (!press) return;
      if (press.last)
        act(button, { held: true, seconds: Math.min((t - press.last) / MS_PER_SECOND, MAX_FRAME_SECONDS) });
      press.last = t;
      press.frame = requestAnimationFrame(tick);
    };
    press.frame = requestAnimationFrame(tick);
  };

  button.addEventListener("pointerdown", (e) => {
    if (isRotateButton(button)) beginRotation(); // the press starts the turn; the held ticks below never pivot
    const waits = waitsForRelease(e);
    if (!waits) {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      act(button, CLICK);
    }
    press = { waitsForRelease: waits, last: 0, repeating: false, timer: 0, frame: 0 };
    if (button.dataset.act === "fit") return; // fit is one jump, it does not repeat
    press.timer = window.setTimeout(repeatWhileHeld, HOLD_DELAY_MS);
  });
  button.addEventListener("pointerup", () => {
    if (press?.waitsForRelease && !press.repeating) act(button, CLICK);
    stop();
  });
  for (const ev of ["pointercancel", "lostpointercapture"]) button.addEventListener(ev, stop);
  // A keyboard's Enter or Space clicks with detail 0: one step.
  button.addEventListener("click", (e) => {
    if (e.detail !== 0) return;
    if (isRotateButton(button)) beginRotation();
    act(button, CLICK);
  });
}

// Wires every [data-act] button, and the toolbars that scroll: a faded edge says that more buttons are that way.
export function wireToolbarButtons(): void {
  for (const button of document.querySelectorAll<HTMLElement>("[data-act]")) wirePressButton(button);
  for (const el of document.querySelectorAll<HTMLElement>(".island, .tabs")) watchOverflow(el);
  // The current tab is brought into view when the page opens.
  document.querySelector(".tabs [aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
