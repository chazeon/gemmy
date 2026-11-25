// The camera. The ViewState (view-state.ts) is the source of truth: a move maps the state to the next, and `commit`
// writes it to the three.js camera. The trackball moves the camera itself, so `readBack` takes its drags into the
// state.
import * as THREE from "three";
import { baseDistance, clipPlanesAround, depthOfCentre, type Projection } from "./framing";
import {
  type Frame,
  type ViewState,
  cameraPosition,
  fitZoomFor,
  flown,
  framed,
  inFrontOf,
  interpolated,
  panned,
  pivoted,
  released,
  rotated,
  shownZoom,
  turnedInPlace,
  upAxis,
  viewedFrom,
  visibleHeight,
  withProjection,
  zoomedTo,
} from "./view-state";
import { GEMMY } from "../config";
import { controls, key, orthoCamera, perspCamera, stage } from "../render/draw";
import { batch } from "@preact/signals-core";
import { camera, fitValue, lens, loaded, projection, requestRender } from "../state";
import { span } from "../geom/vector";

const GLIDE_MS = 300;
// Test hook: tests/browser/driver.mjs sets window.__gemmyTest before the page loads, so a glide lands at once and the
// draw counts of a step do not depend on how fast the frames came. Read once, here; nothing else looks at it.
const GLIDES_INSTANTLY = (window as { __gemmyTest?: boolean }).__gemmyTest === true;
// A clip plane moves the projection matrix only when it has changed by more than this.
const CLIP_CHANGE_TOLERANCE = 1e-6;

// The state the camera shows. It starts orthographic, as the camera does (draw.ts); the first view sets the rest.
let view: ViewState = {
  target: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  zoom: 1,
  projection: "ortho",
  lens: GEMMY.defaultLens,
};
// A glide stops once its id is no longer the current one. Every move and every drag bumps it.
let glideId = 0;

export const isPersp = (): boolean => view.projection === "persp";
const frameSize = (): Frame => ({ width: stage.clientWidth, height: stage.clientHeight });
const extentNow = (): number => loaded.value.extent;
const refit = (): void => {
  fitValue.value = fitFor(stage.clientWidth, stage.clientHeight);
};

// The state as the camera shows it now.
export function viewNow(): ViewState {
  readBack();
  return view;
}
// The view as the exports take it: the camera's orientation, the zoom and target (the render takes the target's
// distance as the zoom), the projection and lens, and the stage's size.
export function pageCamera() {
  return {
    quaternion: camera.value.quaternion.toArray(),
    zoom: viewNow().zoom,
    target: controls.target.toArray(),
    projection: projection.value,
    lens: lens.value,
    width: stage.clientWidth,
    height: stage.clientHeight,
  };
}
// The zoom the readout shows (view-state.ts shownZoom): what the user sees, and what the zoom buttons act on.
export const shownNow = (): number => shownZoom(viewNow(), extentNow());
// The zoom that frames the structure in the current projection (the readout's percentage is of it).
export const fitFor = (width: number, height: number): number =>
  fitZoomFor(view.projection, view.lens, extentNow(), { width, height });

// Takes the camera's state into the view.
export function readBack(): void {
  const cam = camera.value;
  const persp = cam === perspCamera;
  const target = controls.target.toArray();
  const distance = span(cam.position.toArray(), target);
  // A perspective camera's zoom follows its distance from the target; an orthographic camera keeps its own zoom.
  let zoom = cam.zoom;
  if (persp) zoom = distance === 0 ? 1 : baseDistance(extentNow()) / distance;
  view = {
    ...view,
    target,
    orientation: cam.quaternion.toArray(),
    projection: persp ? "persp" : "ortho",
    zoom,
  };
}

// Writes the state to the three.js camera: its camera object, place, orientation and zoom.
function applyView(): void {
  const cam = view.projection === "persp" ? perspCamera : orthoCamera;
  if (camera.peek() !== cam) {
    camera.value = cam;
    cam.add(key, key.target); // the key light follows the camera (draw.ts)
    controls.object = cam;
  }
  cam.position.fromArray(cameraPosition(view, extentNow()));
  cam.quaternion.fromArray(view.orientation);
  cam.up.fromArray(upAxis(view.orientation));
  controls.target.fromArray(view.target);
  cam.zoom = view.projection === "persp" ? 1 : view.zoom;
  cam.updateProjectionMatrix();
}

// Writes a state and asks for a redraw.
function commit(next: ViewState): void {
  if (next.lens !== view.lens) perspCamera.setFocalLength(next.lens);
  // One batch: the effects that follow these signals run once the camera is placed. A readout that ran while applyView
  // was half done would read the camera at its old place and overwrite the state with it.
  batch(() => {
    view = next;
    lens.value = next.lens;
    projection.value = next.projection;
    applyView();
  });
  requestRender(); // the picture follows the camera; the zoom readout is written when the view is drawn
}

// One camera move: the state as the camera shows it, then `change`. A glide still running stops.
export function move(change: (state: ViewState) => ViewState): void {
  glideId++;
  commit(change(viewNow()));
}

// Sets a state outright (an address, #view=...).
export function setView(next: ViewState): void {
  glideId++;
  commit(next);
  refit();
}

// Keeps the perspective clip planes round the structure as the camera moves (the orthographic far plane is set once,
// by scene/load.ts).
export function syncClip(): void {
  if (!isPersp()) return;
  const cam = camera.value;
  const depth = depthOfCentre(cam.position.toArray(), cam.quaternion.toArray());
  const { near, far } = clipPlanesAround(depth, extentNow());
  if (Math.abs(cam.near - near) > CLIP_CHANGE_TOLERANCE || Math.abs(cam.far - far) > CLIP_CHANGE_TOLERANCE) {
    Object.assign(cam, { near, far });
    cam.updateProjectionMatrix();
  }
}

// The zoom keys and buttons: by a factor of the readout, or to a readout.
export const zoom = (factor: number): void => move((s) => zoomedTo(s, shownZoom(s, extentNow()) * factor, extentNow()));
export const zoomTo = (level: number): void => move((s) => zoomedTo(s, level, extentNow()));

// The screen's axes in camera space: x right, y up, z towards the viewer.
const SCREEN_AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const;
export type ScreenAxis = keyof typeof SCREEN_AXES;

// Look-around (ui/pivot.ts startLooking): a turn inside the structure with nothing selected turns the camera where it
// stands, not about the target. The flag is set when a turn starts; the anchor is where the camera was then.
let looking = false;
let anchor = { place: [0, 0, 0], distance: 0 };
export function startLooking(on: boolean): void {
  looking = on;
  if (!on) return;
  const now = viewNow();
  const place = cameraPosition(now, extentNow());
  anchor = { place, distance: span(place, now.target) };
}

// Turns about a screen axis. Positive: tilt up, turn left, spin clockwise. About the target, or in place when looking.
export function rotate(axis: ScreenAxis, degrees: number): void {
  move((s) =>
    looking ? turnedInPlace(s, SCREEN_AXES[axis], degrees, extentNow()) : rotated(s, SCREEN_AXES[axis], degrees),
  );
}

// A trackball drag turns the camera about the target, so while looking its moves are put back: the camera stays at its
// anchor place, and the target moves back in front of it at the anchor distance (the in-place turn, for the drag).
// Called on each trackball move of a drag (ui/pivot.ts).
export function keepInPlace(): void {
  if (!looking) return;
  const cam = camera.value;
  cam.position.fromArray(anchor.place);
  controls.target.fromArray(inFrontOf(anchor.place, cam.quaternion.toArray(), anchor.distance));
  requestRender();
}

// Looks at the structure from a direction (world), with `up` as the world direction shown up on screen, glided to (the
// a, b, c and rotated buttons).
export function viewFrom(dir: THREE.Vector3, up: THREE.Vector3): void {
  glideMove((s) => viewedFrom(s, dir.toArray(), up.toArray()));
}
// The same view at once: a scene's first view and an address that cannot be used.
export function snapViewFrom(dir: THREE.Vector3, up: THREE.Vector3): void {
  move((s) => viewedFrom(s, dir.toArray(), up.toArray()));
}

// Moves the structure on screen by a fraction of the view height.
export function pan(dx: number, dy: number, fraction: number): void {
  move((s) => panned(s, dx, dy, fraction, extentNow(), frameSize()));
}

// Flies forward (positive) or back by a fraction of the view height. Perspective only (camera/fly.ts zooms in
// orthographic).
export function flyForward(fraction: number): void {
  move((s) => flown(s, visibleHeight(s, extentNow(), frameSize()) * fraction));
}

// Fits the structure to the window, glided to (the fit button and the 0 key). The fit size is the new one at once.
export function fit(): void {
  glideMove((s) => framed(s, [0, 0, 0], extentNow(), extentNow(), frameSize()));
  refit();
}

// The pivot (ui/pivot.ts): the target moves onto the hit, the camera stays. False when there is no pivot.
export function pivotTo(hitDistance: number, minDistance: number): boolean {
  const next = pivoted(viewNow(), hitDistance, minDistance, extentNow());
  if (next) move(() => next);
  return next !== null;
}

// Lets the pivot go (ui/pivot.ts).
export function releaseTo(minDistance: number, maxDistance: number): void {
  move((s) => released(s, extentNow(), minDistance, maxDistance));
}

// Switches between perspective (with a lens) and orthographic, keeping the framing.
export function switchProjection(mode: Projection, newLens = lens.value): void {
  move((s) => withProjection(s, mode, newLens, extentNow(), frameSize()));
  refit();
}

// Glides the view to `end` over GLIDE_MS (a smoothstep share each frame). A move or a drag stops it.
function glideTo(end: ViewState): void {
  const id = ++glideId;
  if (GLIDES_INSTANTLY) {
    commit(end);
    return;
  }
  const start = viewNow();
  const started = performance.now();
  const step = (): void => {
    if (id !== glideId) return;
    const progress = (performance.now() - started) / GLIDE_MS;
    commit(progress >= 1 ? end : interpolated(start, end, THREE.MathUtils.smoothstep(progress, 0, 1)));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// A move the user asks for, glided to: the end is worked out from the view as it is now.
function glideMove(change: (state: ViewState) => ViewState): void {
  glideTo(change(viewNow()));
}

// Centres on an object (its centre and size in scene units), glided to.
export function centreOn(centre: THREE.Vector3, size: number): void {
  glideTo(framed(viewNow(), centre.toArray(), size, extentNow(), frameSize()));
}

// Looks along a direction at an object: the view turns to the direction and frames the object, in one glide (the
// selection card's a, b and c).
export function centreOnFrom(centre: THREE.Vector3, size: number, dir: THREE.Vector3, up: THREE.Vector3): void {
  const turned = viewedFrom(viewNow(), dir.toArray(), up.toArray());
  glideTo(framed(turned, centre.toArray(), size, extentNow(), frameSize()));
}

// Glides so that `point` comes to the middle of the screen (a double-click), the camera moving with the target.
export function glideTarget(point: THREE.Vector3): void {
  glideTo({ ...viewNow(), target: point.toArray() });
}

// A drag takes over from a glide.
controls.addEventListener("start", () => {
  glideId++;
});
