// The polyhedra, as the SVG export draws them: their front faces (shaded per face), their hard edges, and the silhouette
// where front meets back. Also the touch maps that the atoms on their vertices sort against (recordTouch).
import { MathUtils, Vector2, Vector3 } from "three";
import { LOOK } from "../config";
import { el, pointList, segment, shadedBand, srgbHex } from "./markup";
import { type Ctx, type Face, type Shape, type Touch, outlineStroke, pointOf } from "./shape";
import type { View } from "./view";

const FACE_SEAM_WIDTH = 0.6; // px: a thin stroke in the face colour that hides hairline seams between one face's triangles
const EDGE_WIDTH = 1; // px: polyhedron edge lines
const HARD_EDGE_COS = Math.cos(MathUtils.degToRad(1)); // an edge is drawn when its two faces turn by more than 1 degree

// A polyhedron: its front faces (shaded per face), its hard edges, and the thick silhouette where front meets back.
// Ghost polyhedra (transparent) are drawn last, over their atoms, as the page does. Returns the touch maps the atoms use.
export function polyhedronShapes(ctx: Ctx): { shapes: Shape[]; touch: Touch } {
  const { o, view } = ctx;
  const shapes: Shape[] = [];
  const touch: Touch = { after: new Map(), before: new Map() };
  const topologies = new Map(o.data.topologies.map((t) => [t.id, t] as const));
  const maxRadius = Math.max(0, ...o.data.primitives.atoms.map((a) => a.radius));
  for (const poly of o.data.primitives.polyhedra) {
    const topo = topologies.get(poly.topology_id)!;
    const material = o.data.materials[poly.material_id];
    const alpha = material.alpha ?? 1;
    const ghost = alpha < 1;
    const rgb = material.base_color.slice(0, 3);
    const verts = topo.point_ids.map((id) => view.toCam(pointOf(ctx, id)));
    const mid = verts.reduce((sum, x) => sum.add(x), new Vector3()).divideScalar(verts.length);
    const faces = topo.faces.map((f) => faceOf(f, verts, mid, view));
    const screen = verts.map((c) => view.toScreen(c));
    const key = Math.max(...verts.map((c) => view.depth(c))) + (ghost ? maxRadius : 0);
    if (!ghost) recordTouch(touch, topo.point_ids, faces, key);

    const { edges, silhouette } = edgePaths(faces, screen, ghost);
    // The silhouette is a stroke with no fill, so paint-order has no effect on it. It is painted first and the faces
    // cover its inner half.
    let body = silhouette && o.outlines && !ghost
      ? el("path", { d: silhouette, fill: "none", ...outlineStroke(ctx, true), "stroke-linecap": "round" })
      : "";
    body += faceMarkup(ctx, faces, screen, rgb, alpha, ghost);
    if (edges) {
      body += el("path", { d: edges, fill: "none", stroke: ctx.edgeHex, "stroke-width": EDGE_WIDTH, "stroke-linecap": "round" });
    }
    shapes.push({ z: key, svg: el("g", {}, body) });
  }
  return { shapes, touch };
}

// The front faces: one flat fill each (the lit colour, or the shaded band), with a thin seam stroke; ghosts get a
// transparent fill instead.
function faceMarkup(ctx: Ctx, faces: Face[], screen: Vector2[], rgb: number[], alpha: number, ghost: boolean): string {
  let markup = "";
  for (const f of faces) {
    if (!f.front) continue;
    const fill = f.n.dot(ctx.light) >= LOOK.threshold ? srgbHex(rgb) : shadedBand(rgb, LOOK.dark);
    const style = ghost ? { "fill-opacity": alpha } : { stroke: fill, "stroke-width": FACE_SEAM_WIDTH, "stroke-linejoin": "round" };
    markup += el("polygon", { points: pointList(f.idx.map((i) => screen[i])), fill, ...style });
  }
  return markup;
}

// The edge paths: the hard edges that touch a front face (every edge of a ghost), and the silhouette, the edges with a
// front face on one side and a back face on the other.
function edgePaths(faces: Face[], screen: Vector2[], ghost: boolean): { edges: string; silhouette: string } {
  let edges = "";
  let silhouette = "";
  for (const e of edgesOf(faces)) {
    const hard = e.faces.length === 1 || e.faces[0].n.dot(e.faces[1].n) < HARD_EDGE_COS;
    const seg = segment(screen[e.i], screen[e.j]);
    const anyFront = e.faces.some((f) => f.front);
    const anyBack = e.faces.some((f) => !f.front);
    if (hard && (ghost || anyFront)) edges += seg;
    if (anyFront && anyBack) silhouette += seg;
  }
  return { edges, silhouette };
}

// The triangle with its normal pointing outward (away from the polyhedron's centre); index order follows the normal.
function faceOf(f: [number, number, number], verts: Vector3[], mid: Vector3, view: View): Face {
  let [i, j, k] = f;
  let n = new Vector3().subVectors(verts[j], verts[i]).cross(new Vector3().subVectors(verts[k], verts[i])).normalize();
  const centre = verts[i].clone().add(verts[j]).add(verts[k]).divideScalar(3);
  if (n.dot(centre.clone().sub(mid)) < 0) {
    [j, k] = [k, j];
    n = n.negate();
  }
  return { idx: [i, j, k], n, front: view.facing(n, centre) };
}

// Each undirected edge once, with the faces that share it.
function edgesOf(faces: Face[]): { i: number; j: number; faces: Face[] }[] {
  const edges = new Map<string, { i: number; j: number; faces: Face[] }>();
  for (const f of faces) {
    for (let e = 0; e < 3; e++) {
      const i = f.idx[e];
      const j = f.idx[(e + 1) % 3];
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!edges.has(key)) edges.set(key, { i, j, faces: [] });
      edges.get(key)!.faces.push(f);
    }
  }
  return [...edges.values()];
}

// Atoms on a polyhedron's vertices poke through its faces. A vertex touching a front-facing face has its front half in
// front of that face, so the atom goes after the polyhedron; any other vertex is behind the front faces and goes before.
function recordTouch(touch: Touch, ids: string[], faces: Face[], key: number): void {
  const touched = new Set(faces.filter((f) => f.front).flatMap((f) => f.idx));
  ids.forEach((id, i) => {
    if (touched.has(i)) touch.after.set(id, Math.max(touch.after.get(id) ?? -Infinity, key));
    else touch.before.set(id, Math.min(touch.before.get(id) ?? Infinity, key));
  });
}
