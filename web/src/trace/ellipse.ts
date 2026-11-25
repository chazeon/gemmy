// The ellipses the boundary curves are written as: their points and parameters, the fit of a stretch to one
// (ellipseRms), and the SVG arcs that follow one. An ellipse is kept as its centre, radii and the angle of its first
// radius, so the SVG arc command and the parameter of a point use the same frame.
import { MathUtils } from "three";
import type { Ellipse } from "../export/view";
import { fmt, fmtPt } from "../export/markup";
import type { Pt } from "./curves";

// Guards the divisions by a radius that is (nearly) flat.
const MIN_RADIUS_PX = 1e-6;
const QUARTER_TURN = Math.PI / 2; // an arc is written in pieces of at most this many radians

// The SVG arcs from `from` to `to` along the ellipse, following the stretch's own points `pts` (from `from` to `to`).
// The signed angle the stretch sweeps is the sum of the steps between consecutive points, each wrapped into (-pi, pi],
// so a short stretch that wraps round the parameter is still short. The arc is written as pieces of at most a quarter
// turn: a piece near a half turn has ambiguous large-arc and sweep flags.
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
  const pieces = Math.max(1, Math.ceil(span / QUARTER_TURN));
  const sweep = dir > 0 ? 1 : 0; // the frame is a rotation, so increasing parameter is the positive SVG direction
  let d = "";
  for (let k = 1; k <= pieces; k++) {
    const point = k === pieces ? end : pointAt(e, t0 + (dir * span * k) / pieces);
    d += `A${fmt(e.rx)} ${fmt(e.ry)} ${fmt(MathUtils.radToDeg(e.phi))} 0 ${sweep} ${fmtPt(point)}`;
  }
  return d;
}

function wrapPi(t: number): number {
  return t - 2 * Math.PI * Math.round(t / (2 * Math.PI));
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

// The RMS distance (CSS px) of points to an ellipse, measured radially: a point at normalised radius r is (r - 1) times
// the mean radius away from the curve.
export function ellipseRms(e: Ellipse, pts: Pt[]): number {
  const mean = (e.rx + e.ry) / 2;
  let sum = 0;
  for (const p of pts) {
    const [wx, wy] = local(e, p);
    const r = Math.hypot(wx / Math.max(e.rx, MIN_RADIUS_PX), wy / Math.max(e.ry, MIN_RADIUS_PX));
    sum += ((r - 1) * mean) ** 2;
  }
  return Math.sqrt(sum / pts.length);
}

// The screen-space ellipse of a circle or ellipse given by its centre and two conjugate vectors a, b (points c + a cos
// t + b sin t). The radii are the singular values of [a b]; phi is the angle of the major axis.
export function ellipseFromBasis(c: Pt, a: Pt, b: Pt): Ellipse {
  const p = a[0] * a[0] + b[0] * b[0];
  const q = a[0] * a[1] + b[0] * b[1];
  const s = a[1] * a[1] + b[1] * b[1];
  const mean = (p + s) / 2;
  const spread = Math.sqrt(((p - s) / 2) ** 2 + q * q);
  return {
    cx: c[0],
    cy: c[1],
    rx: Math.sqrt(mean + spread),
    ry: Math.sqrt(Math.max(mean - spread, 0)),
    phi: 0.5 * Math.atan2(2 * q, p - s),
  };
}
