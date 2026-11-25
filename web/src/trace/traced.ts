// The traced SVG. The id, band and depth renders decide which part of each object shows. Each boundary of a visible region
// is then written as the exact curve it lies on where one matches (stretch.ts): an atom's silhouette, a polyhedron's edges,
// a bond's sides and end ellipses, and the crossing of an atom or bond with a face (the section of the sphere or cylinder by
// the face's plane). Only a stretch that matches none of them is a fitted Bézier (curves.ts). The outlines are the
// boundaries where the outside is background or lies behind the object (classified per stretch, not by a depth threshold).
// The toon band is traced from the band pass without snapping, and the polyhedron edges and the cell box are lines that the
// line pass shows (edges.ts).
import * as THREE from "three";
import { polygonArea, polygonLength } from "d3-polygon";
import { LOOK, axisFontFace } from "../config";
import { type Attrs, el, linearHex, shadedBand, srgbHex, textEl } from "../export/markup";
import { type SvgOptions, arrowColor, colorOf } from "../export/shape";
import { triadSvg } from "../export/triad";
import { type Ellipse, type View, makeView, vec3 } from "../export/view";
import type { Topology, Vec3 } from "../types";
import { type Pt, closedPath, segmentsPath } from "./curves";
import { type Curve, HALF_AXIS, cylinderCurves, cylinderSectionCurve, edgeCurves, sectionCurve, sphereCurves } from "./candidates";
import { type ObjectStats, type Passes, boxOf, darkKey, idOf, keyAtCentre, objectBoxes } from "./buffers";
import { pointAt } from "./ellipse";
import { nearestFace, ringArea, ringPerimeter } from "./measure";
import { LinePass, cellEdges, hardEdges, onScreen } from "./edges";
import { type Box, regionRings } from "./field";
import { type IdMeshes, type InstanceObject, type MeshRole, type PolyhedronObject, type TracedObject, buildIdMeshes, roleOf } from "./objects";
import { type Drawable, type Project, disposeMeshes, passMaterial, projector, renderPasses } from "./passes";
import { OUTLINE_SIZE_FRACTION, OUTLINE_THICKNESS } from "../render/draw";
import { snapTolerance, ringPaths, stretchesOf, type Stretch } from "./stretch";

// The render scale: the id, band and depth passes are this many times the stage in each direction.
const TRACE_SCALE = 2;
// The seam trap: each fill is stroked in its own colour, this many output px outward, so the hairline seams between
// neighbouring regions close.
const SEAM_TRAP_PX = 0.5;
// A centred stroke's width is twice its outward reach: the seam trap's stroke is SEAM_TRAP_PX out on each side.
const SEAM_STROKE_WIDTH = 2 * SEAM_TRAP_PX;
// A bond, dash or dot whose projected diameter is under this many output px is drawn as a stroked line (or a small circle),
// not traced as a region: a region that thin breaks into blobs and its outline doubles it.
const THIN_AS_LINE_PX = 3;
// Polyhedron edge and cell box line widths, in CSS px.
const EDGE_WIDTH = 1;
const BOX_LINE_WIDTH = 1;
// A tiny atom's silhouette is a path through this many points on its ellipse.
const SILHOUETTE_SAMPLES = 48;
// Denoising sizes, in CSS px (and px^2 for areas): a region or a band piece under these is dropped or merged.
const MIN_REGION_PX = 4;
const MIN_STRIP_PX = 1;
const MIN_SILHOUETTE_PX = 1;
// The perimeter floor of a band ring, so the strip width of a ring with no perimeter stays finite.
const MIN_PERIMETER_PX = 1e-9;

interface TracedResult {
  text: string; // the SVG document
  paths: number; // the path elements in it
  ms: number; // the time the export took
}

// The scene as the export reads it: the meshes that carry the ids, the object table, the polyhedron edge spans and the cell
// box, and the line sets the line pass draws. The polyhedron edges and the cell box are lines with ids after the objects
// (one per edge, then the box), so the line pass can say which line is nearest at each pixel (edges.ts).
interface Prepared {
  built: IdMeshes;
  points: Map<string, Vec3>;
  topologies: Map<string, Topology>;
  edgeSpans: EdgeSpan[];
  boxEdges: [THREE.Vector3, THREE.Vector3][];
  boxId: number;
  lines: THREE.LineSegments[];
}

interface EdgeSpan {
  owner: number; // the object id of the polyhedron
  a: THREE.Vector3;
  b: THREE.Vector3;
  id: number;
}

// Everything a single object's trace reads.
interface Frame {
  options: SvgOptions;
  view: View;
  prepared: Prepared;
  passes: Passes;
  stats: ObjectStats;
  project: Project;
  linePass: LinePass;
  curves: CurveLookup;
  tol: number;
  edgeHex: string;
  outlineHex: string;
  outlineWidth: number;
}

// The document's parts in paint order, and the path elements among them. counted() is the one place the count moves.
class Layers {
  readonly clips: string[] = [];
  readonly fills: string[] = [];
  readonly outlines: string[] = [];
  paths = 0;

  counted(markup: string): string {
    this.paths++;
    return markup;
  }
}

// The curves an outline or a fill may lie on, by object (see candidatesFor).
interface CurveLookup {
  own: (id: number) => Curve[];
  candidatesFor: (id: number, st: Stretch) => Curve[];
}

export function buildTracedSvg(options: SvgOptions): TracedResult {
  const started = performance.now();
  const view = makeView(options);
  const prepared = prepareScene(options, view);
  try {
    const shown = (mesh: THREE.Mesh) => options.show.atoms || roleOf(mesh).shape !== "sphere"; // hidden atoms are not drawn
    const { built, lines } = prepared;
    const passes = renderPasses(
      { meshes: built.meshes.filter(shown), shells: built.shells.filter(shown), thin: built.thin, lines },
      options.width,
      options.height,
      TRACE_SCALE,
      options.outlineScale,
    );
    const frame = makeFrame(options, view, prepared, passes);
    const layers = new Layers();
    for (const { id, obj } of drawOrder(frame)) {
      if (obj.kind !== "polyhedron" && isThin(view, obj)) traceThin(frame, layers, id, obj);
      else traceObject(frame, layers, id, obj);
    }
    const text = documentText(frame, layers);
    return { text, paths: layers.paths, ms: performance.now() - started };
  } finally {
    disposeMeshes([...prepared.built.meshes, ...prepared.built.shells, ...prepared.built.thin, ...prepared.lines]);
  }
}

// The scene the passes and the steps after them read. Nothing is drawn yet, so this allocates no GPU buffers.
function prepareScene(options: SvgOptions, view: View): Prepared {
  const built = buildIdMeshes(options.data, passMaterial("id", false), (obj) => !isThin(view, obj));
  const points = new Map(options.data.points.map((p) => [p.id, p.position] as const));
  const topologies = new Map(options.data.topologies.map((t) => [t.id, t] as const));
  const edgeSpans: EdgeSpan[] = [];
  let nextId = built.objects.length + 1;
  built.objects.forEach((obj, index) => {
    if (obj.kind !== "polyhedron") return;
    const poly = options.data.primitives.polyhedra[obj.poly];
    for (const [a, b] of hardEdges(topologies.get(poly.topology_id)!, points)) edgeSpans.push({ owner: index + 1, a, b, id: nextId++ });
  });
  const boxId = nextId;
  const boxEdges = options.show.box && options.data.cell ? cellEdges(options.data.cell) : [];
  const edgeLines = lineSet(edgeSpans.map((e) => [e.a, e.b, e.id]));
  const boxLines = lineSet(boxEdges.map(([a, b]) => [a, b, boxId]));
  const lines = [edgeLines, boxLines].filter((set) => set.geometry.getAttribute("position").count > 0);
  return { built, points, topologies, edgeSpans, boxEdges, boxId, lines };
}

// A set of 3D segments as one LineSegments, each vertex carrying the segment's id (the line pass writes it).
function lineSet(segments: [THREE.Vector3, THREE.Vector3, number][]): THREE.LineSegments {
  const positions = new Float32Array(segments.length * 6);
  const ids = new Float32Array(segments.length * 2);
  segments.forEach(([a, b, id], k) => {
    positions.set([a.x, a.y, a.z, b.x, b.y, b.z], 6 * k);
    ids.set([id, id], 2 * k);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("objectId", new THREE.BufferAttribute(ids, 1));
  const set = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial());
  set.userData = { role: "line" } satisfies MeshRole;
  return set;
}

function makeFrame(options: SvgOptions, view: View, prepared: Prepared, passes: Passes): Frame {
  const project = projector(passes.width, passes.height);
  return {
    options,
    view,
    prepared,
    passes,
    stats: objectBoxes(passes, prepared.built.objects.length),
    project,
    linePass: new LinePass(project, passes, TRACE_SCALE),
    curves: makeCurveLookup(options, view, prepared),
    tol: snapTolerance(TRACE_SCALE),
    edgeHex: srgbHex(LOOK.outline),
    outlineHex: linearHex(LOOK.outline),
    // The live view's outline is OUTLINE_THICKNESS of the image height; a centred stroke of half of it shows its visible width.
    outlineWidth: OUTLINE_THICKNESS * options.height,
  };
}

// Back to front by each object's nearest visible depth (the smallest NDC depth in its region, the depth at which it is
// seen): a farther object is painted first, so a nearer object's own edge covers the overlap next to it. Depth is read from
// the same buffer as the regions, so the order agrees with what is visible. Objects with no pixels sort last and are skipped.
function drawOrder(f: Frame): { id: number; obj: TracedObject }[] {
  return f.prepared.built.objects
    .map((obj, i) => ({ id: i + 1, nearestDepth: isThin(f.view, obj) ? f.project(vec3(obj.centre)).depth : f.stats.nearest[i + 1], obj }))
    .sort((p, q) => q.nearestDepth - p.nearestDepth);
}

// One object's paths: its fill (with the seam trap), its dark band, its polyhedron edges, and its outline.
function traceObject(f: Frame, layers: Layers, id: number, obj: TracedObject): void {
  const box = boxOf(f.stats.boxes, id);
  if (box.x1 < box.x0) return;
  const rgb = fillRgb(f.options, obj);
  const lit = srgbHex(rgb);
  const dark = shadedBand(rgb, LOOK.dark);
  const common: Attrs = { "fill-rule": "evenodd", ...(obj.alpha < 1 ? { "fill-opacity": obj.alpha } : {}) };
  const region = regionFill(f, id, obj, box);
  let body = "";
  if (region.fill) {
    body += layers.counted(seamTrapped(region.fill, lit, common));
    // The region's own (snapped) outline clips its dark band, so growing the band cannot reach past the rim.
    layers.clips.push(el("clipPath", { id: `k${id}` }, el("path", { d: region.fill, "clip-rule": "evenodd" })));
  }
  const band = darkBandPath(f, id, box);
  if (band) body += layers.counted(seamTrapped(band, dark, { ...common, "clip-path": region.fill ? `url(#k${id})` : undefined }));
  if (obj.kind === "polyhedron") {
    const d = polyhedronEdgePath(f, id);
    if (d) body += layers.counted(el("path", { d, fill: "none", stroke: f.edgeHex, "stroke-width": EDGE_WIDTH, "stroke-linecap": "round" }));
  }
  layers.fills.push(el("g", {}, body));
  if (f.options.outlines && obj.outlined && region.outline) layers.outlines.push(layers.counted(outlineMarkup(f, obj, region.outline)));
}

// The region's boundary as path data: its fill (every ring, the silhouette of a tiny whole object) and its outlined pieces.
// Denoising (no region or outline shorter than a few pixels): a whole tiny object is its exact silhouette; a tiny fragment
// is dropped (the seam trap covers it); tiny rings of a region are dropped.
function regionFill(f: Frame, id: number, obj: TracedObject, box: Box): { fill: string; outline: string } {
  const { passes, stats } = f;
  const regionPx = stats.pixels[id] / (TRACE_SCALE * TRACE_SCALE);
  let regionRingsOf = regionRings(passes, box, (k) => idOf(k) === id);
  let fill = "";
  if (regionPx < MIN_REGION_PX) {
    const exact = f.curves.own(id).find((c) => c.kind === "ellipse");
    const centre = f.project(vec3(obj.centre));
    if (exact && exact.kind === "ellipse" && keyAtCentre(passes, centre) === id && regionPx >= MIN_SILHOUETTE_PX) {
      fill = closedPath(silhouettePoints(exact.e));
    }
    regionRingsOf = [];
  } else {
    regionRingsOf = regionRingsOf.filter((ring) => ringArea(ring, TRACE_SCALE) >= MIN_REGION_PX);
  }
  let outline = "";
  for (const ring of regionRingsOf) {
    const { stretches, whole } = stretchesOf(ring, id, passes, TRACE_SCALE);
    const parts = ringPaths(stretches, whole, (st) => f.curves.candidatesFor(id, st), f.tol);
    fill += parts.fill;
    outline += parts.outline;
  }
  return { fill, outline };
}

// The dark band: the toon's shaded pixels of the object. It keeps the fitted Bézier (its boundary is an ellipse arc inside
// the atom, not snapped here).
function darkBandPath(f: Frame, id: number, box: Box): string {
  const { passes } = f;
  const rings = regionRings(passes, box, (k) => k === darkKey(id)).filter((ring) =>
    ringArea(ring, TRACE_SCALE) >= MIN_REGION_PX && ringArea(ring, TRACE_SCALE) / Math.max(ringPerimeter(ring, TRACE_SCALE), MIN_PERIMETER_PX) >= MIN_STRIP_PX);
  return rings.map((ring) => closedPath(toCss(ring, TRACE_SCALE))).join("");
}

function toCss(ring: Pt[], scale: number): Pt[] {
  return ring.map(([x, y]): Pt => [x / scale, y / scale]);
}

// A polyhedron's visible hard edges, from the line pass.
function polyhedronEdgePath(f: Frame, id: number): string {
  return segmentsPath(f.prepared.edgeSpans.filter((e) => e.owner === id).flatMap((e) => f.linePass.spansOf(e.a, e.b, e.id)));
}

// The live view's outline stroke: it thins with the shape's on-screen radius, so a sub-pixel shape gets none, as in the live
// view. A centred stroke is twice its outward reach, and the cap is a share of the radius.
function outlineMarkup(f: Frame, obj: TracedObject, d: string): string {
  const r = radiusPx(f.view, obj);
  const width = r === null ? f.outlineWidth / 2 : Math.min(f.outlineWidth / 2, 2 * OUTLINE_SIZE_FRACTION * r);
  const strokeWidth = f.options.outlineScale * width; // the live shell multiplies its width by the same scale
  return el("path", { d, fill: "none", stroke: f.outlineHex, "stroke-width": strokeWidth, "stroke-linejoin": "round" });
}

// The colour of an object's fill: its material's, or the arrow colour.
function fillRgb(options: SvgOptions, obj: TracedObject): number[] {
  return obj.material === null ? arrowColor() : colorOf(options, obj.material);
}

// A fill, stroked in its own colour SEAM_TRAP_PX outward, so the seams between neighbouring regions close.
function seamTrapped(d: string, colour: string, extra: Attrs): string {
  return el("path", { d, fill: colour, stroke: colour, "stroke-width": SEAM_STROKE_WIDTH, "stroke-linejoin": "round", ...extra });
}

// A thin shape is drawn as a line or a circle, not as a region.
function traceThin(f: Frame, layers: Layers, id: number, obj: InstanceObject): void {
  const lit = srgbHex(fillRgb(f.options, obj));
  const radius = radiusPx(f.view, obj) ?? 0;
  const thinSvg = obj.kind === "dot" ? dotMarkup(obj, lit, id, f.linePass, radius) : barMarkup(obj, lit, id, f.linePass, radius);
  if (thinSvg) layers.fills.push(layers.counted(thinSvg));
}

// A bond or dot as a line: a bond is its axis as a stroke of its projected diameter, with round caps; a dot is a small
// circle. Both keep only the parts the line pass shows with their id (three.js decided the visibility).
function dotMarkup(obj: InstanceObject, lit: string, id: number, lines: LinePass, radius: number): string {
  const p = lines.project(vec3(obj.centre));
  if (!onScreen(p)) return ""; // behind the camera or not finite: nothing to draw
  if (!lines.shows(id, Math.floor(p.x), Math.floor(p.y))) return "";
  return el("circle", { cx: p.x / lines.scale, cy: p.y / lines.scale, r: radius, fill: lit });
}

function barMarkup(obj: InstanceObject, lit: string, id: number, lines: LinePass, radius: number): string {
  const m = obj.matrix;
  const c = vec3(obj.centre);
  const axis = new THREE.Vector3(m[4], m[5], m[6]).multiplyScalar(HALF_AXIS);
  const d = segmentsPath(lines.spansOf(c.clone().sub(axis), c.clone().add(axis), id));
  return d ? el("path", { d, fill: "none", stroke: lit, "stroke-width": 2 * radius, "stroke-linecap": "round" }) : "";
}

function documentText(f: Frame, layers: Layers): string {
  const { options, view } = f;
  const body = `${el("defs", {}, layers.clips.join(""))}\n${layers.fills.join("\n")}\n${cellBoxMarkup(f, layers)}\n${layers.outlines.join("\n")}\n${triadSvg({ o: options, view })}`;
  const style = textEl("style", {}, axisFontFace(["700"]));
  const svg = el("svg", { xmlns: "http://www.w3.org/2000/svg", width: options.width, height: options.height, viewBox: `0 0 ${options.width} ${options.height}` }, `\n${style}\n${body}\n`);
  return `${svg}\n`;
}

// The cell box, from the line pass.
function cellBoxMarkup(f: Frame, layers: Layers): string {
  const { options, prepared } = f;
  if (!options.show.box || !options.data.cell) return "";
  const d = segmentsPath(prepared.boxEdges.flatMap(([a, b]) => f.linePass.spansOf(a, b, prepared.boxId)));
  return d ? layers.counted(el("path", { d, fill: "none", stroke: options.boxColor, "stroke-width": BOX_LINE_WIDTH })) : "";
}

// The exact curves a boundary stretch of object `id` may lie on: its own, the outside object's own, and the crossing with it
// (the section of an atom or bond by the face of the polyhedron it meets). Each object's curves are built once.
function makeCurveLookup(options: SvgOptions, view: View, prepared: Prepared): CurveLookup {
  const screen = screenOf(view);
  const { built, points } = prepared;
  const own = memo((id: number): Curve[] => {
    const obj = built.objects[id - 1];
    if (obj.kind === "polyhedron") return edgeCurves(hardEdges(topologyOf(options, prepared, obj.poly), points), screen);
    if (obj.kind === "sphere" || obj.kind === "dot") return sphereCurves(view, vec3(obj.centre), obj.matrix[0]);
    if (obj.kind === "cylinder") return cylinderCurves(obj.matrix, screen);
    return [];
  });
  const facesOf = memo((poly: number): THREE.Vector3[][] => {
    const topo = topologyOf(options, prepared, poly);
    return topo.faces.map(([i, j, k]) => [i, j, k].map((q) => vec3(points.get(topo.point_ids[q])!)));
  });
  // The section of an atom or bond by the face of a polyhedron nearest the stretch's midpoint.
  const sectionOfFace = (poly: PolyhedronObject, other: InstanceObject, mid: Pt): Curve[] => {
    const face = nearestFace(facesOf(poly.poly), mid, screen);
    return face ? sectionCurves(other, face, screen) : [];
  };
  // The crossing curves of object `id` with the object `label` on the outside: only a polyhedron and an instance cross.
  const crossing = (id: number, label: number, mid: Pt): Curve[] => {
    const a = built.objects[id - 1];
    const b = built.objects[label - 1];
    if (a.kind === "polyhedron" && b.kind !== "polyhedron") return sectionOfFace(a, b, mid);
    if (b.kind === "polyhedron" && a.kind !== "polyhedron") return sectionOfFace(b, a, mid);
    return [];
  };
  const candidatesFor = (id: number, st: Stretch): Curve[] => {
    if (st.label <= 0) return own(id);
    const mid = st.pts[Math.floor(st.pts.length / 2)];
    return [...own(id), ...own(st.label), ...crossing(id, st.label, mid)];
  };
  return { own, candidatesFor };
}

// The section of an atom, dot or bond by the plane of a polyhedron face: a circle or an ellipse, projected.
function sectionCurves(other: InstanceObject, face: [THREE.Vector3, THREE.Vector3, THREE.Vector3], screen: (p: THREE.Vector3) => Pt): Curve[] {
  if (other.kind === "sphere" || other.kind === "dot") {
    const c = sectionCurve(vec3(other.centre), other.matrix[0], face, screen);
    return c ? [c] : [];
  }
  if (other.kind === "cylinder") {
    const c = cylinderSectionCurve(other.matrix, face, screen);
    return c ? [c] : [];
  }
  return [];
}

function topologyOf(options: SvgOptions, prepared: Prepared, poly: number): Topology {
  return prepared.topologies.get(options.data.primitives.polyhedra[poly].topology_id)!;
}

// A function's results, computed once per key.
function memo<K, V>(compute: (key: K) => V): (key: K) => V {
  const cache = new Map<K, V>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, compute(key));
    return cache.get(key)!;
  };
}

// A scene point's screen position in CSS px (the view's space, where the curves are written).
function screenOf(view: View): (p: THREE.Vector3) => Pt {
  return (p) => {
    const s = view.toScreen(view.toCam(p));
    return [s.x, s.y];
  };
}

// The silhouette of a tiny atom: points round its ellipse.
function silhouettePoints(e: Ellipse): Pt[] {
  return Array.from({ length: SILHOUETTE_SAMPLES }, (_, i) => pointAt(e, (2 * Math.PI * i) / SILHOUETTE_SAMPLES));
}

// The on-screen radius of an atom, bond or dot in output px (for the outline width and the thin-shape test).
function radiusPx(view: View, obj: TracedObject): number | null {
  if (obj.kind === "polyhedron") return null;
  const m = obj.matrix;
  const unit = obj.kind === "cylinder" ? Math.hypot(m[0], m[1], m[2]) : obj.kind === "sphere" || obj.kind === "dot" ? m[0] : null;
  return unit === null ? null : unit * view.pxPerUnit(view.toCam(vec3(obj.centre)));
}

// A bond or dot whose projected diameter is under THIN_AS_LINE_PX is thin: it is drawn as a line, not traced.
function isThin(view: View, obj: TracedObject): boolean {
  return (obj.kind === "cylinder" || obj.kind === "dot") && (radiusPx(view, obj) ?? Infinity) * 2 < THIN_AS_LINE_PX;
}
