// The pivot: what a rotation turns about. From outside the structure a tilt orbits the target, the structure's centre
// unless the user moved it (double-click, pan). Once the camera has flown INSIDE the structure, the
// target is a view distance ahead and a small tilt would swing the camera across that whole distance, so a rotation
// pivots instead on what the screen centre looks at, when that is nearer than the target: the hit lies on the view ray,
// so the view does not change and nothing jumps. The keys (ui/keyboard.ts) and toolbar buttons (ui/toolbar-buttons.ts)
// call beginRotation at the start of a turn; a trackball drag starts it by itself, below. The moves are in
// camera/view.ts and view-state.ts.
import { controls, renderer } from "../render/draw";
import { camera, loaded } from "../state";
import { pickPointAt } from "./picking";
import { cameraPosition } from "../camera/view-state";
import { viewNow, pivotTo, releaseTo } from "../camera/view";
import { POINTER_SLOP_PX } from "../config";
import { span } from "../geom/vector";

// Pivots the target onto the view ray through the screen centre, if the object there is nearer than the target.
export function beginRotation(): void {
  if (!cameraInsideStructure()) return;
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

// A trackball drag pivots once the pointer has moved, not on the press: a click is not a rotation and leaves the pivot
// alone. The press is the left button on the stage; 'start' (fired for every button and the wheel too) arms it, and the
// first move beyond the slop pivots. The window's capture listeners run before the trackball's own, so that first move
// pivots before the trackball turns the view by it.
type Press = { x: number; y: number; armed: boolean } | null;
let press: Press = null;

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
  },
  { capture: true },
);
for (const ending of ["pointerup", "pointercancel"]) {
  window.addEventListener(
    ending,
    () => {
      press = null;
    },
    { capture: true },
  );
}
