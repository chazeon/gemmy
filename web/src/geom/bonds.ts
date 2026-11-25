// Bonds as the SVG export draws them. A bond is a cylinder from one atom centre to the other, and the 3D view hides
// its part inside an atom's sphere with the depth buffer. SVG has no depth buffer, so the export cuts the cylinder at
// the sphere surface instead (trimToSpheres), and clips the dashes to the same cut (clipToSegment). Pure: no THREE, no
// DOM, arrays in and arrays out, so the node tests can run these.
import { EPS } from "../config";
import { lerp, span, vdot, vsub, type Vec } from "./vector";

// Where a cylinder of radius r leaves an atom's sphere of radius R, measured from the atom centre along the cylinder:
// sqrt(R^2 - r^2), which is the distance to the rim where the two surfaces meet. An atom that is not drawn (R null)
// cuts nothing.
export function trimDistance(R: number | null, r: number): number {
  return R === null ? 0 : Math.sqrt(Math.max(R * R - r * r, 0));
}

// The cylinder of radius r from a to b, cut at both atom spheres (Ra at a, Rb at b; null: that atom is not drawn). It
// returns the two cut ends. Null when the two cuts meet (the atoms touch, so the bond is hidden) or a and b coincide.
export function trimToSpheres(a: Vec, b: Vec, r: number, Ra: number | null, Rb: number | null): [Vec, Vec] | null {
  const length = span(a, b);
  if (length <= EPS) return null;
  const fromA = trimDistance(Ra, r);
  const fromB = trimDistance(Rb, r);
  if (fromA + fromB >= length) return null;
  return [lerp(a, b, fromA / length), lerp(a, b, 1 - fromB / length)];
}

// A piece of a bond's centre line (the dashes) cut to the visible segment s-e, which lies on the same line and runs
// the same way. `cutStart` says the piece began before s (so its start now sits on the atom surface), `cutEnd` the same
// at e. Null when nothing of the piece is left, which is the case for a piece wholly inside an atom's sphere.
export interface Clipped { p: number[]; q: number[]; cutStart: boolean; cutEnd: boolean }

export function clipToSegment(p: Vec, q: Vec, s: Vec, e: Vec): Clipped | null {
  const axis = vsub(e, s);
  const axisSq = vdot(axis, axis);
  if (axisSq <= EPS) return null;
  // the position of x along the segment: 0 at s, 1 at e
  const along = (x: Vec) => vdot(vsub(x, s), axis) / axisSq;
  const startFraction = along(p);
  const endFraction = along(q);
  const visibleFrom = Math.max(startFraction, 0);
  const visibleTo = Math.min(endFraction, 1);
  if (visibleTo <= visibleFrom) return null;
  return {
    p: lerp(p, q, (visibleFrom - startFraction) / (endFraction - startFraction)),
    q: lerp(p, q, (visibleTo - startFraction) / (endFraction - startFraction)),
    cutStart: startFraction < 0,
    cutEnd: endFraction > 1,
  };
}

// Whether a ball of radius rad centred at p lies entirely inside the sphere of radius R about c (R null: no sphere).
// Dots of a dotted bond that lie in an atom are dropped this way; a dot that only pokes into the atom is kept.
export function insideSphere(p: Vec, c: Vec, rad: number, R: number | null): boolean {
  return R !== null && span(p, c) + rad <= R;
}
