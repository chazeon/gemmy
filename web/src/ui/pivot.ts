// The turn: what a rotation turns about. From outside the structure a tilt orbits the target, the structure's centre
// unless the user moved it (double-click, pan). Inside the structure, with something selected, the selection is the
// target, and a small tilt would swing the camera across the whole view distance, so the rotation pivots instead on what
// the screen centre looks at, when that is nearer than the target: the hit lies on the view ray, so the view does not
// change and nothing jumps. Inside with nothing selected the turn looks around: the camera turns where it stands
// (camera/view.ts startLooking). The keys (ui/keyboard.ts), the toolbar buttons (src/react/toolbar.tsx) and the zoom
// column (ui/press.ts) call beginRotation at the start of a turn; a trackball drag starts it by itself, below. The
// moves are in camera/view.ts and view-state.ts.
import { controls, renderer } from "../render/draw";
import { camera, loaded } from "../state";
import { hasSelection, pickPointAt } from "./picking";
import { cameraPosition } from "../camera/view-state";
import { viewNow, pivotTo, releaseTo, keepInPlace, startLooking } from "../camera/view";
import { POINTER_SLOP_PX } from "../config";
import { span } from "../geom/vector";

export function beginRotation(): void {
  if (!cameraInsideStructure()) {
    startLooking(false);
    return;
  }
  if (!hasSelection()) {
    startLooking(true);
    return;
  }
  startLooking(false);
  pivotOnCentre();
}

// Pivots the target onto the view ray through the screen centre, if the object there is nearer than the target.
function pivotOnCentre(): void {
  const r = renderer.domElement.getBoundingClientRect();
  const hit = pickPointAt(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit) return;
  pivotTo(hit.distanceTo(camera.value.position), controls.minDistance);
}

// Lets go of the pivot, once nothing is selected (a click on empty space, or Esc). See view-state.ts released.
export function releasePivot(): void {
  releaseTo(controls.minDistance, controls.maxDistance);
}

// The structure is centred on the origin (scene/load.ts) and lies within half its bounding-box diagonal of it.
function cameraInsideStructure(): boolean {
  const { extent } = loaded.value;
  return span(cameraPosition(viewNow(), extent), [0, 0, 0]) < extent / 2;
}

// A trackball drag turns the view once the pointer has moved, not on the press: a click is not a rotation and leaves the
// pivot alone. The press is the left button on the stage; 'start' (fired for every button and the wheel too) arms it, and
// the first move beyond the slop begins the turn. The window's capture listeners run before the trackball's own, so that
// first move begins the turn before the trackball turns the view by it. While the drag turns, each trackball move is put
// back in place when looking (keepInPlace).
type Press = { x: number; y: number; armed: boolean } | null;
let press: Press = null;
let dragTurning = false;
controls.addEventListener("change", () => {
  if (dragTurning) keepInPlace();
});

window.addEventListener(
  "pointerdown",
  (e) => {
    press = e.button === 0 && e.target === renderer.domElement ? { x: e.clientX, y: e.clientY, armed: false } : null;
  },
  { capture: true },
);
controls.addEventListener("start", () => {
  if (press) press.armed = true;
});
window.addEventListener(
  "pointermove",
  (e) => {
    if (!press?.armed) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= POINTER_SLOP_PX) return;
    press.armed = false;
    beginRotation();
    dragTurning = true;
  },
  { capture: true },
);
for (const ending of ["pointerup", "pointercancel"]) {
  window.addEventListener(
    ending,
    () => {
      press = null;
      dragTurning = false;
    },
    { capture: true },
  );
}
