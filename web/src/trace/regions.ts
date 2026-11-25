// The tracing of one group of objects, shared by the structure's export (traced.ts) and the triad's (triad-trace.ts).
// Each object's visible region is read from the passes, and its boundary is written as the exact curve it lies on where
// one matches (stretch.ts), else as a fitted Bézier. The fill is seam-trapped, the toon band is traced without
// snapping, and the outline is the boundary where the outside is background or lies behind the object (classified per
// stretch).
import type * as THREE from "three";
import { LOOK } from "../config";
import { shadedBand, srgbHex } from "../export/markup";
import { type Attrs, svgEl } from "../export/svg-dom";
import { type Ellipse, type View, vec3 } from "../export/view";
import { OUTLINE_SIZE_FRACTION } from "../render/draw";
import { type Curve, type EllipseCurve, coneCurves, cylinderCurves, instanceFrame, sphereCurves } from "./candidates";
import { type ObjectStats, type Passes, boxOf, darkKey, idOf, keyAtCentre } from "./buffers";
import { type Box, regionRings } from "./field";
import { pointAt } from "./ellipse";
import { type LinePass, onScreen } from "./edges";
import { ringArea, ringPerimeter } from "./measure";
import { type Pt, closedPath, segmentsPath } from "./curves";
import type { Project } from "./passes";
import type { InstanceObject, TracedObject } from "./objects";
import { type Stretch, ringPaths, stretchesOf } from "./stretch";

// The seam trap: each fill is stroked in its own colour, this many output px outward, so the hairline seams between
// neighbouring regions close.
const SEAM_TRAP_PX = 0.5;
// A centred stroke's width is twice its outward reach: the seam trap's stroke is SEAM_TRAP_PX out on each side.
const SEAM_STROKE_WIDTH = 2 * SEAM_TRAP_PX;
// A tiny atom's silhouette is a path through this many points on its ellipse.
const SILHOUETTE_SAMPLES = 48;
// Denoising sizes, in CSS px (and px^2 for areas): a region or a band piece under these is dropped or merged.
const MIN_REGION_PX = 4;
const MIN_STRIP_PX = 1;
const MIN_SILHOUETTE_PX = 1;
// The perimeter floor of a band ring, so the strip width of a ring with no perimeter stays finite.
const MIN_PERIMETER_PX = 1e-9;

// The document parts a group adds: its clip paths, its fills (each object's fill, band and edges), and its outlines.
// The path count is kept here, so counted() is the one place it moves.
export class Layers {
  readonly clips: SVGElement[] = [];
  readonly fills: SVGElement[] = [];
  readonly outlines: SVGElement[] = [];
  paths = 0;

  counted<T extends SVGElement>(node: T): T {
    this.paths++;
    return node;
  }
}

// How an object looks: its sRGB fill colour, and the opacity it is drawn at (1 unless it is faded by opacity).
interface Paint {
  rgb: (obj: TracedObject) => number[];
  opacity: (obj: TracedObject) => number;
}

// The live view's outline shell, as the SVG draws it: its colour, the full width of the outline in output px (before
// the user's scale), and whether the shell is capped to the shape's on-screen radius (the instanced meshes of the live
// view are; the triad's plain meshes are not).
export interface Outlines {
  on: boolean;
  hex: string;
  width: number;
  scale: number;
  capped: boolean;
}

// One group of objects with the passes that show it. Object i of `objects` has id i + 1.
export interface Group {
  scale: number; // render px per CSS px
  objects: TracedObject[];
  passes: Passes;
  stats: ObjectStats;
  view: View; // the screen mapping of the objects (their curves and radii)
  project: Project;
  linePass: LinePass;
  curves: CurveLookup;
  paint: Paint;
  outlines: Outlines;
  thin: (obj: TracedObject) => boolean; // drawn as a line, not traced as a region
  edgeLine: (id: number) => SVGElement | null; // the object's own lines (a polyhedron's hard edges), if it has any
  clipPrefix: string; // the start of the clip path ids, unique to the group
}

// The curves an outline or a fill may lie on, by object (see candidatesFor).
export interface CurveLookup {
  own: (id: number) => Curve[];
  candidatesFor: (id: number, st: Stretch) => Curve[];
}

// The lookup of a group's curves: each object's own curves, and the crossings with the object on the outside of a
// stretch. `crossing` gives the curves where a stretch's object meets the outside object at the stretch's midpoint.
export function curveLookup(
  own: (id: number) => Curve[],
  crossing: (id: number, label: number, mid: Pt) => Curve[],
): CurveLookup {
  const ownOf = memo(own);
  const candidatesFor = (id: number, st: Stretch): Curve[] => {
    if (st.label <= 0) return ownOf(id);
    const mid = st.pts[Math.floor(st.pts.length / 2)];
    return [...ownOf(id), ...ownOf(st.label), ...crossing(id, st.label, mid)];
  };
  return { own: ownOf, candidatesFor };
}

// The exact curves of an object of its own: an atom's or dot's silhouette, a bond's or cone's ends and sides.
export function ownCurves(obj: TracedObject, view: View): Curve[] {
  switch (obj.kind) {
    case "sphere":
    case "dot":
      return sphereCurves(view, vec3(obj.centre), obj.matrix[0]);
    case "cylinder":
      return cylinderCurves(obj.matrix, screenOf(view));
    case "cone":
      return coneCurves(obj.matrix, screenOf(view));
    case "polyhedron":
      return [];
  }
}

// Traces every object of the group, back to front, into one Layers.
export function traceRegions(g: Group): Layers {
  const layers = new Layers();
  for (const { id, obj } of drawOrder(g)) {
    if (obj.kind !== "polyhedron" && g.thin(obj)) traceThin(g, layers, id, obj);
    else traceObject(g, layers, id, obj);
  }
  return layers;
}

// Back to front by each object's nearest visible depth (the smallest NDC depth in its region, the depth at which it is
// seen): a farther object is painted first, so a nearer object's own edge covers the overlap next to it. Depth is read
// from the same buffer as the regions, so the order agrees with what is visible. Objects with no pixels sort last and
// are skipped.
function drawOrder(g: Group): { id: number; obj: TracedObject }[] {
  return g.objects
    .map((obj, i) => ({
      id: i + 1,
      nearestDepth: g.thin(obj) ? g.project(vec3(obj.centre)).depth : g.stats.nearest[i + 1],
      obj,
    }))
    .sort((p, q) => q.nearestDepth - p.nearestDepth);
}

// One object's paths: its fill (with the seam trap), its dark band, its own lines, and its outline. A faded object's
// parts are grouped at its opacity.
function traceObject(g: Group, layers: Layers, id: number, obj: TracedObject): void {
  const box = boxOf(g.stats.boxes, id);
  if (box.x1 < box.x0) return;
  const rgb = g.paint.rgb(obj);
  const lit = srgbHex(rgb);
  const dark = shadedBand(rgb, LOOK.dark);
  const common: Attrs = { "fill-rule": "evenodd", ...(obj.alpha < 1 ? { "fill-opacity": obj.alpha } : {}) };
  const region = regionFill(g, id, obj, box);
  const body: SVGElement[] = [];
  if (region.fill) {
    body.push(layers.counted(seamTrapped(region.fill, lit, common)));
    // The region's own (snapped) outline clips its dark band, so growing the band cannot reach past the rim.
    const clipPath = svgEl("path", { d: region.fill, "clip-rule": "evenodd" });
    layers.clips.push(svgEl("clipPath", { id: clipId(g, id) }, [clipPath]));
  }
  const band = darkBandPath(g, id, box);
  if (band)
    body.push(
      layers.counted(
        seamTrapped(band, dark, { ...common, "clip-path": region.fill ? `url(#${clipId(g, id)})` : undefined }),
      ),
    );
  const edge = g.edgeLine(id);
  if (edge) body.push(layers.counted(edge));
  const opacity = g.paint.opacity(obj);
  layers.fills.push(svgEl("g", opacity < 1 ? { opacity } : {}, body));
  if (g.outlines.on && obj.outlined && region.outline) {
    const outline = layers.counted(outlineMarkup(g, obj, region.outline));
    layers.outlines.push(opacity < 1 ? svgEl("g", { opacity }, [outline]) : outline);
  }
}

function clipId(g: Group, id: number): string {
  return `${g.clipPrefix}${id}`;
}

// The region's boundary as path data: its fill (every ring) and its outlined pieces. Denoising (no region or outline
// shorter than a few pixels): a tiny object is its silhouette (tinySilhouette), and tiny rings of a larger region are
// dropped.
function regionFill(g: Group, id: number, obj: TracedObject, box: Box): { fill: string; outline: string } {
  const { passes, stats, scale } = g;
  const regionPx = stats.pixels[id] / (scale * scale);
  if (regionPx < MIN_REGION_PX) return { fill: tinySilhouette(g, id, obj, regionPx), outline: "" };
  let fill = "";
  let outline = "";
  const rings = regionRings(passes, box, (k) => idOf(k) === id).filter(
    (ring) => ringArea(ring, scale) >= MIN_REGION_PX,
  );
  for (const ring of rings) {
    const { stretches, whole } = stretchesOf(ring, id, passes, scale);
    const parts = ringPaths(stretches, whole, (st) => g.curves.candidatesFor(id, st), g.scale);
    fill += parts.fill;
    outline += parts.outline;
  }
  return { fill, outline };
}

// A tiny object's fill: its exact silhouette, when it is the object at its centre and covers at least MIN_SILHOUETTE_PX.
// Otherwise nothing: a tiny fragment is dropped (the seam trap covers it).
function tinySilhouette(g: Group, id: number, obj: TracedObject, regionPx: number): string {
  const exact = g.curves.own(id).find((c): c is EllipseCurve => c.kind === "ellipse");
  const centre = g.project(vec3(obj.centre));
  if (!exact || keyAtCentre(g.passes, centre) !== id || regionPx < MIN_SILHOUETTE_PX) return "";
  return closedPath(silhouettePoints(exact.e));
}

// The dark band: the toon's shaded pixels of the object. It keeps the fitted Bézier (its boundary is an ellipse arc
// inside the atom, not snapped here).
function darkBandPath(g: Group, id: number, box: Box): string {
  const { passes, scale } = g;
  const rings = regionRings(passes, box, (k) => k === darkKey(id)).filter(
    (ring) =>
      ringArea(ring, scale) >= MIN_REGION_PX &&
      ringArea(ring, scale) / Math.max(ringPerimeter(ring, scale), MIN_PERIMETER_PX) >= MIN_STRIP_PX,
  );
  return rings.map((ring) => closedPath(toCss(ring, scale))).join("");
}

function toCss(ring: Pt[], scale: number): Pt[] {
  return ring.map(([x, y]): Pt => [x / scale, y / scale]);
}

// The live view's outline stroke: it thins with the shape's on-screen radius, so a sub-pixel shape gets none, as in the
// live view. A centred stroke is twice its outward reach, and the cap is a share of the radius.
function outlineMarkup(g: Group, obj: TracedObject, d: string): SVGElement {
  const r = g.outlines.capped ? radiusPx(g.view, obj) : null;
  const width = r === null ? g.outlines.width / 2 : Math.min(g.outlines.width / 2, 2 * OUTLINE_SIZE_FRACTION * r);
  const strokeWidth = g.outlines.scale * width; // the live shell multiplies its width by the same scale
  return svgEl("path", {
    d,
    fill: "none",
    stroke: g.outlines.hex,
    "stroke-width": strokeWidth,
    "stroke-linejoin": "round",
  });
}

// A fill, stroked in its own colour SEAM_TRAP_PX outward, so the seams between neighbouring regions close.
function seamTrapped(d: string, colour: string, extra: Attrs): SVGElement {
  return svgEl("path", {
    d,
    fill: colour,
    stroke: colour,
    "stroke-width": SEAM_STROKE_WIDTH,
    "stroke-linejoin": "round",
    ...extra,
  });
}

// A thin shape is drawn as a line or a circle, not as a region.
function traceThin(g: Group, layers: Layers, id: number, obj: InstanceObject): void {
  const lit = srgbHex(g.paint.rgb(obj));
  const radius = radiusPx(g.view, obj) ?? 0;
  const thin =
    obj.kind === "dot" ? dotMarkup(obj, lit, id, g.linePass, radius) : barMarkup(obj, lit, id, g.linePass, radius);
  if (!thin) return;
  const opacity = g.paint.opacity(obj);
  layers.fills.push(layers.counted(opacity < 1 ? svgEl("g", { opacity }, [thin]) : thin));
}

// A bond or dot as a line: a bond is its axis as a stroke of its projected diameter, with round caps; a dot is a small
// circle. Both keep only the parts the line pass shows with their id (three.js decided the visibility).
function dotMarkup(obj: InstanceObject, lit: string, id: number, lines: LinePass, radius: number): SVGElement | null {
  const p = lines.project(vec3(obj.centre));
  if (!onScreen(p)) return null; // behind the camera or not finite: nothing to draw
  if (!lines.shows(id, Math.floor(p.x), Math.floor(p.y))) return null;
  return svgEl("circle", { cx: p.x / lines.scale, cy: p.y / lines.scale, r: radius, fill: lit });
}

function barMarkup(obj: InstanceObject, lit: string, id: number, lines: LinePass, radius: number): SVGElement | null {
  const c = vec3(obj.centre);
  const { axis } = instanceFrame(obj.matrix);
  const d = segmentsPath(lines.spansOf(c.clone().sub(axis), c.clone().add(axis), id));
  return d
    ? svgEl("path", { d, fill: "none", stroke: lit, "stroke-width": 2 * radius, "stroke-linecap": "round" })
    : null;
}

// The silhouette of a tiny atom: points round its ellipse.
function silhouettePoints(e: Ellipse): Pt[] {
  return Array.from({ length: SILHOUETTE_SAMPLES }, (_, i) => pointAt(e, (2 * Math.PI * i) / SILHOUETTE_SAMPLES));
}

// The on-screen radius of an atom, bond or dot in output px (for the outline width and the thin-shape test).
export function radiusPx(view: View, obj: TracedObject): number | null {
  if (obj.kind === "polyhedron") return null;
  const m = obj.matrix;
  let unit: number | null = null;
  if (obj.kind === "cylinder") unit = Math.hypot(m[0], m[1], m[2]);
  else if (obj.kind === "sphere" || obj.kind === "dot") unit = m[0];
  return unit === null ? null : unit * view.pxPerUnit(view.toCam(vec3(obj.centre)));
}

// A scene point's screen position in CSS px (the view's space, where the curves are written).
export function screenOf(view: View): (p: THREE.Vector3) => Pt {
  return (p) => {
    const s = view.toScreen(view.toCam(p));
    return [s.x, s.y];
  };
}

// A function's results, computed once per key.
export function memo<K, V>(compute: (key: K) => V): (key: K) => V {
  const cache = new Map<K, V>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, compute(key));
    return cache.get(key)!;
  };
}
