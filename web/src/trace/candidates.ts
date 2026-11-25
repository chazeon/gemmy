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
const HALF_AXIS = 0.5; // an instance's axis column runs from its centre half its length each way

// A curve a stretch may lie on: a segment, or an ellipse.
export type Curve = { kind: "line"; a: Pt; b: Pt } | EllipseCurve;
export type EllipseCurve = { kind: "ellipse"; e: Ellipse };

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

// An instance's frame from its matrix (column-major, as instancing.ts writes it): its centre, the half axis (column 1 is
// the full axis, from one end to the other), and the two radius columns, ux (column 0) and uz (column 2).
interface InstanceFrame {
  centre: THREE.Vector3;
  axis: THREE.Vector3;
  ux: THREE.Vector3;
  uz: THREE.Vector3;
}
export function instanceFrame(matrix: number[]): InstanceFrame {
  const col = (i: number) => new THREE.Vector3(matrix[4 * i], matrix[4 * i + 1], matrix[4 * i + 2]);
  return {
    centre: new THREE.Vector3(matrix[12], matrix[13], matrix[14]),
    axis: col(1).multiplyScalar(HALF_AXIS),
    ux: col(0),
    uz: col(2),
  };
}

// The screen basis of a circle: its centre, and the two conjugate offsets (CSS px) that the points centre + u and
// centre + v project to. ellipseFromBasis reads the ellipse off it.
interface ScreenBasis {
  c: Pt;
  ua: Pt;
  ub: Pt;
}
function screenBasis(screen: Screen, centre: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3): ScreenBasis {
  const c = screen(centre);
  const a = screen(centre.clone().add(u));
  const b = screen(centre.clone().add(v));
  return { c, ua: [a[0] - c[0], a[1] - c[1]], ub: [b[0] - c[0], b[1] - c[1]] };
}

// The ellipse that a circle of the offsets u and v around `centre` projects to: a cylinder's end or a cone's base, and
// the section of a sphere or cylinder by a plane.
function capEllipse(screen: Screen, centre: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3): Ellipse {
  const { c, ua, ub } = screenBasis(screen, centre, u, v);
  return ellipseFromBasis(c, ua, ub);
}

// A circle or ellipse of a sphere (an atom or a dot): its silhouette, the image of the sphere in the view.
export function sphereCurves(view: View, centre: THREE.Vector3, radius: number): Curve[] {
  const image = view.sphereImage(view.toCam(centre), radius);
  return image
    ? [{ kind: "ellipse", e: { cx: image.cx, cy: image.cy, rx: image.rx, ry: image.ry, phi: image.phi } }]
    : [];
}

// A cylinder from its instance matrix (column-major, as instancing.ts writes it): column 0 the x radius, column 1 the
// axis from one end to the other, column 2 the z radius, and the translation the centre. Its two end circles, and the
// two side lines that touch the projected ends on either side.
export function cylinderCurves(matrix: number[], screen: Screen): Curve[] {
  const { centre, axis, ux, uz } = instanceFrame(matrix);
  const ends = [centre.clone().sub(axis), centre.clone().add(axis)];
  const caps = ends.map((end) => capEllipse(screen, end, ux, uz));
  const pa = screen(ends[0]);
  const pb = screen(ends[1]);
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_SPAN_PX) return caps.map((e) => ({ kind: "ellipse", e }));
  const n: Pt = [-dy / len, dx / len];
  // The support of an ellipse in direction n is sqrt((n.a)^2 + (n.b)^2) for its conjugate vectors: from the frame's
  // radii.
  const support = (e: Ellipse) =>
    Math.hypot(
      e.rx * Math.cos(e.phi) * n[0] + e.rx * Math.sin(e.phi) * n[1],
      e.ry * Math.sin(e.phi) * n[0] - e.ry * Math.cos(e.phi) * n[1],
    );
  const sa = support(caps[0]);
  const sb = support(caps[1]);
  const sides: Curve[] = [1, -1].map((side) => ({
    kind: "line",
    a: [pa[0] + side * n[0] * sa, pa[1] + side * n[1] * sa],
    b: [pb[0] + side * n[0] * sb, pb[1] + side * n[1] * sb],
  }));
  return [...caps.map((e): Curve => ({ kind: "ellipse", e })), ...sides];
}

// A cone from its instance matrix (as cylinderCurves reads it, the unit cone's apex at +y/2 and its base at -y/2): its
// base ellipse, and the two silhouette lines from the apex to that ellipse, when the apex projects outside it. Seen
// tip-on the apex projects inside the base, and the cone is the base ellipse alone.
export function coneCurves(matrix: number[], screen: Screen): Curve[] {
  const { centre, axis, ux, uz } = instanceFrame(matrix);
  const apex = screen(centre.clone().add(axis));
  const { c, ua, ub } = screenBasis(screen, centre.clone().sub(axis), ux, uz);
  const ellipse: Curve = { kind: "ellipse", e: ellipseFromBasis(c, ua, ub) };
  const touches = tangentPoints(c, ua, ub, apex);
  if (!touches) return [ellipse];
  return [ellipse, ...touches.map((p): Curve => ({ kind: "line", a: apex, b: p }))];
}

// The points where the two tangents from `apex` touch the ellipse c + ua u + ub v (u, v on the unit circle), or null
// when the apex is inside or on it, or the ellipse is flat. On the unit circle the tangent points from q are (q +- s
// perp(q)) / |q|^2 with s = sqrt(|q|^2 - 1); the map back to the ellipse is affine, so tangency is kept.
function tangentPoints(c: Pt, ua: Pt, ub: Pt, apex: Pt): [Pt, Pt] | null {
  const det = ua[0] * ub[1] - ub[0] * ua[1];
  if (Math.abs(det) < MIN_SPAN_PX * MIN_SPAN_PX) return null;
  const w: Pt = [apex[0] - c[0], apex[1] - c[1]];
  const qx = (ub[1] * w[0] - ub[0] * w[1]) / det; // the apex in the circle's frame: the inverse of [ua ub] applied to w
  const qy = (-ua[1] * w[0] + ua[0] * w[1]) / det;
  const d2 = qx * qx + qy * qy;
  if (d2 <= 1) return null;
  const s = Math.sqrt(d2 - 1);
  const onEllipse = (sign: number): Pt => {
    const u = (qx - sign * s * qy) / d2;
    const v = (qy + sign * s * qx) / d2;
    return [c[0] + ua[0] * u + ub[0] * v, c[1] + ua[1] * u + ub[1] * v];
  };
  return [onEllipse(1), onEllipse(-1)];
}

// The hard edges of a polyhedron, projected: each a segment.
export function edgeCurves(edges: [THREE.Vector3, THREE.Vector3][], screen: Screen): Curve[] {
  return edges.map(([p, q]) => ({ kind: "line", a: screen(p), b: screen(q) }));
}

// The section of a sphere by the plane of a polyhedron face (normal n through point p0): a circle, projected. Null when
// the plane misses the sphere.
export function sectionCurve(
  centre: THREE.Vector3,
  radius: number,
  face: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  screen: Screen,
): Curve | null {
  const [p0, p1, p2] = face;
  const n = new THREE.Triangle(p0, p1, p2).getNormal(new THREE.Vector3());
  const d = n.dot(new THREE.Vector3().subVectors(centre, p0));
  if (Math.abs(d) >= radius) return null;
  const foot = centre.clone().addScaledVector(n, -d);
  const rho = Math.sqrt(radius * radius - d * d);
  const u = new THREE.Vector3().subVectors(p1, p0).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { kind: "ellipse", e: capEllipse(screen, foot, u.clone().multiplyScalar(rho), v.clone().multiplyScalar(rho)) };
}

// The section of a cylinder (instance matrix, as cylinderCurves reads it) by the plane of a face: an ellipse centred
// where the axis meets the plane, with its major semi-axis r / cos(alpha) along the axis's projection into the plane
// (alpha is the angle between the plane's normal and the axis) and its minor one r. Null when the plane is parallel to
// the axis.
export function cylinderSectionCurve(
  matrix: number[],
  face: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  screen: Screen,
): Curve | null {
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
  return {
    kind: "ellipse",
    e: capEllipse(
      screen,
      centre,
      along.clone().multiplyScalar(radius / cosAlpha),
      across.clone().multiplyScalar(radius),
    ),
  };
}
