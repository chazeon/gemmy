// The exact curves a boundary stretch can lie on, and the fit of a stretch to each (curveRms). Every curve is in CSS px
// (the view's screen space). A candidate comes from the scene: an atom's silhouette, a cylinder's caps and sides, a
// polyhedron's edges, and the section of an atom or bond by a face's plane.
import * as THREE from "three";
import type { Ellipse, View } from "../export/view";
import type { Pt } from "./curves";
import { ellipseFromBasis, ellipseRms } from "./ellipse";

const SEGMENT_MARGIN_PX = 2; // a line candidate covers its segment plus this much at each end
const MIN_SPAN_PX = 1e-6; // a segment shorter than this has no direction, so its length (or squared length) is guarded
const PARALLEL_COS = 1e-6; // a plane whose normal is this nearly perpendicular to a cylinder's axis is parallel to it
export const HALF_AXIS = 0.5; // an instance's axis column runs from its centre half its length each way

// A curve a stretch may lie on: a segment, or an ellipse.
export type Curve = { kind: "line"; a: Pt; b: Pt } | { kind: "ellipse"; e: Ellipse };

type Screen = (p: THREE.Vector3) => Pt;

export function curveRms(curve: Curve, pts: Pt[]): number {
  return curve.kind === "line" ? lineRms(curve.a, curve.b, pts) : ellipseRms(curve.e, pts);
}

// The RMS distance of points to a segment's infinite line, or Infinity when a point projects well outside the segment.
function lineRms(a: Pt, b: Pt, pts: Pt[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_SPAN_PX) return Infinity;
  let sum = 0;
  for (const p of pts) {
    const along = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len;
    if (along < -SEGMENT_MARGIN_PX || along > len + SEGMENT_MARGIN_PX) return Infinity;
    const across = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
    sum += across * across;
  }
  return Math.sqrt(sum / pts.length);
}

// The point of a segment's line nearest to p (projection), used to move a stretch end onto a line.
export function onLine(a: Pt, b: Pt, p: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / Math.max(dx * dx + dy * dy, MIN_SPAN_PX);
  return [a[0] + t * dx, a[1] + t * dy];
}

// A circle or ellipse of a sphere (an atom or a dot): its silhouette, the image of the sphere in the view.
export function sphereCurves(view: View, centre: THREE.Vector3, radius: number): Curve[] {
  const image = view.sphereImage(view.toCam(centre), radius);
  return image ? [{ kind: "ellipse", e: { cx: image.cx, cy: image.cy, rx: image.rx, ry: image.ry, phi: image.phi } }] : [];
}

// A cylinder from its instance matrix (column-major, as instancing.ts writes it): column 0 the x radius, column 1 the
// axis from one end to the other, column 2 the z radius, and the translation the centre. Its two end circles, and the two
// side lines that touch the projected ends on either side.
export function cylinderCurves(matrix: number[], screen: Screen): Curve[] {
  const col = (i: number) => new THREE.Vector3(matrix[4 * i], matrix[4 * i + 1], matrix[4 * i + 2]);
  const centre = new THREE.Vector3(matrix[12], matrix[13], matrix[14]);
  const axis = col(1).multiplyScalar(HALF_AXIS);
  const ends = [centre.clone().sub(axis), centre.clone().add(axis)];
  const caps: Ellipse[] = ends.map((end) => {
    const c = screen(end);
    const a = screen(end.clone().add(col(0)));
    const b = screen(end.clone().add(col(2)));
    return ellipseFromBasis(c, [a[0] - c[0], a[1] - c[1]], [b[0] - c[0], b[1] - c[1]]);
  });
  const pa = screen(ends[0]);
  const pb = screen(ends[1]);
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_SPAN_PX) return caps.map((e) => ({ kind: "ellipse", e }));
  const n: Pt = [-dy / len, dx / len];
  // The support of an ellipse in direction n is sqrt((n.a)^2 + (n.b)^2) for its conjugate vectors: from the frame's radii.
  const support = (e: Ellipse) => Math.hypot(e.rx * Math.cos(e.phi) * n[0] + e.rx * Math.sin(e.phi) * n[1], e.ry * Math.sin(e.phi) * n[0] - e.ry * Math.cos(e.phi) * n[1]);
  const sa = support(caps[0]);
  const sb = support(caps[1]);
  const sides: Curve[] = [1, -1].map((side) => ({
    kind: "line",
    a: [pa[0] + side * n[0] * sa, pa[1] + side * n[1] * sa],
    b: [pb[0] + side * n[0] * sb, pb[1] + side * n[1] * sb],
  }));
  return [...caps.map((e): Curve => ({ kind: "ellipse", e })), ...sides];
}

// The hard edges of a polyhedron, projected: each a segment.
export function edgeCurves(edges: [THREE.Vector3, THREE.Vector3][], screen: Screen): Curve[] {
  return edges.map(([p, q]) => ({ kind: "line", a: screen(p), b: screen(q) }));
}

// The section of a sphere by the plane of a polyhedron face (normal n through point p0): a circle, projected. Null when the
// plane misses the sphere.
export function sectionCurve(centre: THREE.Vector3, radius: number, face: [THREE.Vector3, THREE.Vector3, THREE.Vector3], screen: Screen): Curve | null {
  const [p0, p1, p2] = face;
  const n = new THREE.Triangle(p0, p1, p2).getNormal(new THREE.Vector3());
  const d = n.dot(new THREE.Vector3().subVectors(centre, p0));
  if (Math.abs(d) >= radius) return null;
  const foot = centre.clone().addScaledVector(n, -d);
  const rho = Math.sqrt(radius * radius - d * d);
  const u = new THREE.Vector3().subVectors(p1, p0).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const c = screen(foot);
  const a = screen(foot.clone().addScaledVector(u, rho));
  const b = screen(foot.clone().addScaledVector(v, rho));
  return { kind: "ellipse", e: ellipseFromBasis(c, [a[0] - c[0], a[1] - c[1]], [b[0] - c[0], b[1] - c[1]]) };
}

// The section of a cylinder (instance matrix, as cylinderCurves reads it) by the plane of a face: an ellipse centred where
// the axis meets the plane, with its major semi-axis r / cos(alpha) along the axis's projection into the plane (alpha is the
// angle between the plane's normal and the axis) and its minor one r. Null when the plane is parallel to the axis.
export function cylinderSectionCurve(matrix: number[], face: [THREE.Vector3, THREE.Vector3, THREE.Vector3], screen: Screen): Curve | null {
  const [p0, p1, p2] = face;
  const n = new THREE.Triangle(p0, p1, p2).getNormal(new THREE.Vector3());
  const c = new THREE.Vector3(matrix[12], matrix[13], matrix[14]);
  const axisFull = new THREE.Vector3(matrix[4], matrix[5], matrix[6]);
  const radius = new THREE.Vector3(matrix[0], matrix[1], matrix[2]).length();
  const dir = axisFull.clone().normalize();
  const cosAlpha = Math.abs(n.dot(dir));
  if (cosAlpha < PARALLEL_COS) return null;
  const t = n.dot(new THREE.Vector3().subVectors(p0, c)) / n.dot(dir);
  const centre = c.clone().addScaledVector(dir, t);
  const along = dir.clone().addScaledVector(n, -dir.dot(n)).normalize(); // the axis's projection into the plane
  const across = new THREE.Vector3().crossVectors(n, along).normalize();
  const a = screen(centre.clone().addScaledVector(along, radius / cosAlpha));
  const b = screen(centre.clone().addScaledVector(across, radius));
  const o = screen(centre);
  return { kind: "ellipse", e: ellipseFromBasis(o, [a[0] - o[0], a[1] - o[1]], [b[0] - o[0], b[1] - o[1]]) };
}
