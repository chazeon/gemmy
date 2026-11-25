// The triad's 3D model: the shafts, heads and origin ball of the a b c arrows, their sizes and colours, and the
// orthographic camera that draws them in the corner the triad occupies. One source for the live render (triad3d.ts) and
// the SVG trace (trace/triad-trace.ts), so the two draw the same solids. Pure THREE: no renderer, no DOM, so the node
// tests can load it.
import * as THREE from "three";
import type { TriadLayout } from "./triad-layout";
import { GEMMY, LOOK } from "../config";

// The sizes are fractions of the triad length: the numbers the Blender overlay and the SVG export use (GEMMY.triad).
const T = GEMMY.triad;
const SHAFT_RADIUS = T.arrowRadius;
const HEAD_RADIUS = T.headRadiusRatio * T.arrowRadius;
const HEAD_LENGTH = T.headLengthRatio;
// The origin ball is white and about the head's base radius, so it reads as a ball and hides the roots of the axes
// pointing away. It is never faded. It is longer than the shaft and narrower than a head is long, so a head pointing
// at the viewer still sits in front of it.
const BALL_TO_HEAD_BASE = 1.1; // the ball radius over the head base radius (1.0 to 1.15 reads as a ball)
const BALL_RADIUS = BALL_TO_HEAD_BASE * HEAD_RADIUS;
export const BALL_COLOUR = "#ffffff";
const SIDES = 24; // around a shaft or a head, as the structure's tubes (draw.ts TUBE_SEGMENTS)
const BALL_SEGMENTS = { width: 32, height: 16 };
// The corner the triad is drawn in, in triad lengths from the origin (the arrows and the ball; the labels are on the
// page).
const CORNER_LENGTHS = 1.2;
// The triad camera sits this many lengths behind the origin, and clips to the range the arrows fill.
const CAMERA_LENGTHS = 3;
const NEAR_LENGTHS = 0.5;
const FAR_LENGTHS = 5;
const UP = new THREE.Vector3(0, 1, 0); // the cylinder and cone geometry run along +y

// A solid: a cylinder or a cone along its own +y axis, centred, or a sphere. Sizes in CSS px.
export interface Shape {
  kind: "cylinder" | "cone" | "sphere";
  radius: number;
  height: number;
}

// One solid placed in the triad's frame. `colour` is its base colour (sRGB hex); `axis` is the axis it belongs to (its
// fade follows that axis), or null for the origin ball, which is never faded.
export interface TriadPart {
  shape: Shape;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  colour: string;
  axis: number | null;
}

// The model of a triad of `length` px whose axes point along the unit `directions` (lattice order). The solids come in
// this order: each axis's shaft, then each axis's head, then the origin ball. The shaft stops halfway into its head, so
// the join is hidden.
export function triadModel(length: number, directions: readonly THREE.Vector3[]): TriadPart[] {
  const shaftLength = length * (1 - HEAD_LENGTH / 2);
  const shaft: Shape = { kind: "cylinder", radius: SHAFT_RADIUS * length, height: shaftLength };
  const head: Shape = { kind: "cone", radius: HEAD_RADIUS * length, height: HEAD_LENGTH * length };
  const orientation = (direction: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(UP, direction);
  const shafts = directions.map(
    (direction, axis): TriadPart => ({
      shape: shaft,
      position: direction.clone().multiplyScalar(shaftLength / 2),
      quaternion: orientation(direction),
      colour: LOOK.axisColors[axis],
      axis,
    }),
  );
  const heads = directions.map(
    (direction, axis): TriadPart => ({
      shape: head,
      position: direction.clone().multiplyScalar(length - (HEAD_LENGTH * length) / 2),
      quaternion: orientation(direction),
      colour: LOOK.axisColors[axis],
      axis,
    }),
  );
  const ball: TriadPart = {
    shape: { kind: "sphere", radius: BALL_RADIUS * length, height: BALL_RADIUS * length },
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    colour: BALL_COLOUR,
    axis: null,
  };
  return [...shafts, ...heads, ball];
}

// The geometry of one shape. Each call makes its own, so a caller can own and dispose it.
export function shapeGeometry(shape: Shape): THREE.BufferGeometry {
  const { radius, height } = shape;
  switch (shape.kind) {
    case "cylinder":
      return new THREE.CylinderGeometry(radius, radius, height, SIDES, 1);
    case "cone": // with its base cap: from in front it is a point, from behind a flat disc
      return new THREE.ConeGeometry(radius, height, SIDES, 1);
    case "sphere":
      return new THREE.SphereGeometry(radius, BALL_SEGMENTS.width, BALL_SEGMENTS.height);
  }
}

// The part's instance matrix, as instancing.ts writes them (16 numbers, column-major): the unit shape scaled to its
// size and placed. A cylinder's or a cone's first and third columns are its radii and its second is its axis; a
// sphere's first column is its radius.
export function partMatrix(part: TriadPart): number[] {
  const { kind, radius, height } = part.shape;
  const scale = new THREE.Vector3(radius, kind === "sphere" ? radius : height, radius);
  return new THREE.Matrix4().compose(part.position, part.quaternion, scale).toArray();
}

// The corner of the page the triad is drawn in, in CSS px with y up from the bottom: the origin, and the corner's size
// (the origin out CORNER_LENGTHS, within the page).
interface TriadCorner {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export function triadCorner(layout: TriadLayout, width: number, height: number): TriadCorner {
  const [originX, originDownY] = layout.origin;
  const originY = height - originDownY;
  return {
    originX,
    originY,
    width: Math.min(width, originX + CORNER_LENGTHS * layout.length),
    height: Math.min(height, originY + CORNER_LENGTHS * layout.length),
  };
}

// Places the triad camera for an orientation: behind the origin, on the view axis, with the origin at the corner's
// origin pixel and one scene unit a CSS px. Its frustum is the corner. The camera takes the view's orientation, not its
// position, so the arrows never warp with the lens.
export function placeTriadCamera(
  camera: THREE.OrthographicCamera,
  orientation: THREE.Quaternion,
  corner: TriadCorner,
  length: number,
): void {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
  camera.quaternion.copy(orientation);
  camera.position.copy(forward).multiplyScalar(-CAMERA_LENGTHS * length);
  Object.assign(camera, {
    left: -corner.originX,
    right: corner.width - corner.originX,
    bottom: -corner.originY,
    top: corner.height - corner.originY,
    near: NEAR_LENGTHS * length,
    far: FAR_LENGTHS * length,
  });
  camera.updateProjectionMatrix();
}
