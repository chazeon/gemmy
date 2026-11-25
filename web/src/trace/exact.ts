// The exact curves a boundary stretch can lie on, and the math to match, snap and write them. Every curve is in CSS px
// (the view's screen space). An ellipse is kept as its centre, radii and the angle of its first radius, so the SVG arc
// command and the parameter of a point use the same frame.
import * as THREE from "three";
import type { View } from "../export/view";
import type { Pt } from "./curves";

// ---- constants ----
const SEGMENT_MARGIN_PX = 2; // a line candidate covers its segment plus this much at each end
const MIN_RADIUS_PX = 1e-6; // guards the divisions by a radius that is (nearly) flat

interface Ellipse { cx: number; cy: number; rx: number; ry: number; phi: number }
export type Curve = { kind: "line"; a: Pt; b: Pt } | { kind: "ellipse"; e: Ellipse };

type Screen = (p: THREE.Vector3) => Pt;

// The screen-space ellipse of a circle or ellipse given by its centre and two conjugate vectors a, b (points c + a cos t +
// b sin t). The radii are the singular values of [a b]; phi is the angle of the major axis.
function ellipseFromBasis(c: Pt, a: Pt, b: Pt): Ellipse {
  const p = a[0] * a[0] + b[0] * b[0];
  const q = a[0] * a[1] + b[0] * b[1];
  const s = a[1] * a[1] + b[1] * b[1];
  const mean = (p + s) / 2;
  const spread = Math.sqrt(((p - s) / 2) ** 2 + q * q);
  return { cx: c[0], cy: c[1], rx: Math.sqrt(mean + spread), ry: Math.sqrt(Math.max(mean - spread, 0)), phi: 0.5 * Math.atan2(2 * q, p - s) };
}

// The point of the ellipse at parameter t (the angle in its own frame: the first radius is at t = 0).
export function pointAt(e: Ellipse, t: number): Pt {
  const x = e.rx * Math.cos(t);
  const y = e.ry * Math.sin(t);
  const cos = Math.cos(e.phi);
  const sin = Math.sin(e.phi);
  return [e.cx + x * cos - y * sin, e.cy + x * sin + y * cos];
}

// The parameter of a point, from the ellipse's frame (the angle of the point's coordinates scaled by the radii).
export function paramOf(e: Ellipse, p: Pt): number {
  const [wx, wy] = local(e, p);
  return Math.atan2(wy / Math.max(e.ry, MIN_RADIUS_PX), wx / Math.max(e.rx, MIN_RADIUS_PX));
}

// The point's coordinates in the ellipse's frame, centred and unrotated.
function local(e: Ellipse, p: Pt): Pt {
  const dx = p[0] - e.cx;
  const dy = p[1] - e.cy;
  const cos = Math.cos(e.phi);
  const sin = Math.sin(e.phi);
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

// The RMS distance (CSS px) of points to an ellipse, measured radially: a point at normalised radius r is (r - 1) times the
// mean radius away from the curve.
function ellipseRms(e: Ellipse, pts: Pt[]): number {
  const mean = (e.rx + e.ry) / 2;
  let sum = 0;
  for (const p of pts) {
    const [wx, wy] = local(e, p);
    const r = Math.hypot(wx / Math.max(e.rx, MIN_RADIUS_PX), wy / Math.max(e.ry, MIN_RADIUS_PX));
    sum += ((r - 1) * mean) ** 2;
  }
  return Math.sqrt(sum / pts.length);
}

// The RMS distance of points to a segment's infinite line, or Infinity when a point projects well outside the segment.
function lineRms(a: Pt, b: Pt, pts: Pt[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_RADIUS_PX) return Infinity;
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
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / Math.max(dx * dx + dy * dy, MIN_RADIUS_PX);
  return [a[0] + t * dx, a[1] + t * dy];
}

export function curveRms(curve: Curve, pts: Pt[]): number {
  return curve.kind === "line" ? lineRms(curve.a, curve.b, pts) : ellipseRms(curve.e, pts);
}

// The SVG arcs from `from` to `to` along the ellipse, following the stretch's own points `pts` (from `from` to `to`). The
// signed angle the stretch sweeps is the sum of the steps between consecutive points, each wrapped into (-pi, pi], so a
// short stretch that wraps round the parameter is still short. The arc is written as pieces of at most a quarter turn: a
// piece near a half turn has ambiguous large-arc and sweep flags.
export function arcTo(e: Ellipse, from: Pt, to: Pt, pts: Pt[]): string {
  const t0 = paramOf(e, from);
  let prev = t0;
  let swept = 0;
  for (const p of pts) {
    const t = paramOf(e, p);
    swept += wrapPi(t - prev);
    prev = t;
  }
  const dir = swept >= 0 ? 1 : -1;
  return arcSeries(e, t0, dir, Math.abs(swept), to);
}

// The full ellipse, from `start` round once and back to it.
export function fullEllipseArcs(e: Ellipse, start: Pt): string {
  return arcSeries(e, paramOf(e, start), 1, 2 * Math.PI, start);
}

// Arcs of the ellipse from parameter t0 for `span` in direction `dir` (+1 or -1), ending at `end`.
function arcSeries(e: Ellipse, t0: number, dir: number, span: number, end: Pt): string {
  const pieces = Math.max(1, Math.ceil(span / (Math.PI / 2)));
  const sweep = dir > 0 ? 1 : 0; // the frame is a rotation, so increasing parameter is the positive SVG direction
  let d = "";
  for (let k = 1; k <= pieces; k++) {
    const point = k === pieces ? end : pointAt(e, t0 + (dir * span * k) / pieces);
    d += `A${num(e.rx)} ${num(e.ry)} ${num((e.phi * 180) / Math.PI)} 0 ${sweep} ${num(point[0])} ${num(point[1])}`;
  }
  return d;
}

function wrapPi(t: number): number {
  return t - 2 * Math.PI * Math.round(t / (2 * Math.PI));
}

function num(x: number): string {
  return String(Math.round(x * 100) / 100 || 0);
}

// ---- the candidate curves of one object ----

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
  const axis = col(1).multiplyScalar(0.5);
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
  if (len < MIN_RADIUS_PX) return caps.map((e) => ({ kind: "ellipse", e }));
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
  const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
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
  const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
  const c = new THREE.Vector3(matrix[12], matrix[13], matrix[14]);
  const axisFull = new THREE.Vector3(matrix[4], matrix[5], matrix[6]);
  const radius = new THREE.Vector3(matrix[0], matrix[1], matrix[2]).length();
  const dir = axisFull.clone().normalize();
  const cosAlpha = Math.abs(n.dot(dir));
  if (cosAlpha < MIN_RADIUS_PX) return null;
  const t = n.dot(new THREE.Vector3().subVectors(p0, c)) / n.dot(dir);
  const centre = c.clone().addScaledVector(dir, t);
  const along = dir.clone().addScaledVector(n, -dir.dot(n)).normalize(); // the axis's projection into the plane
  const across = new THREE.Vector3().crossVectors(n, along).normalize();
  const a = screen(centre.clone().addScaledVector(along, radius / cosAlpha));
  const b = screen(centre.clone().addScaledVector(across, radius));
  const o = screen(centre);
  return { kind: "ellipse", e: ellipseFromBasis(o, [a[0] - o[0], a[1] - o[1]], [b[0] - o[0], b[1] - o[1]]) };
}
