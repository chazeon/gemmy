// The traced SVG of the structure. The id, band and depth renders decide which part of each object shows (regions.ts
// traces each object's region and its boundary, snapped to the exact curves it lies on where one matches: an atom's
// silhouette, a polyhedron's edges, a bond's sides and end ellipses, and the crossing of an atom or bond with a face).
// This file builds the structure's group (its objects, passes and curves), adds the polyhedron edges and the cell box
// (lines that the line pass shows, edges.ts), and writes the document. The triad is traced after the structure
// (triad-trace.ts).
import * as THREE from "three";
import { ARROW, LOOK, axisFontFace } from "../config";
import { linearHex, srgbHex } from "../export/markup";
import { svgEl } from "../export/svg-dom";
import { type SvgOptions, type View, makeView, vec3 } from "../export/view";
import type { Topology, Vec3 } from "../types";
import { type Pt, segmentsPath } from "./curves";
import { type Curve, cylinderSectionCurve, edgeCurves, sectionCurve } from "./candidates";
import { type Passes, objectBoxes } from "./buffers";
import { nearestFace } from "./measure";
import { LinePass } from "./edges";
import { cellEdges } from "../geom/cell";
import { hardEdges } from "../render/instancing";
import {
  type CurveLookup,
  type Group,
  type Layers,
  curveLookup,
  memo,
  ownCurves,
  radiusPx,
  screenOf,
  traceRegions,
} from "./regions";
import {
  type IdMeshes,
  type InstanceObject,
  type MeshRole,
  type PolyhedronObject,
  type TracedObject,
  buildIdMeshes,
  roleOf,
} from "./objects";
import { type PassView, disposeMeshes, passMaterial, projector, renderPasses } from "./passes";
import { OUTLINE_THICKNESS, root } from "../render/draw";
import { camera } from "../state";
import { snapTolerance } from "./stretch";
import { traceTriad } from "./triad-trace";

// The render scale: the id, band and depth passes are this many times the stage in each direction.
const TRACE_SCALE = 2;
// Polyhedron edge and cell box line widths, in CSS px.
const EDGE_WIDTH = 1;
const BOX_LINE_WIDTH = 1;
// A bond, dash or dot whose projected diameter is under this many output px is drawn as a stroked line (or a small
// circle), not traced as a region: a region that thin breaks into blobs and its outline doubles it.
const THIN_AS_LINE_PX = 3;

interface TracedResult {
  text: string; // the SVG document
  paths: number; // the path elements in it
  ms: number; // the time the export took
}

// The scene as the export reads it: the meshes that carry the ids, the object table, the polyhedron edge spans and the
// cell box, and the line sets the line pass draws. The polyhedron edges and the cell box are lines with ids after the
// objects (one per edge, then the box), so the line pass can say which line is nearest at each pixel (edges.ts).
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

export function buildTracedSvg(options: SvgOptions): TracedResult {
  const started = performance.now();
  const view = makeView(options);
  const prepared = prepareScene(options, view);
  try {
    // Hidden atoms are not drawn.
    const shown = (mesh: THREE.Mesh) => options.show.atoms || roleOf(mesh).shape !== "sphere";
    const { built, lines } = prepared;
    const pass: PassView = { camera: camera.value, origin: root.position };
    const passes = renderPasses(
      { meshes: built.meshes.filter(shown), shells: built.shells.filter(shown), thin: built.thin, lines },
      {
        cssWidth: options.width,
        cssHeight: options.height,
        scale: TRACE_SCALE,
        outlineScale: options.outlineScale,
        view: pass,
      },
    );
    const group = makeGroup(options, view, prepared, passes, pass);
    const layers = traceRegions(group);
    const box = cellBoxMarkup(options, prepared, group.linePass, layers);
    const triad = traceTriad(options, view, TRACE_SCALE);
    const text = documentText(options, layers, box, triad.node);
    return { text, paths: layers.paths + triad.paths, ms: performance.now() - started };
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
    for (const [a, b] of polyhedronEdges(topologies.get(poly.topology_id)!, points))
      edgeSpans.push({ owner: index + 1, a, b, id: nextId++ });
  });
  const boxId = nextId;
  const boxEdges = options.show.box && options.data.cell ? cellEdges(options.data.cell).map(vectorPair) : [];
  const edgeLines = lineSet(edgeSpans.map((e) => [e.a, e.b, e.id]));
  const boxLines = lineSet(boxEdges.map(([a, b]) => [a, b, boxId]));
  const lines = [edgeLines, boxLines].filter((set) => set.geometry.getAttribute("position").count > 0);
  return { built, points, topologies, edgeSpans, boxEdges, boxId, lines };
}

// A polyhedron's hard edges as THREE vectors (the line sets and the edge curves take those).
function polyhedronEdges(topo: Topology, points: Map<string, Vec3>): [THREE.Vector3, THREE.Vector3][] {
  return hardEdges(topo, points).map(vectorPair);
}
function vectorPair([a, b]: [Vec3, Vec3]): [THREE.Vector3, THREE.Vector3] {
  return [vec3(a), vec3(b)];
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

// The structure's group: its objects with the passes, the curves they may lie on, and how they are painted.
function makeGroup(options: SvgOptions, view: View, prepared: Prepared, passes: Passes, pass: PassView): Group {
  const project = projector(passes.width, passes.height, pass);
  const linePass = new LinePass(project, passes, TRACE_SCALE);
  const edgeHex = srgbHex(LOOK.outline);
  const edgesOf = new Map<number, EdgeSpan[]>();
  for (const span of prepared.edgeSpans) {
    const list = edgesOf.get(span.owner);
    if (list) list.push(span);
    else edgesOf.set(span.owner, [span]);
  }
  return {
    scale: TRACE_SCALE,
    objects: prepared.built.objects,
    passes,
    stats: objectBoxes(passes, prepared.built.objects.length),
    view,
    project,
    linePass,
    curves: makeCurveLookup(options, view, prepared),
    tol: snapTolerance(TRACE_SCALE),
    paint: { rgb: (obj) => fillRgb(options, obj), opacity: () => 1 },
    // The live view's outline is OUTLINE_THICKNESS of the image height; a centred stroke of half of it shows its
    // visible width.
    outlines: {
      on: options.outlines,
      hex: linearHex(LOOK.outline),
      width: OUTLINE_THICKNESS * options.height,
      scale: options.outlineScale,
      capped: true,
    },
    thin: (obj) => isThin(view, obj),
    edgeLine: (id) => {
      const d = segmentsPath((edgesOf.get(id) ?? []).flatMap((e) => linePass.spansOf(e.a, e.b, e.id)));
      return d
        ? svgEl("path", { d, fill: "none", stroke: edgeHex, "stroke-width": EDGE_WIDTH, "stroke-linecap": "round" })
        : null;
    },
    clipPrefix: "k",
  };
}

// The colour of an object's fill: its material's sRGB colour (the first three components of its base colour), or the
// arrow colour (the arrows have no material, so they take ARROW.color).
function fillRgb(options: SvgOptions, obj: TracedObject): number[] {
  const rgb = obj.material === null ? ARROW.color : options.data.materials[obj.material].base_color;
  return rgb.slice(0, 3);
}

// The document in paint order: the axis font (embedded as a style), the clip paths, the fills, the cell box, the
// outlines and the triad. The browser serialises the tree once, escaping every text and attribute value on the way.
function documentText(options: SvgOptions, layers: Layers, box: SVGElement | null, triad: SVGElement): string {
  const svg = svgEl(
    "svg",
    { width: options.width, height: options.height, viewBox: `0 0 ${options.width} ${options.height}` },
    [
      svgEl("style", {}, [axisFontFace("700")]),
      svgEl("defs", {}, layers.clips),
      ...layers.fills,
      box,
      ...layers.outlines,
      triad,
    ],
  );
  return `${new XMLSerializer().serializeToString(svg)}\n`;
}

// The cell box, from the line pass.
function cellBoxMarkup(options: SvgOptions, prepared: Prepared, linePass: LinePass, layers: Layers): SVGElement | null {
  if (!options.show.box || !options.data.cell) return null;
  const d = segmentsPath(prepared.boxEdges.flatMap(([a, b]) => linePass.spansOf(a, b, prepared.boxId)));
  return d
    ? layers.counted(svgEl("path", { d, fill: "none", stroke: options.boxColor, "stroke-width": BOX_LINE_WIDTH }))
    : null;
}

// The exact curves a boundary stretch of object `id` may lie on: its own, the outside object's own, and the crossing
// with it (the section of an atom or bond by the face of the polyhedron it meets). Each object's curves are built once.
function makeCurveLookup(options: SvgOptions, view: View, prepared: Prepared): CurveLookup {
  const screen = screenOf(view);
  const { built, points } = prepared;
  const own = (id: number): Curve[] => {
    const obj = built.objects[id - 1];
    if (obj.kind === "polyhedron")
      return edgeCurves(polyhedronEdges(topologyOf(options, prepared, obj.poly), points), screen);
    return ownCurves(obj, view);
  };
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
  return curveLookup(own, crossing);
}

// The section of an atom, dot or bond by the plane of a polyhedron face: a circle or an ellipse, projected.
function sectionCurves(
  other: InstanceObject,
  face: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  screen: (p: THREE.Vector3) => Pt,
): Curve[] {
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

// A thin shape is thin: a bond or dot whose projected diameter is under THIN_AS_LINE_PX is drawn as a line, not traced.
function isThin(view: View, obj: TracedObject): boolean {
  return (obj.kind === "cylinder" || obj.kind === "dot") && (radiusPx(view, obj) ?? Infinity) * 2 < THIN_AS_LINE_PX;
}
