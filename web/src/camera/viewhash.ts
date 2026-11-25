// The camera in the address: #view=persp;lens=50;eye=x,y,z;at=x,y,z;up=x,y,z (or ortho;zoom=...). Eye, at and up are in
// scene units, the origin the structure's middle. Numbers keep four significant figures, which show the same view. No
// DOM.
import { type Projection, baseDistance } from "./framing";
import { MathUtils } from "three";
import { span, vsub } from "../geom/vector";
import { type ViewState, ZOOM_MAX, ZOOM_MIN, cameraPosition, orientationFromBasis, upAxis } from "./view-state";
import type { Vec3 } from "../types";

export const VIEW_KEY = "view";
const SIGNIFICANT_DIGITS = 4;
const FIELD_SEPARATOR = ";";
const VECTOR_SEPARATOR = ",";
const VECTOR_LENGTH = 3;

export interface ViewPose {
  projection: Projection;
  lens: number; // mm, perspective only
  zoom: number; // orthographic only
  eye: Vec3;
  at: Vec3;
  up: Vec3;
}

const numberText = (x: number): string => String(Number(x.toPrecision(SIGNIFICANT_DIGITS)));
const vectorText = (v: Vec3): string => v.map(numberText).join(VECTOR_SEPARATOR);

export function encodeView(pose: ViewPose): string {
  const size = pose.projection === "persp" ? `lens=${numberText(pose.lens)}` : `zoom=${numberText(pose.zoom)}`;
  return [
    pose.projection,
    size,
    `eye=${vectorText(pose.eye)}`,
    `at=${vectorText(pose.at)}`,
    `up=${vectorText(pose.up)}`,
  ].join(FIELD_SEPARATOR);
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
  const eye = vector("eye"),
    at = vector("at"),
    up = vector("up");
  if (!(size > 0) || !Number.isFinite(size) || !eye || !at || !up) return null;
  return {
    projection,
    lens: projection === "persp" ? size : 0,
    zoom: projection === "ortho" ? size : 1,
    eye,
    at,
    up,
  };
}

// The state an address pose gives, or null when it has no usable direction or a number is not finite. An orthographic
// eye gives only its direction (its distance is not part of the picture); a perspective eye's distance is the zoom,
// clamped.
export function viewFromPose(pose: ViewPose, extent: number, lens: number): ViewState | null {
  const numbers = [...pose.eye, ...pose.at, ...pose.up, pose.zoom];
  if (!numbers.every(Number.isFinite)) return null;
  const separation = span(pose.eye, pose.at);
  if (separation === 0 || Math.hypot(...pose.up) === 0) return null;
  const persp = pose.projection === "persp";
  const zoom = persp ? MathUtils.clamp(baseDistance(extent) / separation, ZOOM_MIN, ZOOM_MAX) : pose.zoom;
  return {
    target: [...pose.at],
    orientation: orientationFromBasis(vsub(pose.eye, pose.at), pose.up),
    zoom,
    projection: pose.projection,
    lens: persp ? pose.lens : lens,
  };
}

// The address pose of a state, with the eye where the camera is.
export function poseOf(view: ViewState, extent: number): ViewPose {
  return {
    projection: view.projection,
    lens: view.lens,
    zoom: view.zoom,
    eye: cameraPosition(view, extent) as Vec3,
    at: view.target as Vec3,
    up: upAxis(view.orientation) as Vec3,
  };
}
