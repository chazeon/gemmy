// The lines of the view that are not fills: a polyhedron's hard edges, the cell box, and the thin bonds drawn as lines. Their
// visibility is not computed here: the line pass (passes.ts) renders them with three.js, and each sample asks whether its
// pixel shows that line's id.
import * as THREE from "three";
import type { Cell, Topology, Vec3 } from "../types";
import type { Pt } from "./curves";
import type { Passes } from "./buffers";
import type { Project, Projected } from "./passes";

// A polyhedron edge is drawn where its two faces turn by more than this angle (degrees), or where it has only one face.
const HARD_EDGE_DEG = 1;
// Spacing of the visibility samples along an edge, in output px. Each visible run ends within one spacing of the true end.
const SAMPLE_SPACING_PX = 0.5;
// The most samples a line may take, in multiples of the image's size: a segment longer than this (in render px) is never
// reached in practice, so a runaway count (an endpoint projected to infinity) stops here instead of hanging the export.
const MAX_SAMPLES_PER_IMAGE_EDGE = 4;
// The NDC depth range of the view: an endpoint outside it is behind the near plane or past the far one.
const NDC_DEPTH_MIN = -1;
const NDC_DEPTH_MAX = 1;
// The runs of consecutive samples 0..count (inclusive) where `on` holds, as [first, last] sample indices.
export function runsWhere(count: number, on: (k: number) => boolean): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= count; k++) {
    const now = on(k);
    if (now && start < 0) start = k;
    if ((!now || k === count) && start >= 0) {
      runs.push([start, now ? k : k - 1]);
      start = -1;
    }
  }
  return runs;
}

// The line pass (passes.ts) read per line: a sample of a 3D segment counts as visible when its pixels show that line's id.
// Three.js has done the depth test, so there is no depth tolerance here. A sample counts when any of its 3x3 pixels shows the
// id, because a one-pixel line can leave a sample just beside it. Each span ends within one sample spacing of the true end.
export class LinePass {
  constructor(
    readonly project: Project,
    private readonly passes: Passes,
    readonly scale: number, // render px per CSS px
  ) {}

  // The visible spans of the segment a-b of line `id`, as CSS px segments.
  spansOf(a: THREE.Vector3, b: THREE.Vector3, id: number): [Pt, Pt][] {
    const pa = this.project(a);
    const pb = this.project(b);
    // An endpoint that is not finite, or outside the depth range (behind the camera), has no screen position to sample: the
    // line is left out rather than projected to infinity.
    if (!onScreen(pa) || !onScreen(pb)) return [];
    const outputLength = Math.hypot(pb.x - pa.x, pb.y - pa.y) / this.scale;
    const sampleLimit = (MAX_SAMPLES_PER_IMAGE_EDGE * (this.passes.width + this.passes.height)) / SAMPLE_SPACING_PX;
    const count = Math.min(sampleLimit, Math.max(1, Math.ceil(outputLength / SAMPLE_SPACING_PX)));
    const visible = (k: number) => {
      const p = this.project(a.clone().lerp(b, k / count));
      return this.shows(id, Math.floor(p.x), Math.floor(p.y));
    };
    return runsWhere(count, visible).map(([first, last]): [Pt, Pt] => [this.cssAt(a, b, first / count), this.cssAt(a, b, last / count)]);
  }

  // Whether any pixel of the 3x3 block around (x, y) shows line `id`.
  shows(id: number, x: number, y: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.passes.lineIdAt(x + dx, y + dy) === id) return true;
      }
    }
    return false;
  }

  private cssAt(a: THREE.Vector3, b: THREE.Vector3, t: number): Pt {
    const p = this.project(a.clone().lerp(b, t));
    return [p.x / this.scale, p.y / this.scale];
  }
}

// Whether a projected point has a finite screen position and lies inside the depth range.
export function onScreen(p: Projected): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.depth >= NDC_DEPTH_MIN && p.depth <= NDC_DEPTH_MAX;
}

// The hard edges of one polyhedron, as 3D segments: each edge once, where it has one face or two faces at a sharp angle.
export function hardEdges(topo: Topology, points: Map<string, Vec3>): [THREE.Vector3, THREE.Vector3][] {
  const v = topo.point_ids.map((id) => new THREE.Vector3(...points.get(id)!));
  const normals = topo.faces.map(([i, j, k]) => new THREE.Triangle(v[i], v[j], v[k]).getNormal(new THREE.Vector3()));
  const sides = new Map<string, { i: number; j: number; faces: THREE.Vector3[] }>();
  topo.faces.forEach(([i, j, k], f) => {
    for (const [p, q] of [[i, j], [j, k], [k, i]]) {
      const key = p < q ? `${p}-${q}` : `${q}-${p}`;
      if (!sides.has(key)) sides.set(key, { i: p, j: q, faces: [] });
      sides.get(key)!.faces.push(normals[f]);
    }
  });
  const hardEdgeCosine = Math.cos(THREE.MathUtils.degToRad(HARD_EDGE_DEG));
  const edges: [THREE.Vector3, THREE.Vector3][] = [];
  for (const side of sides.values()) {
    // The sign of a normal depends on the face's winding, so the test uses the absolute dot product.
    const hard = side.faces.length === 1 || Math.abs(side.faces[0].dot(side.faces[1])) < hardEdgeCosine;
    if (hard) edges.push([v[side.i], v[side.j]]);
  }
  return edges;
}

// The twelve edges of the cell, as 3D segments (the same corners and edges as load.ts's cell box).
export function cellEdges(cell: Cell): [THREE.Vector3, THREE.Vector3][] {
  const [a, b, c] = cell.vectors.map((vec) => new THREE.Vector3(...vec));
  const origin = new THREE.Vector3(...cell.origin);
  const corner = (n: number) => origin.clone().addScaledVector(a, n & 1).addScaledVector(b, (n >> 1) & 1).addScaledVector(c, (n >> 2) & 1);
  const edges: [THREE.Vector3, THREE.Vector3][] = [];
  for (let n = 0; n < 8; n++) {
    for (let axis = 0; axis < 3; axis++) {
      const bit = 1 << axis;
      if (n & bit) continue; // each edge once: from the corner without this bit to the one with it
      edges.push([corner(n), corner(n | bit)]);
    }
  }
  return edges;
}
