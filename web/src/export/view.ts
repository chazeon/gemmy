// The camera for the SVG export: the page's view as a basis, a scale and an eye. Every projection the export does goes
// through View, so the shapes never see the camera's numbers.
import { Quaternion, Vector2, Vector3 } from "three";
import { EPS, GEMMY } from "../config";
import { baseDistance, orthoFrame } from "../camera/framing";
import type { Vec3 } from "../types";

// Angstrom: the floor on the view depth, so a point in the eye plane never divides by zero.
const MIN_DEPTH = 1e-3;
// Radians: a sphere whose silhouette cone reaches the eye plane is left out.
const HORIZON_MARGIN = 1e-3;

export interface ViewOptions {
  centre: Vec3; // the scene's centre, added back to the page coordinates
  target: Vec3; // the orbit target, in page coordinates
  quaternion: number[]; // the camera orientation, x y z w (three.js order)
  zoom: number;
  extent: number; // radius of the bounding sphere: the framing uses it
  width: number;
  height: number;
  projection?: "ortho" | "persp";
  lens?: number; // mm, perspective only
}

interface SphereImage {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  phi: number; // angle of the rx axis on screen
}

export interface View {
  right: Vector3; // the camera's axes, as scene directions
  up: Vector3;
  back: Vector3; // towards the viewer
  toCam(p: Vector3): Vector3; // scene position -> camera space (x right, y up, z towards the viewer)
  toScreen(c: Vector3): Vector2; // camera space -> screen pixels (y down)
  depth(c: Vector3): number; // sort key: the distance to the eye, negated, so larger is nearer
  pxPerUnit(c: Vector3): number; // pixels per angstrom at that point, for radii
  sphereImage(c: Vector3, r: number): SphereImage | null;
}

// The numbers of a perspective view that the sphere formulas need.
interface Pinhole {
  eyeZ: number;
  focal: number; // pixels per angstrom at depth 1, the lens in pixels
  W: number;
  H: number;
}

// The scene's position as a vector.
export const vec3 = (p: readonly number[]): Vector3 => new Vector3(p[0], p[1], p[2]);

export function makeView(o: ViewOptions): View {
  const { width: W, height: H, zoom } = o;
  const orientation = new Quaternion().fromArray(o.quaternion);
  const right = new Vector3(1, 0, 0).applyQuaternion(orientation);
  const up = new Vector3(0, 1, 0).applyQuaternion(orientation);
  const back = new Vector3(0, 0, 1).applyQuaternion(orientation);
  const offset = vec3(o.centre).add(vec3(o.target));
  const inverse = orientation.clone().invert();
  const persp = o.projection === "persp";
  const lens = o.lens ?? GEMMY.defaultLens;
  const eyeZ = baseDistance(o.extent) / zoom;
  // Perspective: the lens in pixels (focal, the sensor spanning the larger side) over the depth, the eye being eyeZ
  // from the target. The page's framing gives the same field of view (perspFov), so the two agree.
  const focal = lens * (Math.max(W, H) / GEMMY.sensorWidth);
  const scale = (W / (2 * orthoFrame(o.extent, W, H).halfWidth)) * zoom; // CSS pixels per angstrom, orthographic
  const pinhole: Pinhole = { eyeZ, focal, W, H };

  const toCam = (p: Vector3) => p.clone().sub(offset).applyQuaternion(inverse);
  // Pixels per angstrom at camera-space point c. The depth is clamped to MIN_DEPTH before the divide, so a point in the
  // eye plane stays finite (no Infinity) and one behind the eye is not mirrored.
  const pxPerUnit = (c: Vector3) => (persp ? focal / Math.max(eyeZ - c.z, MIN_DEPTH) : scale);
  // The pinhole in plain form, the same arithmetic as the page's export before THREE was used here: the explicit
  // formula keeps the numbers exact, where a projection matrix moves some of them across a rounding boundary.
  const toScreen = (c: Vector3) => {
    const k = pxPerUnit(c);
    return new Vector2(W / 2 + c.x * k, H / 2 - c.y * k);
  };
  const depth = (c: Vector3) => (persp ? -Math.hypot(c.x, c.y, eyeZ - c.z) : c.z);
  const sphereImage = (c: Vector3, r: number): SphereImage | null => {
    if (!persp) {
      const s = toScreen(c);
      return { cx: s.x, cy: s.y, rx: r * scale, ry: r * scale, phi: 0 };
    }
    return perspectiveSphereImage(c, r, pinhole);
  };
  return { right, up, back, toCam, toScreen, depth, pxPerUnit, sphereImage };
}

// The image of a sphere (camera-space centre c, radius r) under the pinhole as an ellipse. Exact: the silhouette cone
// about the line to the centre meets the image plane at radial angles theta -/+ alpha, which fixes the major axis and
// the centre (it is NOT the projected centre); the minor axis is where the cone meets the line across it. Null when
// the sphere reaches the eye plane.
function perspectiveSphereImage(c: Vector3, r: number, pinhole: Pinhole): SphereImage | null {
  const { eyeZ, focal, W, H } = pinhole;
  const t = eyeZ - c.z;
  const rho = Math.hypot(c.x, c.y);
  const dist = Math.hypot(rho, t);
  const theta = Math.atan2(rho, t);
  const alpha = Math.asin(Math.min(r / dist, 1));
  if (dist <= r || theta + alpha >= Math.PI / 2 - HORIZON_MARGIN) return null;
  const nearEdgePx = focal * Math.tan(theta - alpha);
  const farEdgePx = focal * Math.tan(theta + alpha);
  const centreOffsetPx = (nearEdgePx + farEdgePx) / 2;
  const across = (centreOffsetPx * Math.sin(theta) + focal * Math.cos(theta)) / Math.cos(alpha);
  const dx = rho > EPS ? c.x / rho : 1;
  const dy = rho > EPS ? -c.y / rho : 0; // radial direction on screen (y down)
  return {
    cx: W / 2 + dx * centreOffsetPx,
    cy: H / 2 + dy * centreOffsetPx,
    rx: (farEdgePx - nearEdgePx) / 2,
    ry: Math.sqrt(Math.max(across * across - centreOffsetPx * centreOffsetPx - focal * focal, 0)),
    phi: Math.atan2(dy, dx),
  };
}
