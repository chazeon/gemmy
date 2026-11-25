// The toolbar: what each button does. The look-along views, the turn and move pad, zoom and fit, the lens buttons,
// the Show toggles, the tooltips and the keys that do the same things. The camera moves themselves are in camera/view.ts.
import * as THREE from "three";
import { GEMMY, LOOK, RATE, STEP } from "../config";
import { baseDistance, perspToOrthoZoom, orthoToPerspZoom } from "../camera/framing";
import { controls, key, orthoCamera, perspCamera, stage } from "../render/draw";
import { beginRotation, releasePivot } from "../camera/pivot";
import { resize } from "../render/loop";
import { atomGroup, box, camera, extent, fitValue, lattice, lens, outlineGroup, requestRender, setCamera, setFitValue, setLens, setOutlines, show } from "../state";
import { currentZoom, fit, fitFor, isPersp, isScreenAxis, pan, rotate, setZoom, shownZoom, zoom, viewFrom } from "../camera/view";
import { FLY, flying, setShiftHeld } from "../camera/fly";
import { helpPopover } from "./menus";
import { toggleInfo } from "./panels";
import { select } from "./picking";
import { cycleTheme } from "./theme";
import { byId, clamp, closestOf } from "./dom";

// ---- how the controls feel ----
// The feel of a drag on the stage: how far it turns, zooms and pans the view (three's orbit controls), with no easing
// after the drag ends.
const DRAG_FEEL = { rotateSpeed: 3, zoomSpeed: 1.2, panSpeed: 0.8, staticMoving: true };
Object.assign(controls, DRAG_FEEL);

// ---- the look-along views ----
// a, b and c look down the cell's axes; "rotated" is the view of the 3to2d renders (LOOK in the config).
function viewDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuthDeg), e = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e));
}
export const VIEWS: Record<string, () => void> = {
  a: () => viewFrom(lattice[0], lattice[2]),
  b: () => viewFrom(lattice[1], lattice[2]),
  c: () => viewFrom(lattice[2], lattice[1]),
  rotated: () => viewFrom(viewDirection(LOOK.azimuth, LOOK.elevation), new THREE.Vector3(0, 0, 1)),
};
for (const button of document.querySelectorAll<HTMLElement>("[data-view]")) {
  button.addEventListener("click", () => VIEWS[button.dataset.view ?? ""]());
}

// ---- the lens ----
// A focal length is a perspective camera; infinity is orthographic, the limit of a long lens. The view direction, up
// and target stay, and so does the framing at the target plane, so the switch does not jump. A fitted view is fitted
// again. An orthographic camera sits this many structure extents away: only its size, not its distance, sets the scale.
const ORTHO_LENS = Infinity;
const ORTHO_TAG = "inf"; // the data-lens value of the orthographic button
const ORTHO_CAMERA_DISTANCE = 8;
const FIT_EPSILON = 1e-9; // zoom this close to the fitted value counts as fitted

const lensGroup = byId("lens-group");

// A lens button is pressed when it is the perspective lens in use, or the orthographic one when that is in use.
function isLensOn(button: HTMLElement): boolean {
  const value = button.dataset.lens;
  return value === ORTHO_TAG ? !isPersp() : isPersp() && Number(value) === lens;
}
function syncLensButtons() {
  for (const button of lensGroup.querySelectorAll<HTMLElement>("[data-lens]")) {
    button.setAttribute("aria-pressed", String(isLensOn(button)));
  }
}

// Switches between perspective (with a focal length) and orthographic, keeping the framing and the view.
function switchProjection(mode: "persp" | "ortho", newLens = lens) {
  if ((mode === "persp") === isPersp() && newLens === lens) return;
  const view = captureView();
  setLens(newLens);
  installCamera(mode === "persp" ? perspCamera : orthoCamera, view);
  syncLensButtons();
  requestRender();
}

// What survives a switch: the target, the direction the camera looks from, the zoom the new camera must match, and
// whether the view was fitted (a fitted view is fitted again).
interface CapturedView {
  target: THREE.Vector3;
  direction: THREE.Vector3;
  orthoZoom: number;
  fitted: boolean;
}
function captureView(): CapturedView {
  const target = controls.target.clone();
  return {
    target,
    direction: camera.position.clone().sub(target).normalize(),
    orthoZoom: isPersp() ? perspToOrthoZoom(extent, lens, currentZoom()) : camera.zoom,
    fitted: Math.abs(shownZoom() - fitValue) < FIT_EPSILON,
  };
}
// Puts the new camera where the captured view was: same target, direction, up and framing at the target plane.
function installCamera(next: THREE.PerspectiveCamera | THREE.OrthographicCamera, view: CapturedView) {
  const persp = next instanceof THREE.PerspectiveCamera;
  next.up.copy(camera.up);
  setCamera(next);
  camera.add(key, key.target);
  controls.object = camera;
  camera.position.copy(view.target).addScaledVector(view.direction, cameraDistance(persp, view.orthoZoom));
  if (!persp) camera.zoom = view.orthoZoom;
  camera.lookAt(view.target);
  resize(); // the frustum for the new camera and lens
  if (view.fitted) setZoom(fitFor(stage.clientWidth, stage.clientHeight));
  setFitValue(fitFor(stage.clientWidth, stage.clientHeight));
}
// How far the camera sits from the target so that the framing stays the same across the switch.
function cameraDistance(persp: boolean, orthoZoom: number): number {
  if (persp) return baseDistance(extent) / orthoToPerspZoom(extent, lens, orthoZoom);
  return extent * ORTHO_CAMERA_DISTANCE;
}

function addLensButton(focalLength: number) {
  const ortho = focalLength === ORTHO_LENS;
  const button = document.createElement("button");
  Object.assign(button, {
    type: "button",
    className: "pill lens",
    textContent: ortho ? "∞" : String(focalLength),
    title: ortho ? "Orthographic (an infinitely long lens): no perspective, as in the 3to2d renders"
      : `${focalLength} mm lens on a ${GEMMY.sensorWidth} mm sensor`,
  });
  button.dataset.lens = ortho ? ORTHO_TAG : String(focalLength);
  button.setAttribute("aria-label", ortho ? "Orthographic" : `${focalLength} mm`);
  button.addEventListener("click", () => (ortho ? switchProjection("ortho") : switchProjection("persp", focalLength)));
  if (ortho) lensGroup.insertAdjacentHTML("beforeend", '<span class="unit">mm</span>'); // reads "24 … 85 mm ∞"
  lensGroup.appendChild(button);
}
for (const focalLength of [...GEMMY.lenses, ORTHO_LENS]) addLensButton(focalLength);
syncLensButtons();

// ---- the turn and move pad, and zoom ----
// What a toolbar button does this time: a click (one step), or a held button for the seconds it was held in a frame.
const MS_PER_SECOND = 1000;
const MAX_FRAME_SECONDS = 0.05; // a long frame (a stall) counts at most this much, so the view does not jump
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
  touch: boolean; // a finger: the step waits for the release, see below
  last: number; // timestamp of the last repeat frame
  repeating: boolean;
  timer: number; // the pause before repeating
  frame: number; // the pending repeat frame
}

const isRotateButton = (button: HTMLElement): boolean => button.dataset.act === "rotate";

// A toolbar button steps once on press and, if held, keeps going smoothly. With a finger the step waits for the
// release, so a swipe across the toolbar scrolls it (the browser cancels the press) instead of turning the view.
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
      if (press.last) act(button, { held: true, seconds: Math.min((t - press.last) / MS_PER_SECOND, MAX_FRAME_SECONDS) });
      press.last = t;
      press.frame = requestAnimationFrame(tick);
    };
    press.frame = requestAnimationFrame(tick);
  };

  button.addEventListener("pointerdown", (e) => {
    if (isRotateButton(button)) beginRotation(); // the press starts the turn; the held ticks below never pivot
    const touch = e.pointerType === "touch";
    if (!touch) {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      act(button, CLICK);
    }
    press = { touch, last: 0, repeating: false, timer: 0, frame: 0 };
    if (button.dataset.act === "fit") return; // fit is one jump, it does not repeat
    press.timer = window.setTimeout(repeatWhileHeld, HOLD_DELAY_MS);
  });
  button.addEventListener("pointerup", () => {
    if (press?.touch && !press.repeating) act(button, CLICK);
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
for (const button of document.querySelectorAll<HTMLElement>("[data-act]")) wirePressButton(button);

// ---- toolbars that scroll ----
// A toolbar (or the tab strip) that does not fit scrolls sideways; a faded edge says that more buttons are that way.
// A scroll position this close to an end counts as the end (sub-pixel rounding).
const EDGE_SLACK_PX = 2;
const scrollers = [...document.querySelectorAll<HTMLElement>(".island, .tabs")];

function markOverflow(el: HTMLElement) {
  const { scrollLeft, scrollWidth, clientWidth } = el;
  el.classList.toggle("more-left", scrollLeft > EDGE_SLACK_PX);
  el.classList.toggle("more-right", scrollLeft + clientWidth < scrollWidth - EDGE_SLACK_PX);
}
for (const el of scrollers) el.addEventListener("scroll", () => markOverflow(el), { passive: true });
window.addEventListener("resize", () => scrollers.forEach(markOverflow));
scrollers.forEach(markOverflow);
// The current tab is brought into view when the page opens.
document.querySelector(".tabs [aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });

// ---- tooltips ----
// A control's title moves to data-tip, so the browser's slow native tooltip stays away, and the tooltip shows in
// #tip after a short hover. A control in the bottom-left column gets its tip to the right; any other gets one
// centred below it (in the top half of the window) or above it (in the bottom half).
const TIP_DELAY_MS = 300;
const TIP_GAP_PX = 8;
const tip = Object.assign(document.createElement("div"), { id: "tip", role: "tooltip" });
document.body.appendChild(tip);
let tipTimer = 0;

function hideTip() {
  window.clearTimeout(tipTimer);
  tip.classList.remove("on");
}
function showTip(el: HTMLElement) {
  tip.textContent = el.dataset.tip ?? "";
  placeTip(el);
  tip.classList.add("on");
}
function placeTip(el: HTMLElement) {
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
  const [x, y] = el.closest("#bottom") ? tipBesideLeftColumn(r, t) : tipCentredVertically(r, t);
  tip.style.left = `${clamp(x, TIP_GAP_PX, innerWidth - t.width - TIP_GAP_PX)}px`;
  tip.style.top = `${clamp(y, TIP_GAP_PX, innerHeight - t.height - TIP_GAP_PX)}px`;
}
function tipBesideLeftColumn(r: DOMRect, t: DOMRect): [number, number] {
  return [r.right + TIP_GAP_PX, r.top + r.height / 2 - t.height / 2];
}
function tipCentredVertically(r: DOMRect, t: DOMRect): [number, number] {
  const x = r.left + r.width / 2 - t.width / 2;
  const y = r.top < innerHeight / 2 ? r.bottom + TIP_GAP_PX : r.top - TIP_GAP_PX - t.height;
  return [x, y];
}

document.addEventListener("pointerover", (e) => {
  const el = closestOf(e.target, "[title], [data-tip]");
  if (!el || e.pointerType === "touch") return;
  if (el.hasAttribute("title")) {
    el.dataset.tip = el.title;
    el.removeAttribute("title");
  }
  window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => showTip(el), TIP_DELAY_MS);
});
document.addEventListener("pointerout", (e) => {
  if (closestOf(e.target, "[data-tip]")) hideTip();
});
for (const ev of ["pointerdown", "keydown", "wheel"]) document.addEventListener(ev, hideTip, { passive: true });

// ---- the keyboard ----
// Arrows turn and tilt (with Shift they move), [ and ] spin, + - and 0 zoom and fit, t cycles the theme. ? and i open
// the help and the details. W A S D Q E fly, in camera/fly.ts. Keys typed into a field or a popover are left alone.
function arrow(dx: number, dy: number, shift: boolean) {
  if (shift) pan(dx, dy, STEP.pan);
  else if (dy) rotate("x", dy * STEP.rotate);
  else rotate("y", -dx * STEP.rotate);
}
const KEY_ACTIONS: Record<string, (shift: boolean) => void> = {
  ArrowUp: (shift) => arrow(0, 1, shift),
  ArrowDown: (shift) => arrow(0, -1, shift),
  ArrowLeft: (shift) => arrow(-1, 0, shift),
  ArrowRight: (shift) => arrow(1, 0, shift),
  "+": () => zoom(STEP.zoom),
  "=": () => zoom(STEP.zoom),
  "-": () => zoom(1 / STEP.zoom),
  "_": () => zoom(1 / STEP.zoom),
  "0": () => fit(),
  "[": () => rotate("z", -STEP.rotate),
  "]": () => rotate("z", STEP.rotate),
  t: cycleTheme, // Auto → Light → Dark
};

// The keys that turn the view: the arrows (with Shift they move the structure instead) and the [ ] spin.
function isTurnKey(e: KeyboardEvent): boolean {
  return (e.key.startsWith("Arrow") && !e.shiftKey) || e.key === "[" || e.key === "]";
}

// Keys that are for a field or a popover, or that come with a browser or system modifier.
function isTyping(e: KeyboardEvent): boolean {
  return closestOf(e.target, "input, textarea, .popover") !== null || e.metaKey || e.ctrlKey || e.altKey;
}
// Runs the shortcut for a key. Returns whether the key was one of ours (and so is not passed on to the page).
function runShortcut(e: KeyboardEvent): boolean {
  if (e.key === "?") {
    helpPopover.toggle();
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

// Whether this Esc closes a menu. Read in the capture phase, before menus.ts closes it, so the order the listeners were
// added in does not matter.
let escapeClosesMenu = false;
window.addEventListener("keydown", (e) => {
  escapeClosesMenu = e.key === "Escape" && document.querySelector(".popover:not([hidden])") !== null;
}, { capture: true });

window.addEventListener("keydown", (e) => {
  setShiftHeld(e.shiftKey);
  if (isTyping(e)) return;
  if (e.key === "Escape") {
    // Esc closes an open menu first (menus.ts), and then the selection stays.
    if (!escapeClosesMenu) {
      select(null);
      releasePivot();
    }
    return;
  }
  // A turn starts with the first press of a key; its auto-repeat is the same turn going on.
  if (isTurnKey(e) && !e.repeat) beginRotation();
  if (runShortcut(e)) e.preventDefault();
});

// ---- the Show toggles ----
// Each checkbox in the ☰ menu flips its flag and redraws.
function wireShowToggle(id: string, apply: (on: boolean) => void) {
  const button = byId(id);
  button.addEventListener("click", () => {
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    apply(on);
    requestRender();
  });
}
wireShowToggle("toggle-atoms", (on) => { show.atoms = on; atomGroup.visible = on; });
wireShowToggle("toggle-outline", (on) => { setOutlines(on); outlineGroup.visible = on; });
wireShowToggle("toggle-box", (on) => { show.box = on; if (box) box.visible = on; });
