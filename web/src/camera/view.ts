// Camera moves shared by the toolbar, the keys and the export: zoom and fit, the views, rotate, pan and fly. Each one
// asks for a redraw; nothing here draws or listens for input (the pivot of a rotation is in pivot.ts). The structure's
// centre is the world origin (scene/load.ts moves the structure root by -centre), so the origin is where the target goes
// back to.
import * as THREE from "three";
import {
  baseDistance, centreDistance, clipPlanesAround, depthOfCentre, dollyPosition, fitZoom, fitZoomPersp, flyShift, viewForward,
} from "./framing";
import { controls, perspCamera, stage } from "../render/draw";
import { camera, extent, fitValue, lens, requestRender, setFitValue } from "../state";
import { cancelGlide } from "./glide";

// The zoom range, shared with the trackball's dolly limits (scene/load.ts).
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 40;
// An orthographic camera sits this many structure sizes from the target: far enough to clear the structure, and
// inside the far plane (scene/load.ts sets it to ORTHO_FAR_EXTENTS).
export const ORTHO_FAR_EXTENTS = 40;
// An orthographic view sits this many structure sizes from the target. The structure lies within half an extent of
// the target, so 8 clears it with room to spare, and stays well inside the far plane above.
const ORTHO_VIEW_DISTANCE = 8;

// A clip plane moves the projection matrix only when it has changed by more than this, so an idle camera does no work.
const CLIP_CHANGE_TOLERANCE = 1e-6;

export const isPersp = (): boolean => camera === perspCamera;

// The zoom of the exported view. Perspective dollies, so zoom = base distance / distance (camera.zoom stays 1).
export const currentZoom = (): number => (isPersp() ? baseDistance(extent) / distance() : camera.zoom);
// The zoom the page shows (the readout's percentage). It differs from the exported zoom in perspective: it measures the
// camera against the structure's centre, not against the target. A pivot moves the target and leaves the camera where it
// is, so the shown zoom does not jump when you pivot. The two agree while the target is at the origin (the fit view).
// Orthographic has no such difference: camera.zoom is the zoom.
export const shownZoom = (): number =>
  isPersp() ? baseDistance(extent) / centreDistance(camera.position.toArray()) : camera.zoom;
export const fitFor = (width: number, height: number): number =>
  isPersp() ? fitZoomPersp(extent, lens, width, height) : fitZoom(width, height);

// Zoom towards or away from the structure. Perspective moves the camera along its view line; ortho changes camera.zoom.
export function setZoom(requested: number): void {
  const zoomLevel = THREE.MathUtils.clamp(requested, ZOOM_MIN, ZOOM_MAX);
  if (isPersp()) {
    const towardsCamera = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(towardsCamera, baseDistance(extent) / zoomLevel);
  } else {
    camera.zoom = zoomLevel;
    camera.updateProjectionMatrix();
  }
  requestRender();
}

// Keep the clip planes round the structure as the camera moves (it can fly through it, so they follow the structure,
// not the target).
export function syncClip(): void {
  if (!isPersp()) return;
  // The planes are depths along the view axis to the structure's centre (the origin), so a camera off to one side
  // gets the same planes as one looking straight at it. Orthographic planes are fixed (ORTHO_FAR_EXTENTS).
  const depth = depthOfCentre(camera.position.toArray(), camera.quaternion.toArray());
  const { near, far } = clipPlanesAround(depth, extent);
  if (Math.abs(camera.near - near) > CLIP_CHANGE_TOLERANCE || Math.abs(camera.far - far) > CLIP_CHANGE_TOLERANCE) {
    Object.assign(camera, { near, far });
    camera.updateProjectionMatrix();
  }
}

// Look at the structure from a direction (world), with `up` as the world direction shown up on screen.
export function viewFrom(dir: THREE.Vector3, up: THREE.Vector3): void {
  cancelGlide();
  // The view looks at the structure's centre again, wherever flying or panning has taken the target.
  controls.target.set(0, 0, 0);
  const target = controls.target;
  // A perspective view goes back to the base distance (zoom 100%), not the distance it had.
  const sizeAway = isPersp() ? baseDistance(extent) : extent * ORTHO_VIEW_DISTANCE;
  camera.position.copy(target).addScaledVector(dir.clone().normalize(), sizeAway);
  camera.up.copy(up).normalize();
  camera.lookAt(target);
  requestRender();
}

// The screen's axes in world terms: x right, y up, z towards the viewer.
const SCREEN_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
export type ScreenAxis = keyof typeof SCREEN_AXES;

// Whether a name (from a toolbar button's data-axis, say) is one of the screen axes `rotate` takes.
export function isScreenAxis(name: string | undefined): name is ScreenAxis {
  return name !== undefined && Object.hasOwn(SCREEN_AXES, name);
}

// Turn the structure about a screen axis by swinging the camera round the target. Positive: tilt up (front comes
// up), turn left, spin clockwise.
export function rotate(axis: ScreenAxis, degrees: number): void {
  const world = SCREEN_AXES[axis].clone().applyQuaternion(camera.quaternion);
  const turn = new THREE.Quaternion().setFromAxisAngle(world, THREE.MathUtils.degToRad(degrees));
  const offset = camera.position.clone().sub(controls.target).applyQuaternion(turn);
  camera.position.copy(controls.target).add(offset);
  camera.up.applyQuaternion(turn);
  camera.lookAt(controls.target);
  requestRender();
}

// Move the structure on screen by a fraction of the view height. dx and dy are screen directions (positive dx moves
// the camera right, so the structure goes left).
export function pan(dx: number, dy: number, fraction: number): void {
  const distanceAway = visibleHeightAtTarget(camera) * fraction;
  const shift = new THREE.Vector3(-dx, -dy, 0).multiplyScalar(distanceAway).applyQuaternion(camera.quaternion);
  camera.position.add(shift);
  controls.target.add(shift);
  requestRender();
}

// Fly the camera forward (positive) or back along its view direction, by a fraction of the view height at the target.
// The target flies with it, so the orbit point stays in front of the camera and the camera passes through the structure
// with nothing to stop it. Perspective only: the distance to the target does not change, so the zoom does not either.
export function flyForward(fraction: number): void {
  const shift = new THREE.Vector3(...flyShift(camera.quaternion.toArray(), visibleHeightAtTarget(camera) * fraction));
  camera.position.add(shift);
  controls.target.add(shift);
  requestRender();
}

// Sets the zoom the page shows. Perspective slides the camera along its view line, the target staying where it is, to the
// wanted distance from the origin (clamped to the trackball's limits, see dollyPosition). Orthographic sets camera.zoom.
export function setShownZoom(requested: number): void {
  const wanted = THREE.MathUtils.clamp(requested, ZOOM_MIN, ZOOM_MAX);
  if (!isPersp()) {
    setZoom(wanted);
    return;
  }
  const next = dollyPosition(
    camera.position.toArray(), controls.target.toArray(), baseDistance(extent) / wanted,
    controls.minDistance, controls.maxDistance,
  );
  if (next) camera.position.fromArray(next);
  requestRender();
}

// Zoom in or out by a factor, as the shown zoom reads it: one press multiplies the readout by the factor.
export const zoom = (factor: number): void => setShownZoom(shownZoom() * factor);

// Fit the structure to the window: the target goes to the middle and the zoom to the fit.
export function fit(): void {
  cancelGlide();
  const offset = camera.position.clone().sub(controls.target);
  controls.target.set(0, 0, 0);
  camera.position.copy(offset);
  setFitValue(fitFor(stage.clientWidth, stage.clientHeight));
  setZoom(fitValue);
}

// The distance from the camera to the target (the orbit point). A camera exactly on the target falls back to the base
// distance.
function distance(): number {
  return camera.position.distanceTo(controls.target) || baseDistance(extent);
}

// How tall the view is at the target plane, in scene units (angstrom): a pan of 0.05 moves the structure by 5% of
// what you see.
export function visibleHeightAtTarget(view: THREE.PerspectiveCamera | THREE.OrthographicCamera): number {
  if (view instanceof THREE.PerspectiveCamera) {
    const halfAngle = THREE.MathUtils.degToRad(view.fov) / 2;
    return 2 * distance() * Math.tan(halfAngle);
  }
  return (view.top - view.bottom) / view.zoom;
}

