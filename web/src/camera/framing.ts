// The camera math shared by the page and its exports: the frame and the lens, the view as `gemmy render` takes it,
// the settings and command text, and the a/b/c triad. Pure: no THREE, no DOM.
import { GEMMY } from "../config";
import { type Vec, span, vdot, vsub, vunit } from "../geom/vector";
import type { Vec3 } from "../types";

// A unit quaternion as THREE.Quaternion.toArray() gives it: x, y, z, w.
export type Quat = readonly number[];
export type Projection = "ortho" | "persp";

// ---- the frame: how far the camera sits and how wide the view is, in both projections ----

// The camera's distance from the structure at zoom 1, in angstrom (looks.camera_distance).
export const baseDistance = (extent: number): number => Math.max(GEMMY.distanceFactor * extent, GEMMY.distanceMin);
// The width of an orthographic frame at zoom 1 (looks.ortho_scale). Also the size of the ortho margin: a sphere of
// radius orthoSide / 2 is the whole structure plus that margin.
export const orthoSide = (extent: number): number => Math.max(GEMMY.orthoFactor * extent, GEMMY.orthoMin);

// Blender gives an orthographic camera at zoom 1 a frame whose LARGER side spans orthoSide (ortho_scale). The camera's
// own zoom then divides it, so this is the half size of the view at zoom 1.
export function orthoFrame(extent: number, width: number, height: number) {
  const side = orthoSide(extent);
  const larger = Math.max(width, height);
  return { halfWidth: (side / 2) * (width / larger), halfHeight: (side / 2) * (height / larger) };
}

const RAD_TO_DEG = 180 / Math.PI;

// The vertical field of view in degrees for a lens. Blender's sensor (SENSOR_WIDTH, fit AUTO) spans the LARGER image
// side, so the shorter side is the sensor scaled by the aspect. The page's camera gets the same field of view.
export function perspFov(lens: number, width: number, height: number): number {
  const halfSensor = (0.5 * GEMMY.sensorWidth) / Math.max(width / height, 1);
  return 2 * Math.atan(halfSensor / lens) * RAD_TO_DEG;
}

// Where the camera sits for a view orientation (camera space z points at the viewer), in page coordinates as the
// render places it: the target plus the view direction at the camera distance.
export function cameraPosition(quaternion: Quat, target: Vec, zoom: number, extent: number): number[] {
  const direction = applyQuaternion(quaternion, [0, 0, 1]);
  return direction.map((x, i) => target[i] + (x * baseDistance(extent)) / zoom);
}

// "Fit" in perspective: the zoom at which the whole structure (its sphere, with the ortho margin) just touches the
// SHORTER side of the frame.
export function fitZoomPersp(extent: number, lens: number, width: number, height: number): number {
  const shorterSensor = (GEMMY.sensorWidth * Math.min(width, height)) / Math.max(width, height);
  const halfAngle = Math.atan(shorterSensor / 2 / lens);
  return (baseDistance(extent) * Math.sin(halfAngle)) / (orthoSide(extent) / 2);
}

// "Fit" in orthographic: the zoom at which the SHORTER side of the frame spans orthoSide, so the whole structure shows
// in a window of any shape. It is an ordinary camera.zoom, so an exported view reproduces it in Blender.
export const fitZoom = (width: number, height: number): number => Math.min(width, height) / Math.max(width, height);

// The same width of the target plane in both projections. The ortho zoom is orthoSide / width, the perspective zoom
// is distance * sensor / (lens * width), so switching keeps the framing at the target.
export const orthoToPerspZoom = (extent: number, lens: number, zoom: number): number =>
  (baseDistance(extent) * GEMMY.sensorWidth * zoom) / (orthoSide(extent) * lens);
export const perspToOrthoZoom = (extent: number, lens: number, zoom: number): number =>
  (zoom * orthoSide(extent) * lens) / (baseDistance(extent) * GEMMY.sensorWidth);

// ---- the view as the page exports it: settings for `gemmy render` ----

// The long side of an exported render, in pixels (the page's view is written at this size).
const EXPORT_LONG_SIDE = 1600;

// The page's camera, in page coordinates (the structure's centre is the origin). `box` is the cell box or null.
export interface PageView {
  quaternion: Quat;
  zoom: number;
  target: Vec;
  centre: Vec;
  box: unknown; // truthy when the cell box is shown
  width: number;
  height: number;
  projection?: Projection;
  lens?: number;
}

// The same view in scene coordinates, as `gemmy render` takes it.
export interface ExportedView {
  projection: Projection;
  lens: number | undefined;
  direction: number[];
  up: number[];
  zoom: number;
  target: number[];
  cellBox: boolean;
  resolution: [number, number];
}

// direction points from the target to the camera; up is the world direction shown up on screen. Numbers are rounded
// to the precision `gemmy render` needs, so the copied settings read well.
export function exportView(view: PageView): ExportedView {
  const { quaternion, zoom, target, centre, box, width, height } = view;
  return {
    projection: view.projection ?? "ortho",
    lens: view.projection === "persp" ? view.lens : undefined,
    direction: applyQuaternion(quaternion, [0, 0, 1]).map((x) => roundTo(x, 4)),
    up: applyQuaternion(quaternion, [0, 1, 0]).map((x) => roundTo(x, 4)),
    zoom: roundTo(zoom, 3),
    target: target.map((t, i) => roundTo(t + centre[i], 4)),
    cellBox: Boolean(box),
    resolution: resolutionFor(width, height),
  };
}

// The settings as the TOML and JSON files `gemmy render --settings` reads: tables of keys, in this order.
export type SettingsTables = Record<string, Record<string, TomlValue>>;
export function settingsObject(view: ExportedView): SettingsTables {
  return {
    look: { preset: "3to2d" },
    camera: {
      projection: view.projection,
      ...(view.lens === undefined ? {} : { lens: view.lens }),
      direction: view.direction,
      up: view.up,
      zoom: view.zoom,
      target: view.target,
    },
    cell_box: { show: view.cellBox },
    quality: { resolution: view.resolution },
  };
}
export const settingsJson = (view: ExportedView): string => `${JSON.stringify(settingsObject(view), null, 2)}\n`;
export function settingsToml(view: ExportedView): string {
  return Object.entries(settingsObject(view))
    .map(([table, keys]) => `[${table}]\n${Object.entries(keys).map(([k, v]) => `${k} = ${tomlValue(v)}`).join("\n")}\n`)
    .join("\n");
}

// The `gemmy render` command line that reproduces the view (what the "copy command" button puts on the clipboard).
export function renderCommand(view: ExportedView, sceneFile: string): string {
  const [w, h] = view.resolution;
  return [
    "gemmy render", "--scene", shellWord(sceneFile), "--look.preset 3to2d", `--camera.projection ${view.projection}`,
    ...(view.lens === undefined ? [] : [`--camera.lens ${view.lens}`]),
    `--camera.direction ${view.direction.join(" ")}`, `--camera.up ${view.up.join(" ")}`, `--camera.zoom ${view.zoom}`,
    `--camera.target ${view.target.join(" ")}`, `--cell-box.show ${view.cellBox ? "True" : "False"}`,
    `--quality.resolution ${w} ${h}`, "--out view.png",
  ].join(" ");
}

// ---- the a/b/c triad, laid out like the Blender overlay (gemmy.render.blender.overlay) ----

// One axis of the triad. `depth` is its camera-space z (larger is nearer the viewer); the arrow fields are absent when
// the axis points (almost) straight at the viewer and shows only as a dot-and-label.
export type TriadItem = TriadLabelled & (TriadArrowed | { shaftEnd?: undefined; head?: undefined });
interface TriadLabelled {
  index: number;
  depth: number;
  label: { x: number; y: number };
}
interface TriadArrowed {
  shaftEnd: [number, number];
  head: [number, number][];
}

// Pixels, y down. `length` is the arrow length; the arrows, labels and dot are all sized from it.
export interface TriadLayout {
  origin: [number, number];
  items: TriadItem[];
  lineWidth: number;
  fontSize: number;
  dotRadius: number;
  length: number;
}

// `dirs` are the axis directions in camera space (x right, y up, z towards the viewer). The arrows are `triad.size` of
// the frame's SHORTER side long, the origin sits `triad.margin` of the width from the left and of the height from the
// bottom, and each label sits just beyond its arrow tip.
export function triadLayout(dirs: readonly Vec[], width: number, height: number): TriadLayout {
  const T = GEMMY.triad;
  const length = T.size * Math.min(width, height);
  const origin: [number, number] = [T.margin * width, height - T.margin * height];
  const items = dirs
    .map((d, index) => triadItem(d, index, origin, length))
    .sort((p, q) => p.depth - q.depth); // far axes first, so near ones draw over them
  return {
    origin,
    items,
    lineWidth: 2 * T.arrowRadius * length,
    fontSize: T.labelSize * length,
    dotRadius: DOT_RADIUS * length,
    length,
  };
}

// Below these on-screen lengths (the unit direction's flat part, hypot(x, y)) an axis is treated as pointing at the
// viewer: no head, and a label placed diagonally instead of along the arrow. Same cut-offs as the Python side
// (geom.axis_label_position uses 0.15, geom.triad_layout uses 0.08).
const LABEL_FLAT_MIN = 0.15;
const HEAD_FLAT_MIN = 0.08;
// Where the label of an axis that points at the viewer goes: 1/sqrt(2), up and to the right of the origin.
const DIAGONAL = Math.SQRT1_2;
// The dot at the origin, as a share of the triad length. The Blender overlay draws no dot, so this is page only.
const DOT_RADIUS = 0.0875;

function triadItem(d: Vec, index: number, origin: [number, number], length: number): TriadItem {
  const T = GEMMY.triad;
  const flat = Math.hypot(d[0], d[1]);
  const onScreen = flat > LABEL_FLAT_MIN;
  const [ux, uy] = labelDirection(d, flat, onScreen);
  // The arrow length plus the head's reach: the radius the Python side passes to axis_label_position as `length`.
  const labelRadius = length * (1 + T.labelReach * T.arrowRadius);
  const reach = onScreen ? labelRadius * flat : 0; // the label's distance from the origin along the arrow
  const pad = T.labelPad * length;
  const label = { x: origin[0] + (reach + pad) * ux, y: origin[1] - (reach + pad) * uy };
  return flat > HEAD_FLAT_MIN
    ? { index, depth: d[2], label, ...triadArrow(d, flat, origin, length) }
    : { index, depth: d[2], label };
}

// The unit direction the label is pushed along: the arrow's own direction on screen, or the diagonal when the axis
// points at the viewer.
function labelDirection(d: Vec, flat: number, onScreen: boolean): [number, number] {
  return onScreen ? [d[0] / flat, d[1] / flat] : [DIAGONAL, DIAGONAL];
}

// The shaft and head of an axis that shows its direction on screen. The shaft stops halfway into the head, so the
// join is hidden (SHAFT_INTO_HEAD).
const SHAFT_INTO_HEAD = 0.5;
function triadArrow(d: Vec, flat: number, [ox, oy]: [number, number], length: number): TriadArrowed {
  const T = GEMMY.triad;
  const tip: [number, number] = [ox + d[0] * length, oy - d[1] * length];
  const tx = d[0] / flat; // the unit direction on screen (y points down)
  const ty = -d[1] / flat;
  const headLength = T.headLengthRatio * length;
  const headHalf = T.headRadiusRatio * T.arrowRadius * length;
  const base: [number, number] = [tip[0] - tx * headLength, tip[1] - ty * headLength]; // where the head meets the shaft
  return {
    shaftEnd: [tip[0] - tx * headLength * SHAFT_INTO_HEAD, tip[1] - ty * headLength * SHAFT_INTO_HEAD],
    head: [
      tip,
      [base[0] - ty * headHalf, base[1] + tx * headHalf],
      [base[0] + ty * headHalf, base[1] - tx * headHalf],
    ],
  };
}

// ---- the view axis: flying along it, and the clip planes measured along it ----

// The camera looks down its own -z axis. In camera space that is this vector, and the view direction in world terms
// is the same vector turned by the camera's orientation.
export const CAMERA_FORWARD: Vec = [0, 0, -1];
export const viewForward = (quaternion: Quat): number[] => applyQuaternion(quaternion, CAMERA_FORWARD);
// A move of `distance` along the view direction, as a world vector. The camera and its target both take it, so the
// distance between them does not change (the zoom is baseDistance / that distance).
export const flyShift = (quaternion: Quat, distance: number): number[] =>
  viewForward(quaternion).map((x) => x * distance);

// ---- the zoom the page shows, and the pivot ----
// The perspective zoom shown on the page measures the camera against the structure's centre (the origin), not against
// the target: a pivot moves the target and leaves the camera where it is, so the shown zoom holds still.
export const centreDistance = (position: Vec): number => Math.hypot(position[0], position[1], position[2]);

// The point `distance` along a direction from `from`.
export const pointAlong = (from: Vec, direction: Vec, distance: number): number[] =>
  from.map((x, i) => x + direction[i] * distance);

// Where a pivot puts the target: on the view ray through the screen centre, at the hit's distance from the camera. A
// hit nearer than `minDistance` pivots at minDistance instead, because the trackball would push the camera back from a
// nearer target (TrackballControls.checkDistances). Null when that point is not nearer than the current target.
export function pivotTarget(
  position: Vec, quaternion: Quat, currentTarget: Vec, hitDistance: number, minDistance: number,
): number[] | null {
  const pivotDistance = Math.max(hitDistance, minDistance);
  const targetDistance = span(position, currentTarget);
  if (pivotDistance >= targetDistance) return null;
  return pointAlong(position, viewForward(quaternion), pivotDistance);
}

// The distances along a line from `target` (unit direction `towards`) at which the line is `wanted` from the origin.
// Points target + towards * s are `wanted` from the origin where s^2 + 2 * alongTarget * s + (|target|^2 - wanted^2) = 0,
// with alongTarget = target . towards. When the line misses that sphere, the line's nearest point to the origin is the
// closest it gets: that single distance is returned, and the caller reaches only that far.
function distancesFromCentre(target: Vec, towards: Vec, wanted: number): number[] {
  const alongTarget = vdot(target, towards);
  const discriminant = alongTarget * alongTarget - (vdot(target, target) - wanted * wanted);
  if (discriminant < 0) return [-alongTarget];
  const root = Math.sqrt(discriminant);
  return [-alongTarget - root, -alongTarget + root];
}

const clampTo = (x: number, low: number, high: number): number => Math.min(Math.max(x, low), high);

// The camera position on its view line through the target (the line keeps the view direction) that is `wanted` from the
// origin, nearest the current position. The distance to the target is then kept within [minDistance, maxDistance]
// (the trackball's own limits), which can leave the camera short of `wanted`. Null when the camera is at the target or
// the line has no point ahead of the target.
export function dollyPosition(
  position: Vec, target: Vec, wanted: number, minDistance: number, maxDistance: number,
): number[] | null {
  const current = span(position, target);
  if (current === 0) return null;
  const towards = vunit(vsub(position, target));
  const ahead = distancesFromCentre(target, towards, wanted).filter((s) => s > 0);
  if (!ahead.length) return null;
  const nearest = ahead.reduce((best, s) => (Math.abs(s - current) < Math.abs(best - current) ? s : best));
  const along = clampTo(nearest, minDistance, maxDistance);
  return target.map((x, i) => x + towards[i] * along);
}

// The clip planes (perspective). The structure is a sphere about the origin, its centre, with radius extent / 2 (the
// bounding-box diagonal is `extent`, scene/bounds.ts). The planes are depths along the view axis, not distances from
// the camera, and lie these margins beyond the sphere's near and far surfaces.
const CLIP_MARGIN_IN_FRONT = 1; // in extents, beyond the near surface
const CLIP_MARGIN_BEHIND = 2; // in extents, beyond the far surface
const NEAREST_CLIP = 0.01; // angstrom: the near plane must never reach the camera

// How far in front of the camera the structure's centre (the origin) lies, measured along the view axis. Negative when
// the centre is behind the camera.
export const depthOfCentre = (position: Vec, quaternion: Quat): number => -vdot(position, viewForward(quaternion));

// The near and far depths that keep the whole structure between them, given the centre's depth. Inside the sphere the
// near plane is at NEAREST_CLIP.
export function clipPlanesAround(depth: number, structureExtent: number): { near: number; far: number } {
  const radius = structureExtent / 2;
  return {
    near: Math.max(depth - radius - CLIP_MARGIN_IN_FRONT * structureExtent, NEAREST_CLIP),
    far: depth + radius + CLIP_MARGIN_BEHIND * structureExtent,
  };
}

// ---- helpers ----

// The export's resolution: the long side is EXPORT_LONG_SIDE pixels and the other keeps the aspect ratio.
function resolutionFor(width: number, height: number): [number, number] {
  const scale = EXPORT_LONG_SIDE / Math.max(width, height);
  return [Math.round(width * scale), Math.round(height * scale)];
}

// Rounds to `digits` decimals. `|| 0` turns -0 into 0, so the settings never say -0.
const roundTo = (x: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(x * scale) / scale || 0;
};

// q * v for a unit quaternion q = (x, y, z, w): v + 2w(u x v) + 2 u x (u x v), with u the vector part of q.
export function applyQuaternion(q: Quat, v: Vec): number[] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

type TomlValue = string | number | boolean | readonly TomlValue[];
const tomlValue = (v: TomlValue): string => (Array.isArray(v) ? `[${v.map(tomlValue).join(", ")}]` : JSON.stringify(v));

// A path or word as a shell argument: plain words stay bare, anything else is single-quoted.
const shellWord = (text: string): string =>
  /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
