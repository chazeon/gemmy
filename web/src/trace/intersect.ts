// Where two of a stretch's exact curves cross: a line and a line, a line and an ellipse, two ellipses. The line cases
// are closed form (a line is substituted into the ellipse's equation); two ellipses are found by Newton's method on
// their implicit equations, started at the traced junction. A root is returned as the one nearest the hint, and the
// caller decides whether it is close enough to be the junction (stretch.ts). Tangent or parallel curves have none.
import type { Ellipse } from "../export/view";
import type { Curve } from "./candidates";
import { local } from "./ellipse";
import type { Pt } from "./curves";

const MIN_RADIUS_PX = 1e-6; // an ellipse with a radius this short is a segment, not a curve with a root to find
const PARALLEL_SIN = 1e-9; // lines (or ellipse gradients) whose sine is below this are parallel (tangent)
const TANGENT_EPS = 1e-9; // a line with a discriminant this small (relative) touches the ellipse rather than crossing
const NEWTON_STEPS = 30; // Newton converges in a few steps from a traced junction; this bounds a wandering start
const NEWTON_STEP_PX = 1e-10; // a step this short (CSS px) has converged
const RESIDUAL = 1e-9; // the implicit ellipse function at a root (dimensionless: about 1e-9 times the radius)

// The point where two curves cross, nearest to `hint`, or null when they do not cross.
export function intersectCurves(c1: Curve, c2: Curve, hint: Pt): Pt | null {
  if (c1.kind === "line") {
    return c2.kind === "line" ? lineLine(c1.a, c1.b, c2.a, c2.b) : lineEllipse(c1.a, c1.b, c2.e, hint);
  }
  return c2.kind === "line" ? lineEllipse(c2.a, c2.b, c1.e, hint) : ellipseEllipse(c1.e, c2.e, hint);
}

// The crossing of two infinite lines (a1 to b1, a2 to b2), or null when they are parallel.
function lineLine(a1: Pt, b1: Pt, a2: Pt, b2: Pt): Pt | null {
  const d1: Pt = [b1[0] - a1[0], b1[1] - a1[1]];
  const d2: Pt = [b2[0] - a2[0], b2[1] - a2[1]];
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(cross) <= PARALLEL_SIN * Math.hypot(...d1) * Math.hypot(...d2)) return null;
  const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / cross;
  return [a1[0] + t * d1[0], a1[1] + t * d1[1]];
}

// The crossings of an infinite line (a to b) with an ellipse, the one nearest `hint`. The line's points are a + s (b - a)
// in the ellipse's frame, where the ellipse is (u/rx)^2 + (v/ry)^2 = 1: a quadratic in s. A line whose discriminant is
// (nearly) zero touches the ellipse, and is taken as no crossing.
function lineEllipse(a: Pt, b: Pt, e: Ellipse, hint: Pt): Pt | null {
  if (degenerate(e)) return null;
  const [ax, ay] = local(e, a);
  const [bx, by] = local(e, b);
  const dx = bx - ax;
  const dy = by - ay;
  const kx = 1 / (e.rx * e.rx);
  const ky = 1 / (e.ry * e.ry);
  const qa = dx * dx * kx + dy * dy * ky;
  const qb = 2 * (ax * dx * kx + ay * dy * ky);
  const qc = ax * ax * kx + ay * ay * ky - 1;
  if (qa === 0) return null;
  const disc = qb * qb - 4 * qa * qc;
  if (disc <= TANGENT_EPS * (qb * qb + Math.abs(4 * qa * qc))) return null;
  const root = Math.sqrt(disc);
  const points = [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].map(
    (s): Pt => [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])],
  );
  return nearest(points, hint);
}

// The crossing of two ellipses found by Newton's method on their implicit functions, from `hint`. Each step solves the
// two linearised equations. The method stops at a root it has converged to; a singular Jacobian (the ellipses are
// tangent, or the same) or a point that is not on both ellipses is no crossing.
function ellipseEllipse(e1: Ellipse, e2: Ellipse, hint: Pt): Pt | null {
  if (degenerate(e1) || degenerate(e2)) return null;
  let p: Pt = hint;
  for (let step = 0; step < NEWTON_STEPS; step++) {
    const f = implicit(e1, p);
    const g = implicit(e2, p);
    const det = f.gx * g.gy - f.gy * g.gx;
    if (Math.abs(det) <= PARALLEL_SIN * Math.hypot(f.gx, f.gy) * Math.hypot(g.gx, g.gy)) return null;
    const dx = (-f.v * g.gy + g.v * f.gy) / det;
    const dy = (-g.v * f.gx + f.v * g.gx) / det;
    p = [p[0] + dx, p[1] + dy];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    if (Math.hypot(dx, dy) <= NEWTON_STEP_PX) break;
  }
  const f = implicit(e1, p);
  const g = implicit(e2, p);
  return Math.abs(f.v) <= RESIDUAL && Math.abs(g.v) <= RESIDUAL ? p : null;
}

// An ellipse's implicit function at p: v is (u/rx)^2 + (v/ry)^2 - 1 (zero on the ellipse), and (gx, gy) its gradient in
// the screen's coordinates.
function implicit(e: Ellipse, p: Pt): { v: number; gx: number; gy: number } {
  const [u, w] = local(e, p);
  const gu = (2 * u) / (e.rx * e.rx);
  const gw = (2 * w) / (e.ry * e.ry);
  const c = Math.cos(e.phi);
  const s = Math.sin(e.phi);
  return {
    v: (u / e.rx) ** 2 + (w / e.ry) ** 2 - 1,
    gx: gu * c - gw * s,
    gy: gu * s + gw * c,
  };
}

function degenerate(e: Ellipse): boolean {
  return e.rx < MIN_RADIUS_PX || e.ry < MIN_RADIUS_PX;
}

function nearest(points: Pt[], hint: Pt): Pt {
  const dist = (p: Pt) => Math.hypot(p[0] - hint[0], p[1] - hint[1]);
  return points.reduce((best, p) => (dist(p) < dist(best) ? p : best));
}
