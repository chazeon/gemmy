// SVG export: the current view as vector text. buildSvg collects the shapes, sorts them back to front and writes the
// document. The shape builders are in this file (arrows, atoms, the cell box), bonds.ts, polyhedra.ts and triad.ts; the
// shared types and lookups are in shape.ts, the camera in view.ts, the markup helpers in markup.ts, the hulls and the
// lit region in hull.ts.
import { MathUtils, Vector2, Vector3 } from "three";
import { ARROW, EPS, LOOK, axisFontFace } from "../config";
import type { AtomPrimitive, Scene } from "../types";
import { type Attrs, el, fmt, linearHex, pointList, shadedBand, srgbHex, textEl, xy } from "./markup";
import { type SphereImage, makeView, vec3 } from "./view";
import { hull2d, litRegion } from "./hull";
import { type Ctx, type DrawnAtom, DEPTH_NUDGE, type Ends, type Shape, type SvgOptions, type Touch, arrowColor, colorOf, outlineAttrs, pointOf } from "./shape";
import { bondShapes, solidTubeShapes, trapezoid } from "./bonds";
import { polyhedronShapes } from "./polyhedra";
import { triadSvg } from "./triad";

// ---- constants. Sizes are SVG user units (CSS pixels) or fractions; each names the Blender value it mirrors, if any.
// Stroke width as a fraction of image height. Every outlined shape is painted with paint-order="stroke" (stroke first,
// fill over it), so only the outer half of this width shows, as in draw.ts: the live outline is a clip-space offset of
// 0.0035*H/2 px outside the silhouette. Blender's looks.py outline_width (0.0022) is a different measure.
const OUTLINE_FRACTION = 0.0035;
const LINE_RADIUS_RATIO = 0.7; // a "line" displacement is a plain shaft of this fraction of the arrow radius (runner.py:373)
const ARROW_HEAD_MIN_RADII = 3; // head at least this many shaft radii long. Blender: geom.py arrow, radius * 3.0
const ARROW_HEAD_MAX_FRACTION = 0.8; // ... and at most this fraction of the arrow. Blender: geom.py, span * 0.8
const ARROW_SHAFT_MIN_FRACTION = 0.2; // the shaft keeps at least this fraction of the arrow. Blender: geom.py, span * 0.2
const PARALLEL_LIMIT = 0.9; // pick another helper axis when the arrow is nearly parallel to z
const RING_STEPS = 24; // facets of an arrow head's round base
const ROUND_TOLERANCE = 0.01; // an atom ellipse within this fraction of a circle is drawn as a circle
const CELL_PIECES = 40; // the cell box edges are cut into about this many pieces across the structure
const CELL_PIECE_MIN = 0.2; // ... and no piece is shorter than this (angstrom)
const BOX_LINE_WIDTH = 1; // px: the cell box lines
// SVG arc flags for the two half-ellipses that make an atom's disc: large-arc 1, sweep 0.
const LARGE_ARC = 1;
const SWEEP = 0;

// Build the SVG of the current view. Primitives are sorted back to front by their nearest point in camera space
// (painter's algorithm), so it is vector output with the right overlaps in nearly every case. Known glitches, accepted:
// an atom that pokes through a polyhedron face is drawn whole in front of it or whole behind it, and coplanar triangles
// of one face show hairline seams (hidden by a thin same-colour stroke).
export function buildSvg(o: SvgOptions): string {
  const ctx = makeContext(o);
  const polyhedra = polyhedronShapes(ctx);
  const atoms = o.show.atoms ? atomShapes(ctx, polyhedra.touch) : { shapes: [], drawn: new Map<string, DrawnAtom>() };
  const shapes = [...bondShapes(ctx, atoms.drawn), ...arrowShapes(ctx, atoms.drawn), ...polyhedra.shapes, ...atoms.shapes];
  if (o.show.box && o.data.cell) shapes.push(...cellBoxShapes(ctx, o.data.cell));
  shapes.sort((p, q) => p.z - q.z); // back to front
  return svgDocument(ctx, [...shapes.map((s) => s.svg), triadSvg(ctx)].join("\n"));
}

function makeContext(o: SvgOptions): Ctx {
  return {
    o,
    view: makeView(o),
    points: new Map(o.data.points.map((p) => [p.id, vec3(p.position)] as const)),
    light: new Vector3(...LOOK.key).normalize(),
    outlineHex: linearHex(LOOK.outline),
    edgeHex: srgbHex(LOOK.outline),
    outlineWidth: OUTLINE_FRACTION * o.height,
  };
}

// ---- arrows and the other shapes of this file

// Arrows (a shaft and a cone head) and the "line" mode, which is a plain thinner shaft cut at its start atom like a bond.
function arrowShapes(ctx: Ctx, drawn: Map<string, DrawnAtom>): Shape[] {
  const { view } = ctx;
  const shapes: Shape[] = [];
  for (const d of ctx.o.data.primitives.displacements ?? []) {
    const p = pointOf(ctx, d.start_point_id);
    const v = vec3(d.vector);
    const [a, b] = d.anchor === "tip" ? [p.clone().sub(v), p] : [p, p.clone().add(v)];
    const radius = ARROW.radius;
    const rgb = arrowColor();
    if ((d.mode ?? "arrow").toLowerCase() !== "arrow") {
      // The start atom is the tip when anchor is "tip", else the tail; the shaft's other end is free.
      const atom = drawn.get(d.start_point_id) ?? null;
      const ends: Ends = d.anchor === "tip" ? { a: null, b: atom } : { a: atom, b: null };
      shapes.push(...solidTubeShapes(ctx, a, b, radius * LINE_RADIUS_RATIO, rgb, ends));
      continue;
    }
    const length = a.distanceTo(b);
    if (length <= EPS) continue;
    const dir = b.clone().sub(a).divideScalar(length);
    const headLength = Math.min(Math.max(length * ARROW.headLengthRatio, radius * ARROW_HEAD_MIN_RADII), length * ARROW_HEAD_MAX_FRACTION);
    const shaftLength = Math.max(length - headLength, length * ARROW_SHAFT_MIN_FRACTION);
    const end = a.clone().addScaledVector(dir, shaftLength);
    shapes.push(cylinder(ctx, a, end, radius, rgb));

    const helper = Math.abs(dir.z) < PARALLEL_LIMIT ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    const s1 = new Vector3().crossVectors(dir, helper).normalize();
    const s2 = new Vector3().crossVectors(dir, s1);
    const headRadius = radius * ARROW.headRadiusRatio;
    const ring = Array.from({ length: RING_STEPS }, (_, i) => {
      const t = (i / RING_STEPS) * 2 * Math.PI;
      return end.clone().addScaledVector(s1, headRadius * Math.cos(t)).addScaledVector(s2, headRadius * Math.sin(t));
    });
    const camPoints = [b, ...ring].map((x) => view.toCam(x));
    const outline = hull2d(camPoints.map((c) => view.toScreen(c)));
    shapes.push({
      z: Math.max(...camPoints.map((c) => view.depth(c))),
      svg: el("polygon", { points: pointList(outline), fill: srgbHex(rgb), ...outlineAttrs(ctx, true) }),
    });
  }
  return shapes;
}

// A cylinder as a projected trapezoid between its two ends, with the radius scaled to each end's depth (arrow shafts).
function cylinder(ctx: Ctx, a: Vector3, b: Vector3, radius: number, rgb: number[]): Shape {
  const { view } = ctx;
  const ca = view.toCam(a);
  const cb = view.toCam(b);
  const quad = trapezoid(view.toScreen(ca), view.toScreen(cb), radius * view.pxPerUnit(ca), radius * view.pxPerUnit(cb));
  return {
    z: Math.max(view.depth(ca), view.depth(cb)),
    svg: el("polygon", { points: pointList(quad), fill: srgbHex(rgb), ...outlineAttrs(ctx, true) }),
  };
}

// The atoms: a lit disc, the dark band (the lit region's complement, carried onto the ellipse), and the outline. Returns
// their shapes, and the drawn ones for the bonds to cut at.
function atomShapes(ctx: Ctx, touch: Touch): { shapes: Shape[]; drawn: Map<string, DrawnAtom> } {
  const lit = litRegion(ctx.light, LOOK.threshold);
  const shapes: Shape[] = [];
  const drawn = new Map<string, DrawnAtom>();
  for (const atom of ctx.o.data.primitives.atoms) {
    const shape = atomShape(ctx, lit, atom, touch);
    if (!shape) continue;
    shapes.push(shape);
    drawn.set(atom.point_id, { centre: pointOf(ctx, atom.point_id), radius: atom.radius, z: shape.z });
  }
  return { shapes, drawn };
}

function atomShape(ctx: Ctx, lit: Vector2[], atom: AtomPrimitive, touch: Touch): Shape | null {
  const { o, view } = ctx;
  const c = view.toCam(pointOf(ctx, atom.point_id));
  const e = view.sphereImage(c, atom.radius);
  if (!e) return null;
  const reach = Math.max(e.rx, e.ry);
  if (e.cx + reach < 0 || e.cx - reach > o.width || e.cy + reach < 0 || e.cy - reach > o.height) return null;

  const rgb = colorOf(o, atom.material_id);
  // the lit region on the unit disc (x right, y up) is carried onto the ellipse by the same stretch
  const center = new Vector2(e.cx, e.cy);
  const radial = new Vector2(Math.cos(e.phi), Math.sin(e.phi));
  const across = new Vector2(-radial.y, radial.x);
  const warp = (p: Vector2) => {
    const s = new Vector2(p.x, -p.y);
    return center.clone().addScaledVector(radial, s.dot(radial) * e.rx).addScaledVector(across, s.dot(across) * e.ry);
  };
  const tip = center.clone().addScaledVector(radial, e.rx);
  const tail = center.clone().addScaledVector(radial, -e.rx);
  const arc = `A${fmt(e.rx)} ${fmt(e.ry)} ${fmt(e.phi * MathUtils.RAD2DEG)} ${LARGE_ARC} ${SWEEP}`;
  const disc = `M${xy(tip)}${arc} ${xy(tail)}${arc} ${xy(tip)}z`;
  const band = `${disc}M${lit.map((p) => xy(warp(p))).join("L")}z`;

  const z = atomDepth(view.depth(c) + atom.radius, atom.point_id, touch);
  const svg = ellipseEl(e, { fill: srgbHex(rgb), ...outlineAttrs(ctx, true) })
    + el("path", { d: band, fill: shadedBand(rgb, LOOK.dark), "fill-rule": "evenodd" });
  return { z, svg };
}

// The sort key of an atom: its own depth, moved just after or just before a polyhedron it sits on (see recordTouch).
function atomDepth(natural: number, id: string, touch: Touch): number {
  if (touch.after.has(id)) return Math.max(natural, touch.after.get(id)! + DEPTH_NUDGE);
  if (touch.before.has(id)) return Math.min(natural, touch.before.get(id)! - DEPTH_NUDGE);
  return natural;
}

// A circle when the two radii are (nearly) equal, else an ellipse turned to its major axis.
function ellipseEl(e: SphereImage, attrs: Attrs): string {
  if (Math.abs(e.rx - e.ry) < ROUND_TOLERANCE * e.rx) return el("circle", { cx: e.cx, cy: e.cy, r: e.rx, ...attrs });
  const deg = e.phi * MathUtils.RAD2DEG;
  return el("ellipse", {
    cx: e.cx,
    cy: e.cy,
    rx: e.rx,
    ry: e.ry,
    transform: `rotate(${fmt(deg)} ${fmt(e.cx)} ${fmt(e.cy)})`,
    ...attrs,
  });
}

// The cell box in short pieces, so polyhedra and atoms can hide parts of it. A cube has 8 corners, numbered n = 0..7
// by their bits (bit k set: the far side along axis k). Each of the 12 edges leaves a corner whose bit for its axis is
// clear, so every edge is drawn once.
function cellBoxShapes(ctx: Ctx, cell: NonNullable<Scene["cell"]>): Shape[] {
  const { o, view } = ctx;
  const origin = vec3(cell.origin);
  const [a, b, c] = cell.vectors.map(vec3);
  const corner = (i: number, j: number, k: number) => origin.clone().addScaledVector(a, i).addScaledVector(b, j).addScaledVector(c, k);
  const piece = Math.max(o.extent / CELL_PIECES, CELL_PIECE_MIN);
  const shapes: Shape[] = [];
  for (let n = 0; n < 8; n++) {
    for (let axis = 0; axis < 3; axis++) {
      if (n & (1 << axis)) continue;
      const bits: [number, number, number] = [n & 1, (n >> 1) & 1, (n >> 2) & 1];
      const start = corner(...bits);
      bits[axis] = 1;
      const end = corner(...bits);
      const count = Math.max(1, Math.ceil(start.distanceTo(end) / piece));
      for (let s = 0; s < count; s++) {
        const p = view.toCam(start.clone().lerp(end, s / count));
        const q = view.toCam(start.clone().lerp(end, (s + 1) / count));
        const from = view.toScreen(p);
        const to = view.toScreen(q);
        shapes.push({
          z: Math.max(view.depth(p), view.depth(q)),
          svg: el("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: o.boxColor, "stroke-width": BOX_LINE_WIDTH }),
        });
      }
    }
  }
  return shapes;
}

// The document: the axis font embedded in a style element, then the body.
function svgDocument(ctx: Ctx, body: string): string {
  const { width: W, height: H } = ctx.o;
  const style = textEl("style", {}, axisFontFace(["700"]));
  const svg = el("svg", { xmlns: "http://www.w3.org/2000/svg", width: W, height: H, viewBox: `0 0 ${W} ${H}` }, `\n${style}\n${body}\n`);
  return `${svg}\n`;
}
