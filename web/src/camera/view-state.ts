// The view as one state (target, orientation, zoom, lens). The three.js camera is derived from it (view.ts), and each
// camera move is a function from one state to the next. No DOM (tests/test_view_framing.py runs it in node).
import { Matrix4, MathUtils, Quaternion, Vector3 } from "three";
import {
  type Projection,
  type Quat,
  applyQuaternion,
  baseDistance,
  depthOfCentre,
  fitZoom,
  fitZoomPersp,
  flyShift,
  ORTHO_VIEW_DISTANCE,
  orthoFrame,
  orthoSide,
  orthoToPerspZoom,
  perspFov,
  perspToOrthoZoom,
  viewForward,
} from "./framing";
import { EPS } from "../config";
import { type Vec, lerp, span, vadd, vdot, vscale } from "../geom/vector";

export interface ViewState {
  target: Vec; // the orbit point (the structure's centre is the origin)
  orientation: Quat; // camera space +z points at the viewer
  zoom: number; // perspective: base distance over the distance to the target; orthographic: camera.zoom
  projection: Projection;
  lens: number; // mm, perspective only
}
export interface Frame {
  width: number;
  height: number;
}

// The zoom range, which is also the trackball's dolly range.
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 40;

// ---- the camera, derived from the state ----

// The distance from the target to the camera. Orthographic: a fixed distance, which does not change the picture.
const orbitDistance = (view: ViewState, extent: number): number =>
  view.projection === "persp" ? baseDistance(extent) / view.zoom : extent * ORTHO_VIEW_DISTANCE;
const backAxis = (orientation: Quat): number[] => applyQuaternion(orientation, [0, 0, 1]);
export const upAxis = (orientation: Quat): number[] => applyQuaternion(orientation, [0, 1, 0]);
export const cameraPosition = (view: ViewState, extent: number): number[] =>
  vadd(view.target, vscale(backAxis(view.orientation), orbitDistance(view, extent)));

// The readout's zoom: base distance over the camera's distance from the structure's centre. Derived, not stored: a
// pivot moves only the target, so the readout holds through it; a pan or a fly moves the camera, so it changes.
export function shownZoom(view: ViewState, extent: number): number {
  if (view.projection !== "persp") return view.zoom;
  return baseDistance(extent) / Math.hypot(...cameraPosition(view, extent));
}

// The zoom that frames an object of `size` in the frame (the structure's fit is size = extent).
function frameZoom(projection: Projection, lens: number, size: number, extent: number, frame: Frame): number {
  if (projection === "persp") {
    return fitZoomPersp(size, lens, frame.width, frame.height) * (baseDistance(extent) / baseDistance(size));
  }
  return (fitZoom(frame.width, frame.height) * orthoSide(extent)) / orthoSide(size);
}
export const fitZoomFor = (projection: Projection, lens: number, extent: number, frame: Frame): number =>
  frameZoom(projection, lens, extent, extent, frame);

// How tall the view is at the target (a pan or a fly moves by a fraction of it).
export function visibleHeight(view: ViewState, extent: number, frame: Frame): number {
  if (view.projection === "persp") {
    const halfAngle = (perspFov(view.lens, frame.width, frame.height) * MathUtils.DEG2RAD) / 2;
    return 2 * orbitDistance(view, extent) * Math.tan(halfAngle);
  }
  return (2 * orthoFrame(extent, frame.width, frame.height).halfHeight) / view.zoom;
}

// ---- orientations ----

// The orientation that looks along -back with `up` on screen: THREE's lookAt basis (x = up x z, y = z x x, z = back) as
// a quaternion. An up along the sightline is degenerate, and lookAt nudges it to a finite frame instead of dividing by 0.
export function orientationFromBasis(back: Vec, up: Vec): number[] {
  const basis = new Matrix4().lookAt(new Vector3(...back), new Vector3(0, 0, 0), new Vector3(...up));
  return new Quaternion().setFromRotationMatrix(basis).toArray();
}

// ---- the moves: state in, state out ----

// Slides the camera along its view line through the target until the readout is `wanted`. The target and the direction
// hold, and the distance from the target stays within the trackball's limits (so the readout can end short). The line
// meets the sphere of radius base/wanted at the roots of s^2 + 2 (target . towards) s + |target|^2 - radius^2; a line
// that misses the sphere can only reach its nearest point.
export function dollied(view: ViewState, wanted: number, extent: number): ViewState {
  const towards = backAxis(view.orientation);
  const along = vdot(view.target, towards);
  const discriminant = along * along - (vdot(view.target, view.target) - (baseDistance(extent) / wanted) ** 2);
  const roots = discriminant < 0 ? [-along] : [-along - Math.sqrt(discriminant), -along + Math.sqrt(discriminant)];
  const ahead = roots.filter((s) => s > 0);
  if (!ahead.length) return view;
  const current = orbitDistance(view, extent);
  const nearest = ahead.reduce((best, s) => (Math.abs(s - current) < Math.abs(best - current) ? s : best));
  const distance = MathUtils.clamp(nearest, baseDistance(extent) / ZOOM_MAX, baseDistance(extent) / ZOOM_MIN);
  return { ...view, zoom: baseDistance(extent) / distance };
}

// The zoom buttons and the readout: the readout becomes `wanted`, within the zoom range.
export function zoomedTo(view: ViewState, wanted: number, extent: number): ViewState {
  const level = MathUtils.clamp(wanted, ZOOM_MIN, ZOOM_MAX);
  return view.projection === "persp" ? dollied(view, level, extent) : { ...view, zoom: level };
}

// Turns about a screen axis by `degrees`, about the target (the distance from it does not change).
export function rotated(view: ViewState, screenAxis: Vec, degrees: number): ViewState {
  const world = new Vector3(...applyQuaternion(view.orientation, screenAxis));
  const turn = new Quaternion().setFromAxisAngle(world, degrees * MathUtils.DEG2RAD);
  return { ...view, orientation: turn.multiply(new Quaternion().fromArray(view.orientation)).toArray() };
}

// Moves the structure on screen: the target moves with the camera (positive dx moves the camera right).
export function panned(
  view: ViewState,
  dx: number,
  dy: number,
  fraction: number,
  extent: number,
  frame: Frame,
): ViewState {
  const amount = visibleHeight(view, extent, frame) * fraction;
  return { ...view, target: vadd(view.target, applyQuaternion(view.orientation, [-dx * amount, -dy * amount, 0])) };
}

// Flies along the view direction by `distance`. The target goes with the camera, so the zoom does not change.
export const flown = (view: ViewState, distance: number): ViewState => ({
  ...view,
  target: vadd(view.target, flyShift(view.orientation, distance)),
});

// Frames an object of `size` centred on `centre`.
export function framed(view: ViewState, centre: Vec, size: number, extent: number, frame: Frame): ViewState {
  const zoom = frameZoom(view.projection, view.lens, size, extent, frame);
  return { ...view, target: [...centre], zoom };
}

// Looks at the centre from `direction`, with `up` on screen. Perspective goes back to the base distance (zoom 1).
export function viewedFrom(view: ViewState, direction: Vec, up: Vec): ViewState {
  return {
    ...view,
    target: [0, 0, 0],
    orientation: orientationFromBasis(direction, up),
    zoom: view.projection === "persp" ? 1 : view.zoom,
  };
}

// The pivot: the target moves onto the point the screen centre hits, the camera stays put. A hit nearer than
// minDistance pivots at minDistance (the trackball would push the camera back). Null when the hit is not nearer than
// the target.
export function pivoted(view: ViewState, hitDistance: number, minDistance: number, extent: number): ViewState | null {
  const position = cameraPosition(view, extent);
  const distance = Math.max(hitDistance, minDistance);
  if (distance >= span(position, view.target)) return null;
  return {
    ...view,
    target: vadd(position, vscale(viewForward(view.orientation), distance)),
    zoom: baseDistance(extent) / distance,
  };
}

// Lets the pivot go: the target slides along the view line to the depth of the centre, within the trackball's limits.
export function released(view: ViewState, extent: number, minDistance: number, maxDistance: number): ViewState {
  const position = cameraPosition(view, extent);
  const along = MathUtils.clamp(depthOfCentre(position, view.orientation), minDistance, maxDistance);
  return {
    ...view,
    target: vadd(position, vscale(viewForward(view.orientation), along)),
    zoom: view.projection === "persp" ? baseDistance(extent) / along : view.zoom,
  };
}

// Switches projection. The zoom converts through the orthographic zoom (the same width at the target plane in both), so
// the framing holds. A fitted view stays fitted.
export function withProjection(
  view: ViewState,
  projection: Projection,
  lens: number,
  extent: number,
  frame: Frame,
): ViewState {
  if (projection === view.projection && (projection === "ortho" || lens === view.lens)) return { ...view, lens };
  const fitted = Math.abs(shownZoom(view, extent) - fitZoomFor(view.projection, view.lens, extent, frame)) < EPS;
  const orthoZoom = view.projection === "persp" ? perspToOrthoZoom(extent, view.lens, view.zoom) : view.zoom;
  const zoom = projection === "persp" ? orthoToPerspZoom(extent, lens, orthoZoom) : orthoZoom;
  const next = { ...view, projection, lens };
  return { ...next, zoom: fitted ? fitZoomFor(projection, lens, extent, frame) : zoom };
}

// The state a glide shows at `share` (0 to 1) between two framings (the zoom moves by a constant ratio per share).
export function interpolated(from: ViewState, to: ViewState, share: number): ViewState {
  return {
    target: lerp(from.target, to.target, share),
    orientation: new Quaternion()
      .fromArray(from.orientation)
      .slerp(new Quaternion().fromArray(to.orientation), share)
      .toArray(),
    zoom: from.zoom * (to.zoom / from.zoom) ** share,
    projection: to.projection,
    lens: to.lens,
  };
}
