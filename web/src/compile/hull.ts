// Convex hull faces (compile/lattice.py convex_hull_faces). A solid cloud goes through quickhull3d and is wound outwards
// by the same test as Python. A flat cloud (ligands in one plane, or on a line) is handled here, in pure float math in
// the same order as Python, so the triangles are identical: a plane gives the fan of its polygon, a line gives none.
import qh from "quickhull3d";
import { FLAT_TOLERANCE, type Shape, shapeOf } from "../geom/flatness";
import { meanOf, vcross, vdot, vsub } from "../geom/vector";
import type { Vec3 } from "../types";

export type Triangle = [number, number, number];

// The fewest corners of a polygon: fewer points have no face. The same value as MIN_POLYGON_CORNERS in lattice.py.
export const MIN_POLYGON_CORNERS = 3;

// Triangles of the convex hull, wound outwards. Empty for fewer than 3 points and for points on a line (the caller
// warns). For points in one plane, the triangles of their polygon, wound along the plane normal.
export function convexHullFaces(points: Vec3[]): Triangle[] {
  if (points.length < MIN_POLYGON_CORNERS) return [];
  const shape = shapeOf(points);
  if (shape.kind === "line") return [];
  if (shape.kind === "plane") return planarFaces(points, shape);
  return solidHullFaces(points);
}

// Is the cloud a polygon: three or more points in one plane, not on a line. The polyhedra stage draws such a hull from
// both sides (compile/polyhedra.py).
export function isPlanar(points: Vec3[]): boolean {
  return points.length >= MIN_POLYGON_CORNERS && shapeOf(points).kind === "plane";
}

// A solid cloud's hull from quickhull3d, each triangle wound so its normal points away from the centroid. The points go
// to quickhull3d as they are, without a copy: it only reads them (a Vec3 is one of the point types it accepts).
function solidHullFaces(points: Vec3[]): Triangle[] {
  const centroid = meanOf(points);
  return qh(points).map(([i, j, k]): Triangle => {
    const a = points[i];
    const b = points[j];
    const c = points[k];
    const normal = vcross(vsub(b, a), vsub(c, a));
    const faceCentre = meanOf([a, b, c]);
    return vdot(normal, vsub(faceCentre, centroid)) < 0 ? [i, k, j] : [i, j, k];
  });
}

// A point of the cloud in the plane's frame: its coordinate along the axis (x), across it (y), and its index.
interface Row {
  x: number;
  y: number;
  index: number;
}

type PlaneShape = Extract<Shape, { kind: "plane" }>;

// Twice the signed area of the triangle o, a, b: positive when the turn a to b is counter-clockwise.
function cross2(o: Row, a: Row, b: Row): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Twice-area below which three points count as collinear: the tolerance on the scale squared.
function zeroAreaLimit(scale: number): number {
  return FLAT_TOLERANCE * scale * scale;
}

// One monotone chain: the rows whose turns all go one way. The lower chain takes the rows sorted by x, the upper chain
// the same rows reversed. A turn that is not clearly counter-clockwise (near-collinear points) drops its middle row, so
// such points are not corners.
function halfHull(rows: Row[], scale: number): Row[] {
  const chain: Row[] = [];
  for (const row of rows) {
    while (chain.length >= 2 && cross2(chain[chain.length - 2], chain[chain.length - 1], row) <= zeroAreaLimit(scale)) {
      chain.pop();
    }
    chain.push(row);
  }
  return chain;
}

// Rows at the same place keep one: the first in the sort, which has the lowest index.
function withoutRepeats(rows: Row[]): Row[] {
  return rows.filter((row, n) => n === 0 || row.x !== rows[n - 1].x || row.y !== rows[n - 1].y);
}

// Fan triangles from the first corner. A triangle of zero area (within the tolerance) is never emitted.
function fanTriangles(corners: Row[], scale: number): Triangle[] {
  const fan = Array.from({ length: corners.length - 2 }, (_, m): [Row, Row, Row] => [
    corners[0],
    corners[m + 1],
    corners[m + 2],
  ]);
  return fan
    .filter(([a, b, c]) => Math.abs(cross2(a, b, c)) > zeroAreaLimit(scale))
    .map(([a, b, c]): Triangle => [a.index, b.index, c.index]);
}

// Fan triangles of the convex polygon of the points in their plane (lattice.py _planar_faces): a monotone chain on the
// rows, counter-clockwise seen from the normal, fanned from the lowest corner.
function planarFaces(points: Vec3[], shape: PlaneShape): Triangle[] {
  const across = vcross(shape.normal, shape.axis);
  const origin = points[0];
  const rows = points.map((p, index): Row => {
    const offset = vsub(p, origin);
    return { x: vdot(offset, shape.axis), y: vdot(offset, across), index };
  });
  rows.sort((a, b) => a.x - b.x || a.y - b.y || a.index - b.index);
  const distinct = withoutRepeats(rows);
  const lower = halfHull(distinct, shape.scale);
  const upper = halfHull([...distinct].reverse(), shape.scale);
  const corners = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (corners.length < MIN_POLYGON_CORNERS) return [];
  return fanTriangles(corners, shape.scale);
}
