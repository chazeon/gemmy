// The camera in the page's address: #view=persp;lens=50;eye=x,y,z;at=x,y,z;up=x,y,z, or #view=ortho;zoom=1.2;... The eye is
// where the camera is, at the point it looks at, up the screen's up, all in scene units (angstrom; the origin is the
// structure's middle). Each number keeps four significant figures, which still shows the same view. Pure: no DOM.
import { ORTHO_VIEW_DISTANCE } from "./framing";
import { span, vadd, vscale, vsub, vunit } from "../geom/vector";
import type { Vec3 } from "../types";

export const VIEW_KEY = "view"; // the name in the address: #view=...
const SIGNIFICANT_DIGITS = 4;
const FIELD_SEPARATOR = ";";
const VECTOR_SEPARATOR = ",";
const VECTOR_LENGTH = 3;

export type ViewProjection = "persp" | "ortho";
export interface ViewPose {
  projection: ViewProjection;
  lens: number; // mm, perspective only
  zoom: number; // orthographic only
  eye: Vec3;
  at: Vec3;
  up: Vec3;
}

// Four significant figures, as a number: 1.23456 gives 1.235, 0.5 gives 0.5.
export function roundFigures(x: number): number {
  return Number(x.toPrecision(SIGNIFICANT_DIGITS));
}
const numberText = (x: number): string => String(roundFigures(x));
const vectorText = (v: Vec3): string => v.map(numberText).join(VECTOR_SEPARATOR);

export function encodeView(pose: ViewPose): string {
  const size = pose.projection === "persp" ? `lens=${numberText(pose.lens)}` : `zoom=${numberText(pose.zoom)}`;
  return [pose.projection, size, `eye=${vectorText(pose.eye)}`, `at=${vectorText(pose.at)}`, `up=${vectorText(pose.up)}`]
    .join(FIELD_SEPARATOR);
}

// The pose the text says, or null when it is not one (an old or mistyped address shows the default view instead).
export function decodeView(text: string): ViewPose | null {
  const [projection, ...rest] = text.split(FIELD_SEPARATOR);
  if (projection !== "persp" && projection !== "ortho") return null;
  const fields = new URLSearchParams(rest.join("&"));
  const vector = (name: string): Vec3 | null => {
    const parts = (fields.get(name) ?? "").split(VECTOR_SEPARATOR).map(Number);
    return parts.length === VECTOR_LENGTH && parts.every(Number.isFinite) ? (parts as Vec3) : null;
  };
  const size = Number(fields.get(projection === "persp" ? "lens" : "zoom"));
  const eye = vector("eye"), at = vector("at"), up = vector("up");
  if (!(size > 0) || !Number.isFinite(size) || !eye || !at || !up) return null;
  return {
    projection,
    lens: projection === "persp" ? size : 0,
    zoom: projection === "ortho" ? size : 1,
    eye, at, up,
  };
}

// The limits of the perspective distance (the trackball's minDistance and maxDistance, scene/load.ts).
export interface DistanceLimits {
  minDistance: number;
  maxDistance: number;
}
// The camera a pose puts on screen: where the eye is, what it looks at, the screen's up, and the zoom (orthographic).
export interface PlacedPose {
  eye: Vec3;
  at: Vec3;
  up: Vec3;
  zoom: number;
}

// The camera an address pose gives, for this structure, or null when the pose has no usable direction (the eye at the
// target, or a zero up) or a number that is not finite: the caller then shows the default view. An orthographic eye's
// distance does not change the picture, only the clipping, so it goes to the standard orthographic distance along the
// same direction. A perspective eye's distance is the zoom, so it is kept, clamped to the trackball's limits.
export function placedPose(pose: ViewPose, extent: number, limits: DistanceLimits): PlacedPose | null {
  const numbers = [...pose.eye, ...pose.at, ...pose.up, pose.zoom];
  if (!numbers.every(Number.isFinite)) return null;
  const separation = span(pose.eye, pose.at);
  if (separation === 0 || Math.hypot(...pose.up) === 0) return null;
  const direction = vunit(vsub(pose.eye, pose.at));
  const distance = pose.projection === "ortho"
    ? extent * ORTHO_VIEW_DISTANCE
    : Math.min(Math.max(separation, limits.minDistance), limits.maxDistance);
  return {
    eye: vadd(pose.at, vscale(direction, distance)) as Vec3,
    at: [...pose.at] as Vec3,
    up: vunit(pose.up) as Vec3,
    zoom: pose.zoom,
  };
}
