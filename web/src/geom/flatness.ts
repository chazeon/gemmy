// The flatness test of a point cloud: is it a line, a plane or a solid? compile/hull.ts (the polygons of the polyhedra
// stage) and render/instancing.ts (the winding of a polyhedron) both use it. Pure float math on plain arrays, with no
// quickhull3d, so the viewer can import it without the hull. lattice.py shape_of is the Python twin, in the same order
// of operations, so both sides agree bit for bit. The answer does not depend on the order of the points.
import { type Vec, vcross, vdot, vsub } from "./vector";

// A cloud is flat when every point lies within this fraction of its diameter of one line or one plane. Real POSCARs
// carry about 1e-8 relative rounding, so 1e-6 is far above that and far below any real non-planarity. The same value as
// FLAT_TOLERANCE in src/gemmy/compile/lattice.py (tests/test_shared_constants.py checks they match).
export const FLAT_TOLERANCE = 1e-6;

// `normal` is the unit normal (largest component positive), `axis` a unit direction in the plane that fixes the frame of
// the polygon's corners, and `scale` the cloud's diameter.
export type Shape =
  | { kind: "line" }
  | { kind: "space" }
  | { kind: "plane"; normal: number[]; axis: number[]; scale: number };

const LINE: Shape = { kind: "line" };
const SPACE: Shape = { kind: "space" };

// Line, plane or space for a cloud of two or more points, in O(n^2). The scale is the diameter (the farthest pair of
// points). The cloud is a line when every point lies within the tolerance of the diameter's line. Otherwise the plane
// goes through the diameter and the point farthest from its line, and the cloud is flat when every point lies within
// the tolerance of that plane. lattice.py shape_of is the Python twin, in the same order of operations.
export function shapeOf(points: readonly Vec[]): Shape {
  const [near, far] = diameter(points);
  const lineAxis = vsub(far, near);
  const scale = norm(lineAxis);
  if (scale === 0) return LINE;
  const apex = farthestFromLine(points, near, lineAxis, scale);
  if (distanceFromAxis(apex, near, lineAxis, scale) <= FLAT_TOLERANCE * scale) return LINE;
  const normal = vcross(lineAxis, vsub(apex, near));
  const length = norm(normal);
  let offPlane = 0;
  for (const p of points) offPlane = Math.max(offPlane, Math.abs(vdot(vsub(p, near), normal)) / length);
  if (offPlane > FLAT_TOLERANCE * scale) return SPACE;
  return { kind: "plane", normal: planeNormal(normal, length), axis: frameAxis(points), scale };
}

// Math.sqrt of the dot product, not Math.hypot, so the rounding matches Python's math.sqrt (lattice.py _norm).
function norm(a: Vec): number {
  return Math.sqrt(vdot(a, a));
}

// The two points farthest apart (the first such pair in order, on a tie).
function diameter(points: readonly Vec[]): [Vec, Vec] {
  let best: [Vec, Vec] = [points[0], points[1]];
  let bestLength = norm(vsub(points[1], points[0]));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const length = norm(vsub(points[j], points[i]));
      if (length > bestLength) {
        best = [points[i], points[j]];
        bestLength = length;
      }
    }
  }
  return best;
}

// The point farthest from the line through origin along axis (the first such point on a tie).
function farthestFromLine(points: readonly Vec[], origin: Vec, axis: Vec, scale: number): Vec {
  let apex = points[0];
  let apexDistance = distanceFromAxis(apex, origin, axis, scale);
  for (const p of points.slice(1)) {
    const distance = distanceFromAxis(p, origin, axis, scale);
    if (distance > apexDistance) {
      apex = p;
      apexDistance = distance;
    }
  }
  return apex;
}

// The perpendicular distance of p from the line through origin along axis (whose length is scale).
function distanceFromAxis(p: Vec, origin: Vec, axis: Vec, scale: number): number {
  return norm(vcross(vsub(p, origin), axis)) / scale;
}

// The unit direction, in the plane, from points[0] towards the point farthest from it. Only the corners' frame depends
// on it, never whether the cloud is flat.
function frameAxis(points: readonly Vec[]): number[] {
  const origin = points[0];
  let far = origin;
  for (const p of points) {
    if (norm(vsub(p, origin)) > norm(vsub(far, origin))) far = p;
  }
  const offset = vsub(far, origin);
  const length = norm(offset);
  return offset.map((x) => x / length);
}

// The unit normal, flipped if needed so its largest component is positive: one side of the plane, whatever the order.
function planeNormal(normal: number[], length: number): number[] {
  const unit = normal.map((x) => x / length);
  return unit[largestComponent(unit)] < 0 ? unit.map((x) => -x) : unit;
}

// The index of the component with the largest absolute value (the first of equal ones).
function largestComponent(v: Vec): number {
  let largest = 0;
  for (const k of [1, 2]) {
    if (Math.abs(v[k]) > Math.abs(v[largest])) largest = k;
  }
  return largest;
}
