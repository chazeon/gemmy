// The camera math shared by the page and its exports: the frame and the lens, and the view axis. The a/b/c triad's
// layout is in render/triad-layout.ts, and the settings the export writes are in export/settings.ts. No DOM.
import { Quaternion, Vector3 } from "three";
import { GEMMY } from "../config";
import { type Vec, vdot } from "../geom/vector";

// A unit quaternion as THREE.Quaternion.toArray() gives it: x, y, z, w.
export type Quat = readonly number[];
export type Projection = "ortho" | "persp";

// ---- the frame: how far the camera sits and how wide the view is, in both projections ----

// The camera's distance from the structure at zoom 1, in angstrom (looks.camera_distance).
export const baseDistance = (extent: number): number => Math.max(GEMMY.distanceFactor * extent, GEMMY.distanceMin);
// The width of an orthographic frame at zoom 1 (looks.ortho_scale): a sphere of radius orthoSide / 2 is the structure
// plus its margin.
export const orthoSide = (extent: number): number => Math.max(GEMMY.orthoFactor * extent, GEMMY.orthoMin);
// An orthographic view sits this many structure sizes from its target: clear of the structure, inside the far plane.
export const ORTHO_VIEW_DISTANCE = 8;

// Blender's orthographic frame at zoom 1: the LARGER side spans orthoSide.
export function orthoFrame(extent: number, width: number, height: number) {
  const side = orthoSide(extent);
  const larger = Math.max(width, height);
  return { halfWidth: (side / 2) * (width / larger), halfHeight: (side / 2) * (height / larger) };
}

const RAD_TO_DEG = 180 / Math.PI;

// The vertical field of view in degrees for a lens: Blender's sensor spans the LARGER image side.
export function perspFov(lens: number, width: number, height: number): number {
  const halfSensor = (0.5 * GEMMY.sensorWidth) / Math.max(width / height, 1);
  return 2 * Math.atan(halfSensor / lens) * RAD_TO_DEG;
}

// "Fit" in perspective: the zoom at which the structure's sphere just touches the SHORTER side of the frame.
export function fitZoomPersp(extent: number, lens: number, width: number, height: number): number {
  const shorterSensor = (GEMMY.sensorWidth * Math.min(width, height)) / Math.max(width, height);
  const halfAngle = Math.atan(shorterSensor / 2 / lens);
  return (baseDistance(extent) * Math.sin(halfAngle)) / (orthoSide(extent) / 2);
}

// "Fit" in orthographic: the zoom at which the SHORTER side of the frame spans orthoSide.
export const fitZoom = (width: number, height: number): number => Math.min(width, height) / Math.max(width, height);

// The same target-plane width in both projections (see view-state.ts withProjection).
export const orthoToPerspZoom = (extent: number, lens: number, zoom: number): number =>
  (baseDistance(extent) * GEMMY.sensorWidth * zoom) / (orthoSide(extent) * lens);
export const perspToOrthoZoom = (extent: number, lens: number, zoom: number): number =>
  (zoom * orthoSide(extent) * lens) / (baseDistance(extent) * GEMMY.sensorWidth);

// ---- the view axis: flying along it, and the clip planes measured along it ----

// The camera looks down its own -z axis.
const CAMERA_FORWARD: Vec = [0, 0, -1];
export const viewForward = (quaternion: Quat): number[] => applyQuaternion(quaternion, CAMERA_FORWARD);
// A move of `distance` along the view direction, as a world vector (the camera and its target both take it).
export const flyShift = (quaternion: Quat, distance: number): number[] =>
  viewForward(quaternion).map((x) => x * distance);

// The perspective clip planes: depths along the view axis, these margins beyond the structure's sphere (radius extent /
// 2).
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

// q * v for a unit quaternion q = (x, y, z, w).
export function applyQuaternion(q: Quat, v: Vec): number[] {
  return new Vector3(...v).applyQuaternion(new Quaternion().fromArray(q)).toArray();
}
