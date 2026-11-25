// The traced SVG. The id, band and depth renders decide which part of each object shows. Each boundary of a visible region
// is then written as the exact curve it lies on where one matches (stretch.ts): an atom's silhouette, a polyhedron's edges,
// a bond's sides and end ellipses, and the crossing of an atom or bond with a face (the section of the sphere or cylinder by
// the face's plane). Only a stretch that matches none of them is a fitted Bézier (curves.ts). The outlines are the
// boundaries where the outside is background or lies behind the object (classified per stretch, not by a depth threshold).
// The toon band is traced from the band pass without snapping, and the polyhedron edges and the cell box are lines that the
// line pass shows (edges.ts).
import * as THREE from "three";
import { LOOK, axisFontFace } from "../config";
import { type Attrs, el, fmt, linearHex, shadedBand, srgbHex, textEl } from "../export/markup";
import { type SvgOptions, arrowColor, colorOf } from "../export/shape";
import { triadSvg } from "../export/triad";
import { type View, makeView, vec3 } from "../export/view";
import type { Topology, Vec3 } from "../types";
import { type Pt, closedPath } from "./curves";
import { type Curve, cylinderCurves, cylinderSectionCurve, edgeCurves, sectionCurve, sphereCurves } from "./exact";
import { cellEdges, hardEdges, onScreen, showsId, visibleSpans } from "./edges";
import { type Box, type Ring, regionRings } from "./field";
import { buildIdMeshes, type TracedObject } from "./objects";
import { type Drawable, disposeMeshes, passMaterial, projector, renderPasses } from "./passes";
import { snapTolerance, ringPaths, stretchesOf, type Stretch } from "./stretch";

// ---- constants ----
// The render scale: the id, band and depth passes are this many times the stage in each direction.
const TRACE_SCALE = 2;
// The seam trap: each fill is stroked in its own colour, this many output px outward, so the hairline seams between
// neighbouring regions close.
const SEAM_TRAP_PX = 0.5;
// A bond, dash or dot whose projected diameter is under this many output px is drawn as a stroked line (or a small circle),
// not traced as a region: a region that thin breaks into blobs and its outline doubles it.
const THIN_AS_LINE_PX = 3;
// The cartoon outline's width is at most this share of the shape's on-screen radius (draw.ts OUTLINE_SIZE_FRACTION, not
// exported there), so small shapes get thin outlines, as in the live view.
const OUTLINE_SIZE_FRACTION = 0.12;
// The outline width as a share of the image height, the same as the live view's outline (draw.ts: a clip-space offset of
// this fraction of the half height). A centred stroke of half the width shows the live view's visible width.
const OUTLINE_FRACTION = 0.0035;
// Polyhedron edge and cell box line widths, in CSS px.
const EDGE_WIDTH = 1;
const BOX_LINE_WIDTH = 1;

const OUT_OF_RANGE = 1 << 30;
// Denoising sizes, in CSS px (and px^2 for areas): a region or a band piece under these is dropped or merged.
const MIN_REGION_PX = 4;
const MIN_STRIP_PX = 1;
const MIN_SILHOUETTE_PX = 1;
const NEAREST_START = 2; // beyond the NDC depth range [0, 1]

interface TracedResult {
  text: string; // the SVG document
  paths: number; // the path elements in it
  ms: number; // the time the export took
}

export function buildTracedSvg(o: SvgOptions): TracedResult {
  const started = performance.now();
  const scale = TRACE_SCALE;
  const view = makeView(o);
  // The on-screen radius of an atom, bond or dot in output px (for the outline width and the thin-shape test).
  const radiusPx = (obj: TracedObject): number | null => {
    if (!obj.matrix) return null;
    const unit = obj.kind === "cylinder" ? Math.hypot(obj.matrix[0], obj.matrix[1], obj.matrix[2]) : obj.kind === "sphere" || obj.kind === "dot" ? obj.matrix[0] : null;
    return unit === null ? null : unit * view.pxPerUnit(view.toCam(vec3(obj.centre)));
  };
  const isThin = (obj: TracedObject): boolean => (obj.kind === "cylinder" || obj.kind === "dot") && (radiusPx(obj) ?? Infinity) * 2 < THIN_AS_LINE_PX;
  const { objects, meshes, shells, thin } = buildIdMeshes(o.data, passMaterial("id", false), (obj) => !isThin(obj));
  const shown = (mesh: THREE.Mesh) => o.show.atoms || mesh.userData.shape !== "sphere"; // hidden atoms are not drawn
  const points = new Map(o.data.points.map((p) => [p.id, p.position] as const));
  const topologies = new Map(o.data.topologies.map((t) => [t.id, t] as const));
  // The polyhedron edges and the cell box are lines with ids after the objects (one per edge, then the box), so the line
  // pass can say which line is nearest at each pixel. A line's samples then ask that pixel for their own id (edges.ts).
  const edgeSpans: { owner: number; a: THREE.Vector3; b: THREE.Vector3; id: number }[] = [];
  let nextId = objects.length + 1;
  objects.forEach((obj, index) => {
    if (obj.kind !== "polyhedron") return;
    const poly = o.data.primitives.polyhedra[obj.poly!];
    for (const [a, b] of hardEdges(topologies.get(poly.topology_id)!, points)) edgeSpans.push({ owner: index + 1, a, b, id: nextId++ });
  });
  const boxId = nextId;
  const boxEdges = o.show.box && o.data.cell ? cellEdges(o.data.cell) : [];
  const edgeLines = lineSet(edgeSpans.map((e) => [e.a, e.b, e.id]));
  const boxLines = lineSet(boxEdges.map(([a, b]) => [a, b, boxId]));
  const lines = [edgeLines, boxLines].filter((set) => set.geometry.getAttribute("position").count > 0);
  const { keys, depth, shell, lineId, width, height } = renderPasses(meshes.filter(shown), shells.filter(shown), thin, lines, o.width, o.height, scale);
  const { boxes, nearest, pixels } = objectBoxes(keys, depth, width, objects.length);
  const project = projector(width, height);
  const screen = (p: THREE.Vector3): Pt => {
    const s = view.toScreen(view.toCam(p));
    return [s.x, s.y];
  };
  const tol = snapTolerance(scale);
  const edgeHex = srgbHex(LOOK.outline);
  const outlineHex = linearHex(LOOK.outline);
  const outlineWidth = OUTLINE_FRACTION * o.height;
  // The visible spans of a line with id `id`, from the line pass (no depth tolerance: three.js decided the depth).
  const spansOf = (a: THREE.Vector3, b: THREE.Vector3, id: number) => visibleSpans(a, b, project, lineId, id, width, height, scale);

  const ownCache = new Map<number, Curve[]>();
  const own = (id: number): Curve[] => {
    if (!ownCache.has(id)) ownCache.set(id, ownCurves(o, objects[id - 1], view, screen, topologies, points));
    return ownCache.get(id)!;
  };
  const faceCache = new Map<number, THREE.Vector3[][]>();
  const facesOf = (poly: number): THREE.Vector3[][] => {
    if (!faceCache.has(poly)) {
      const p = o.data.primitives.polyhedra[poly];
      const topo = topologies.get(p.topology_id)!;
      faceCache.set(poly, topo.faces.map(([i, j, k]) => [i, j, k].map((q) => vec3(points.get(topo.point_ids[q])!))));
    }
    return faceCache.get(poly)!;
  };
  // The crossing curves of object `id` with the object `label` on the outside, near the stretch's midpoint.
  const crossing = (id: number, label: number, mid: Pt): Curve[] => {
    const a = objects[id - 1];
    const b = objects[label - 1];
    const [poly, other] = a.kind === "polyhedron" ? [a, b] : b.kind === "polyhedron" ? [b, a] : [null, null];
    if (!poly || !other) return [];
    const face = nearestFace(facesOf(poly.poly!), mid, screen);
    if (!face) return [];
    if (other.kind === "sphere" || other.kind === "dot") {
      const c = sectionCurve(vec3(other.centre), other.matrix![0], face, screen);
      return c ? [c] : [];
    }
    if (other.kind === "cylinder" && other.matrix) {
      const c = cylinderSectionCurve(other.matrix, face, screen);
      return c ? [c] : [];
    }
    return [];
  };

  // Back to front by each object's nearest visible depth (the smallest NDC depth in its region, the depth at which it is
  // seen): a farther object is painted first, so a nearer object's own edge covers the overlap next to it. Depth is read from
  // the same buffer as the regions, so the order agrees with what is visible. Objects with no pixels sort last and are skipped.
  const order = objects
    .map((obj, i) => ({ id: i + 1, nearestDepth: isThin(obj) ? project(vec3(obj.centre)).depth : nearest[i + 1], obj }))
    .sort((p, q) => q.nearestDepth - p.nearestDepth);
  const clips: string[] = [];
  let paths = 0;
  const fills: string[] = [];
  const outlines: string[] = [];
  for (const { id, obj } of order) {
    if (isThin(obj)) {
      const thin = thinMarkup(obj, o, project, lineId, id, width, height, scale, radiusPx(obj) ?? 0);
      if (thin) {
        fills.push(thin);
        paths++;
      }
      continue;
    }
    const box = boxOf(boxes, id);
    if (box.x1 < box.x0) continue;
    const rgb = obj.material === null ? arrowColor() : colorOf(o, obj.material);
    const lit = srgbHex(rgb);
    const dark = shadedBand(rgb, LOOK.dark);
    const common: Attrs = { "fill-rule": "evenodd", ...(obj.alpha < 1 ? { "fill-opacity": obj.alpha } : {}) };
    const outlined = o.outlines && obj.outlined;
    let body = "";
    let fillD = "";
    let outlineD = "";
    const regionPx = pixels[id] / (scale * scale);
    const centre = project(vec3(obj.centre));
    // Denoising (no region or outline shorter than a few pixels): a whole tiny object is its exact silhouette; a tiny fragment
    // is dropped (the seam trap covers it); tiny rings of a region are dropped.
    let unionRings = regionRings(keys, width, box, (k) => k >> 1 === id);
    let silhouette = "";
    if (regionPx < MIN_REGION_PX) {
      const exact = own(id).find((c) => c.kind === "ellipse");
      if (exact && exact.kind === "ellipse" && keyAtCentre(keys, width, centre) === id && regionPx >= MIN_SILHOUETTE_PX) {
        silhouette = closedPath(sampleEllipse(exact.e));
      }
      unionRings = [];
    } else {
      unionRings = unionRings.filter((ring) => ringArea(ring, scale) >= MIN_REGION_PX);
    }
    if (silhouette) fillD += silhouette;
    for (const ring of unionRings) {
      const { stretches, whole } = stretchesOf(ring, id, keys, width, height, scale, shell);
      const parts = ringPaths(stretches, whole, (st) => candidatesFor(id, st, own, crossing), tol);
      fillD += parts.fill;
      outlineD += parts.outline;
    }
    // The region's own (snapped) outline clips its dark band, so growing the band cannot reach past the rim.
    const clipId = `k${id}`;
    if (fillD) {
      const stroke = { stroke: lit, "stroke-width": 2 * SEAM_TRAP_PX, "stroke-linejoin": "round" };
      body += el("path", { d: fillD, fill: lit, ...stroke, ...common });
      paths++;
      clips.push(el("clipPath", { id: clipId }, el("path", { d: fillD, "clip-rule": "evenodd" })));
    }
    // The dark band keeps the fitted Bézier (its boundary is an ellipse arc inside the atom, not snapped here).
    const bandRings = regionRings(keys, width, box, (k) => k === 2 * id + 1).filter((ring) =>
      ringArea(ring, scale) >= MIN_REGION_PX && ringArea(ring, scale) / Math.max(ringPerimeter(ring, scale), 1e-9) >= MIN_STRIP_PX);
    const shade = bandRings.map((ring) => closedPath(toCss(ring, scale))).join("");
    if (shade) {
      const stroke = { stroke: dark, "stroke-width": 2 * SEAM_TRAP_PX, "stroke-linejoin": "round" };
      body += el("path", { d: shade, fill: dark, ...stroke, ...common, "clip-path": fillD ? `url(#${clipId})` : undefined });
      paths++;
    }
    if (obj.kind === "polyhedron") {
      const d = edgeSpans.filter((e) => e.owner === id).flatMap((e) => spansOf(e.a, e.b, e.id))
        .map(([p, q]) => `M${fmt(p[0])} ${fmt(p[1])}L${fmt(q[0])} ${fmt(q[1])}`).join("");
      if (d) {
        body += el("path", { d, fill: "none", stroke: edgeHex, "stroke-width": EDGE_WIDTH, "stroke-linecap": "round" });
        paths++;
      }
    }
    fills.push(el("g", {}, body));
    if (outlined && outlineD) {
      // The outline thins with the shape's on-screen radius: a sub-pixel shape gets none, as in the live view.
      const r = radiusPx(obj);
      const strokeWidth = r === null ? outlineWidth / 2 : Math.min(outlineWidth / 2, 2 * OUTLINE_SIZE_FRACTION * r);
      outlines.push(el("path", { d: outlineD, fill: "none", stroke: outlineHex, "stroke-width": strokeWidth, "stroke-linejoin": "round" }));
      paths++;
    }
  }
  disposeMeshes([...meshes, ...shells, ...thin, ...lines] as Drawable[]);

  let box = "";
  if (o.show.box && o.data.cell) {
    const d = boxEdges.flatMap(([a, b]) => spansOf(a, b, boxId))
      .map(([p, q]) => `M${fmt(p[0])} ${fmt(p[1])}L${fmt(q[0])} ${fmt(q[1])}`).join("");
    if (d) {
      box = el("path", { d, fill: "none", stroke: o.boxColor, "stroke-width": BOX_LINE_WIDTH });
      paths++;
    }
  }

  const body = `${el("defs", {}, clips.join(""))}\n${fills.join("\n")}\n${box}\n${outlines.join("\n")}\n${triadSvg({ o, view })}`;
  const style = textEl("style", {}, axisFontFace(["700"]));
  const svg = el("svg", { xmlns: "http://www.w3.org/2000/svg", width: o.width, height: o.height, viewBox: `0 0 ${o.width} ${o.height}` }, `\n${style}\n${body}\n`);
  const text = `${svg}\n`;
  return { text, paths, ms: performance.now() - started };
}

// A thin shape as lines: a bond or dash is its axis as a stroke of its projected diameter, with round caps; a dot is a small
// circle. Both keep only the parts the line pass shows with their id (three.js decided the visibility).
function thinMarkup(obj: TracedObject, o: SvgOptions, project: (p: THREE.Vector3) => { x: number; y: number; depth: number }, lineId: Uint32Array, id: number, width: number, height: number, scale: number, radiusPx: number): string {
  const rgb = obj.material === null ? arrowColor() : colorOf(o, obj.material);
  const lit = srgbHex(rgb);
  const m = obj.matrix!;
  const c = vec3(obj.centre);
  if (obj.kind === "dot") {
    const p = project(c);
    if (!onScreen(p)) return ""; // behind the camera or not finite: nothing to draw
    if (!showsId(lineId, id, width, height, Math.floor(p.x), Math.floor(p.y))) return "";
    return el("circle", { cx: p.x / scale, cy: p.y / scale, r: radiusPx, fill: lit });
  }
  const axis = new THREE.Vector3(m[4], m[5], m[6]).multiplyScalar(0.5);
  const stretches = visibleSpans(c.clone().sub(axis), c.clone().add(axis), project, lineId, id, width, height, scale);
  const d = stretches.map(([p, q]) => `M${fmt(p[0])} ${fmt(p[1])}L${fmt(q[0])} ${fmt(q[1])}`).join("");
  return d ? el("path", { d, fill: "none", stroke: lit, "stroke-width": 2 * radiusPx, "stroke-linecap": "round" }) : "";
}

// The exact curves a stretch of object `id` may lie on: its own, the outside object's own, and the crossing with it.
function candidatesFor(id: number, st: Stretch, own: (id: number) => Curve[], crossing: (id: number, label: number, mid: Pt) => Curve[]): Curve[] {
  if (st.label <= 0) return own(id);
  const mid = st.pts[Math.floor(st.pts.length / 2)];
  return [...own(id), ...own(st.label), ...crossing(id, st.label, mid)];
}

// The curves of one object: its silhouette (sphere), its edges (polyhedron), its sides and end ellipses (cylinder).
function ownCurves(o: SvgOptions, obj: TracedObject, view: View, screen: (p: THREE.Vector3) => Pt, topologies: Map<string, Topology>, points: Map<string, Vec3>): Curve[] {
  if ((obj.kind === "sphere" || obj.kind === "dot") && obj.matrix) return sphereCurves(view, vec3(obj.centre), obj.matrix[0]);
  if (obj.kind === "cylinder" && obj.matrix) return cylinderCurves(obj.matrix, screen);
  if (obj.kind === "polyhedron") {
    const poly = o.data.primitives.polyhedra[obj.poly!];
    const topo = topologies.get(poly.topology_id)!;
    return edgeCurves(hardEdges(topo, points), screen);
  }
  return [];
}

// The face of a polyhedron nearest to a screen point (its projected triangle, distance 0 when the point is inside).
function nearestFace(faces: THREE.Vector3[][], p: Pt, screen: (q: THREE.Vector3) => Pt): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  let best: [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null = null;
  let bestDist = Infinity;
  for (const f of faces) {
    const d = triangleDistance(p, screen(f[0]), screen(f[1]), screen(f[2]));
    if (d < bestDist) {
      bestDist = d;
      best = [f[0], f[1], f[2]];
    }
  }
  return best;
}

function triangleDistance(p: Pt, a: Pt, b: Pt, c: Pt): number {
  const sign = (u: Pt, v: Pt, w: Pt) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const s1 = sign(a, b, p);
  const s2 = sign(b, c, p);
  const s3 = sign(c, a, p);
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0;
  return Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c), segmentDistance(p, c, a));
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / Math.max(dx * dx + dy * dy, 1e-12)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function toCss(ring: Ring, scale: number): Pt[] {
  return ring.map(([x, y]): Pt => [x / scale, y / scale]);
}

// The bounding box of each object's pixels in one scan: four numbers per id (x0, y0, x1, y1), x1 < 0 when none is visible.
// The nearest depth of each object is taken in the same scan (NEAREST_START is beyond any depth, so an empty object sorts last).
function objectBoxes(keys: Uint32Array, depth: Float32Array, width: number, count: number): { boxes: Int32Array; nearest: Float64Array; pixels: Uint32Array } {
  const pixels = new Uint32Array(count + 1); // visible pixels per object (both bands)
  const boxes = new Int32Array((count + 1) * 4);
  const nearest = new Float64Array(count + 1).fill(NEAREST_START);
  for (let id = 0; id <= count; id++) boxes.set([OUT_OF_RANGE, OUT_OF_RANGE, -1, -1], 4 * id);
  for (let p = 0; p < keys.length; p++) {
    const k = keys[p];
    if (k === 0) continue;
    const id = k >> 1;
    const b = 4 * id;
    nearest[id] = Math.min(nearest[id], depth[p]);
    pixels[id]++;
    const x = p % width;
    const y = (p - x) / width;
    if (x < boxes[b]) boxes[b] = x;
    if (y < boxes[b + 1]) boxes[b + 1] = y;
    if (x > boxes[b + 2]) boxes[b + 2] = x;
    if (y > boxes[b + 3]) boxes[b + 3] = y;
  }
  return { boxes, nearest, pixels };
}

function boxOf(boxes: Int32Array, id: number): Box {
  return { x0: boxes[4 * id], y0: boxes[4 * id + 1], x1: boxes[4 * id + 2], y1: boxes[4 * id + 3] };
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
  set.userData = { line: true };
  return set;
}

// The key at the render pixel under a projected point (0 when off the image). The centre pixel tells whether an object is the
// visible surface at its centre, i.e. whole rather than a fragment.
function keyAtCentre(keys: Uint32Array, width: number, p: { x: number; y: number }): number {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  return keys[y * width + x] >> 1;
}

// Area of a ring in CSS px^2 (shoelace; the ring is in render px).
function ringArea(ring: Ring, scale: number): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    twice += x0 * y1 - x1 * y0;
  }
  return Math.abs(twice) / 2 / (scale * scale);
}

// Perimeter of a ring in CSS px.
function ringPerimeter(ring: Ring, scale: number): number {
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  return total / scale;
}

// Points around an ellipse (CSS px), for a silhouette drawn as a path.
function sampleEllipse(e: { cx: number; cy: number; rx: number; ry: number; phi: number }): Pt[] {
  const steps = 48;
  return Array.from({ length: steps }, (_, i) => {
    const t = (2 * Math.PI * i) / steps;
    const x = e.rx * Math.cos(t);
    const y = e.ry * Math.sin(t);
    return [e.cx + x * Math.cos(e.phi) - y * Math.sin(e.phi), e.cy + x * Math.sin(e.phi) + y * Math.cos(e.phi)] as Pt;
  });
}
