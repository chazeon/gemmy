// The bonds, as the SVG export draws them. A solid bond or a line-mode shaft is one tube cut at its atom spheres, with its
// long sides outlined; a dashed bond is dashes along the full line; a dotted bond is dots along it. Each piece sorts
// against the atoms its ends sit on (endDepth). The positions are those of the live view (geom/bonds, geom/dashes).
import { Vector2, Vector3 } from "three";
import { DASH, DOT, EPS } from "../config";
import { clipToSegment, insideSphere, trimToSpheres } from "../geom/bonds";
import { dashSegments, dotCentres } from "../geom/dashes";
import { lerp, type Vec } from "../geom/vector";
import { el, pointList, segment, srgbHex } from "./markup";
import { type Ctx, type DrawnAtom, type Ends, type Shape, DEPTH_NUDGE, colorOf, outlineAttrs, pointOf } from "./shape";
import { vec3 } from "./view";

const MIDPOINT = 0.5; // where a bond between two drawn atoms is split, so each half sorts against its own atom

export function bondShapes(ctx: Ctx, drawn: Map<string, DrawnAtom>): Shape[] {
  const shapes: Shape[] = [];
  for (const bond of ctx.o.data.primitives.bonds ?? []) {
    const a = pointOf(ctx, bond.a_point_id);
    const b = pointOf(ctx, bond.b_point_id);
    const ends: Ends = { a: drawn.get(bond.a_point_id) ?? null, b: drawn.get(bond.b_point_id) ?? null };
    const r = bond.radius;
    const rgb = colorOf(ctx.o, bond.material_id);
    const style = bond.style ?? "solid";
    if (style === "dashed") shapes.push(...dashShapes(ctx, a, b, r, rgb, ends));
    else if (style === "dotted") shapes.push(...dotShapes(ctx, a, b, r, rgb, ends));
    else shapes.push(...solidTubeShapes(ctx, a, b, r, rgb, ends));
  }
  return shapes;
}

// The radius of a drawn atom's sphere, or null when there is no atom (nothing is cut).
const sphereRadius = (atom: DrawnAtom | null): number | null => (atom ? atom.radius : null);

// A solid bond (or a line-mode shaft): one tube cut at both atom surfaces. When both ends sit on drawn atoms it is cut in
// two at the midpoint, so each half sorts against its own atom (see endDepth). A tube on one drawn atom sorts correctly
// as a single piece.
export function solidTubeShapes(ctx: Ctx, a: Vector3, b: Vector3, r: number, rgb: number[], ends: Ends): Shape[] {
  const cut = trimToSpheres(a.toArray(), b.toArray(), r, sphereRadius(ends.a), sphereRadius(ends.b));
  if (!cut) return [];
  const [p, q] = cut;
  if (!ends.a || !ends.b) return [tube(ctx, { from: p, to: q, radius: r, rgb, outlined: true, fromAtom: ends.a, toAtom: ends.b })];
  const mid = lerp(p, q, MIDPOINT);
  return [
    tube(ctx, { from: p, to: mid, radius: r, rgb, outlined: true, fromAtom: ends.a, toAtom: null }),
    tube(ctx, { from: mid, to: q, radius: r, rgb, outlined: true, fromAtom: null, toAtom: ends.b }),
  ];
}

// A dashed bond: the live view's dashes along the full bond, each cut to the visible span. A dash that starts or ends
// inside an atom's sphere starts or ends on its surface, and so sorts against that atom.
function dashShapes(ctx: Ctx, a: Vector3, b: Vector3, r: number, rgb: number[], ends: Ends): Shape[] {
  const cut = trimToSpheres(a.toArray(), b.toArray(), r, sphereRadius(ends.a), sphereRadius(ends.b));
  if (!cut) return [];
  const dash = Math.max(DASH.length * r, DASH.min);
  const shapes: Shape[] = [];
  for (const [p, q] of dashSegments(a.toArray(), b.toArray(), dash, (dash * DASH.gap) / DASH.length)) {
    const piece = clipToSegment(p, q, cut[0], cut[1]);
    if (!piece) continue;
    shapes.push(tube(ctx, {
      from: piece.p,
      to: piece.q,
      radius: r,
      rgb,
      outlined: false,
      fromAtom: piece.cutStart ? ends.a : null,
      toAtom: piece.cutEnd ? ends.b : null,
    }));
  }
  return shapes;
}

// A dotted bond: the live view's dot centres along the full bond. A dot wholly inside either atom is dropped; one that
// only pokes into an atom is kept, and sorts by its own depth.
function dotShapes(ctx: Ctx, a: Vector3, b: Vector3, r: number, rgb: number[], ends: Ends): Shape[] {
  const dotRadius = DOT.radius * r;
  const from = a.toArray();
  const to = b.toArray();
  const hidden = (p: number[]) =>
    insideSphere(p, from, dotRadius, sphereRadius(ends.a)) || insideSphere(p, to, dotRadius, sphereRadius(ends.b));
  const centres = dotCentres(from, to, Math.max(DOT.spacing * r, DOT.spacingMin));
  return centres.filter((p) => !hidden(p)).map((p) => dotShape(ctx, vec3(p), r, rgb));
}

// A round dot (the dotted bonds) of radius DOT.radius bond radii, a screen circle at its own depth.
function dotShape(ctx: Ctx, p: Vector3, r: number, rgb: number[]): Shape {
  const { view } = ctx;
  const c = view.toCam(p);
  const s = view.toScreen(c);
  return { z: view.depth(c), svg: el("circle", { cx: s.x, cy: s.y, r: DOT.radius * r * view.pxPerUnit(c), fill: srgbHex(rgb) }) };
}

// One tube (a bond piece, or a shaft) and how it is drawn. from and to are its end points on the centre line; outlined
// strokes its two long sides; fromAtom and toAtom are the drawn atoms its ends sit on, or null.
interface TubeSpec {
  from: Vec;
  to: Vec;
  radius: number;
  rgb: number[];
  outlined: boolean;
  fromAtom: DrawnAtom | null;
  toAtom: DrawnAtom | null;
}

// A tube: a trapezoid of the tube's width at each end. When outlined, its two long sides are stroked outside the fill.
// The stroke lines come first, so the fill covers their inner halves; the ends are never stroked.
function tube(ctx: Ctx, spec: TubeSpec): Shape {
  const { view } = ctx;
  const cp = view.toCam(vec3(spec.from));
  const cq = view.toCam(vec3(spec.to));
  const quad = trapezoid(view.toScreen(cp), view.toScreen(cq), spec.radius * view.pxPerUnit(cp), spec.radius * view.pxPerUnit(cq));
  const sides = spec.outlined && ctx.o.outlines
    ? el("path", { d: segment(quad[0], quad[1]) + segment(quad[3], quad[2]), fill: "none", ...outlineAttrs(ctx, true), "stroke-linecap": "butt" })
    : "";
  const fill = el("polygon", { points: pointList(quad), fill: srgbHex(spec.rgb) });
  return { z: Math.max(endDepth(ctx, cp, spec.fromAtom), endDepth(ctx, cq, spec.toAtom)), svg: sides + fill };
}

// The sort key of one end of a tube, given the end's camera-space point (the junction). A junction on a drawn atom's
// surface, where the tube leaves the atom toward the viewer, sorts just after that atom, so the tube is painted over it.
// Any other junction sorts by its own depth, kept behind the atom's key: a tube that leaves the atom away from the
// viewer is behind the atom's surface. facing() looks from the junction to the eye, so this holds in perspective too.
function endDepth(ctx: Ctx, junction: Vector3, atom: DrawnAtom | null): number {
  const { view } = ctx;
  if (!atom) return view.depth(junction);
  const outward = junction.clone().sub(view.toCam(atom.centre));
  const towardViewer = outward.lengthSq() > EPS && view.facing(outward.normalize(), junction);
  return towardViewer ? atom.z + DEPTH_NUDGE : Math.min(view.depth(junction), atom.z - DEPTH_NUDGE);
}

// The four corners of a band of half widths ha and hb round the screen segment a-b.
export function trapezoid(a: Vector2, b: Vector2, ha: number, hb: number): Vector2[] {
  const along = b.clone().sub(a);
  const length = along.length() || 1;
  const side = new Vector2(-along.y, along.x).divideScalar(length);
  return [
    a.clone().addScaledVector(side, ha),
    b.clone().addScaledVector(side, hb),
    b.clone().addScaledVector(side, -hb),
    a.clone().addScaledVector(side, -ha),
  ];
}
