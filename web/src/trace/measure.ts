// Distances and areas on the screen: the face of a polyhedron nearest a point, and the area and perimeter of a ring.
import * as THREE from "three";
import { polygonArea, polygonLength } from "d3-polygon";
import type { Pt } from "./curves";

// The face of a polyhedron nearest to a screen point (its projected triangle, distance 0 when the point is inside).
export function nearestFace(
  faces: THREE.Vector3[][],
  p: Pt,
  screen: (q: THREE.Vector3) => Pt,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  let best: [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null = null;
  let bestDist = Infinity;
  for (const f of faces) {
    const d = triangleDistance(p, screen(f[0]), screen(f[1]), screen(f[2]));
    if (d < bestDist) {
      bestDist = d;
      best = [f[0], f[1], f[2]];
    }
  }
  return best;
}

function triangleDistance(p: Pt, a: Pt, b: Pt, c: Pt): number {
  const sign = (u: Pt, v: Pt, w: Pt) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const s1 = sign(a, b, p);
  const s2 = sign(b, c, p);
  const s3 = sign(c, a, p);
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0;
  return Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c), segmentDistance(p, c, a));
}

// The distance from p to the segment a-b. A segment with no length is a point, so the distance is to a.
function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const point = new THREE.Vector3(p[0], p[1], 0);
  const segment = new THREE.Line3(new THREE.Vector3(a[0], a[1], 0), new THREE.Vector3(b[0], b[1], 0));
  const nearest =
    segment.distance() > 0 ? segment.closestPointToPoint(point, true, new THREE.Vector3()) : segment.start;
  return nearest.distanceTo(point);
}

// Area of a ring in CSS px^2 (the ring is in render px).
export function ringArea(ring: Pt[], scale: number): number {
  return Math.abs(polygonArea(ring)) / (scale * scale);
}

// Perimeter of a ring in CSS px.
export function ringPerimeter(ring: Pt[], scale: number): number {
  return polygonLength(ring) / scale;
}
