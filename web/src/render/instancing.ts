// The instance matrices and merged triangle lists of a scene, built by pure functions (no DOM). The node test entry
// (test/entry.ts) bundles this file.
//
// Everything drawn is a unit shape placed by a 4x4 matrix: a sphere of radius 1, and a cylinder and a cone of radius 1
// and height 1 along +y, centred. One draw call then covers every instance that shares a shape and a material.
import { MathUtils, Matrix4, Quaternion, Vector3 } from "three";
import { ARROW, DASH, DOT, EPS } from "../config";
import { dashSegments, dotCentres } from "../geom/dashes";
import { shapeOf } from "../geom/flatness";
import { lerp, meanOf, span, vcross, vdot, vsub, vunit } from "../geom/vector";
import type { AtomPrimitive, BondPrimitive, DisplacementPrimitive, Material, Scene, Topology, Vec3 } from "../types";

// ---- constants ----
// The numbers in one instance's matrix: a column-major 4x4 matrix, as alongMatrix and sphereMatrix write it.
export const MATRIX_SIZE = 16;
const UP = new Vector3(0, 1, 0); // the unit cylinder and cone point along +y
// Arrow proportions, the rules of geom.arrow_parts on the Blender side.
const HEAD_MIN_RADII = 3; // the head is at least three arrow radii long
const HEAD_MAX_SHARE = 0.8; // and at most 80% of the arrow
const SHAFT_MIN_SHARE = 0.2; // the shaft keeps at least 20% of the arrow
const HEAD_CENTRE_SHARE = 0.5; // the head's centre is half its own length past the end of the shaft
// A displacement drawn as a line (mode "line") is a cylinder this share of the arrow radius.
const LINE_RADIUS_SHARE = 0.7;
// Polyhedron edges are drawn where the two faces on either side meet at more than this angle (degrees): the live view
// and the SVG trace both use hardEdges.
const HARD_EDGE_ANGLE_DEG = 1;

// The kinds of instanced mesh, by shape and material. `outlined` is whether the mesh gets an outline shell. refs[i] is
// the atom instance i stands for, and bonds[i] the bond it comes from (a dash or a dot, or a solid bond's cylinder); both
// are undefined or null for the rest, the arrows among them.
export interface InstanceGroup {
  shape: "sphere" | "cylinder" | "dot" | "cone";
  material: string | null;
  outlined: boolean;
  matrices: number[];
  refs: (AtomPrimitive | null)[];
  bonds: (BondPrimitive | undefined)[];
}

// All polyhedra of one material as one triangle soup. `owner` gives, per triangle, the index of its polyhedron, and
// `ranges` lists [polyhedron index, first triangle, triangle count] for each polyhedron, in order.
interface PolyhedronGroup {
  material: string;
  positions: number[];
  edges: number[];
  owner: number[];
  ranges: [number, number, number][];
}

interface Face {
  idx: [number, number, number]; // corner indices into the polyhedron's points, wound outwards
  n: number[]; // the outward unit normal
}

// Collects the instances of a scene into groups, by what one draw call can share: the shape, the material and whether
// the instance is outlined. Dashes and dots get no outline.
class InstanceCollector {
  private readonly groups = new Map<string, InstanceGroup>();

  // Adds one instance to its group, creating the group the first time.
  add(
    shape: InstanceGroup["shape"],
    material: string | null,
    outlined: boolean,
    matrix: readonly number[],
    ref: AtomPrimitive | null = null,
    bond?: BondPrimitive,
  ): void {
    const key = `${shape}|${material}|${outlined}`;
    let group = this.groups.get(key);
    if (!group) {
      group = { shape, material, outlined, matrices: [], refs: [], bonds: [] };
      this.groups.set(key, group);
    }
    group.matrices.push(...matrix);
    group.refs.push(ref);
    group.bonds.push(bond);
  }

  // A cylinder from a to b, centred on the midpoint. Two coincident ends draw nothing.
  cylinder(
    a: readonly number[],
    b: readonly number[],
    radius: number,
    material: string | null,
    outlined: boolean,
    bond?: BondPrimitive,
  ): void {
    const len = span(a, b);
    if (len <= EPS) return;
    this.add("cylinder", material, outlined, alongMatrix(lerp(a, b, 0.5), vunit(vsub(b, a)), radius, len), null, bond);
  }

  groupList(): InstanceGroup[] {
    return [...this.groups.values()];
  }
}

// Every instance of the scene, grouped by what one draw call can share: "sphere" (atoms), "cylinder" (bonds, dashes,
// arrow shafts), "dot" (dotted bonds), "cone" (arrow heads).
export function instanceGroups(data: Scene): InstanceGroup[] {
  const pos = pointPositions(data);
  const collector = new InstanceCollector();
  const { atoms, bonds, displacements } = data.primitives;
  for (const atom of atoms) {
    collector.add("sphere", atom.material_id, true, sphereMatrix(pos.get(atom.point_id)!, atom.radius), atom);
  }
  for (const bond of bonds) addBond(collector, bond, pos);
  for (const d of displacements) addDisplacement(collector, d, pos);
  return collector.groupList();
}

// All polyhedra of one material as one triangle soup: flat faces wound outwards, plus their hard edges as line
// segments.
export function polyhedronGroups(data: Scene): PolyhedronGroup[] {
  const pos = pointPositions(data);
  const topologies = new Map<string, Topology>(data.topologies.map((t) => [t.id, t]));
  const groups = new Map<string, PolyhedronGroup>();
  data.primitives.polyhedra.forEach((poly, index) => {
    const topo = topologies.get(poly.topology_id)!;
    const v = topo.point_ids.map((id) => pos.get(id)!);
    const group = polyhedronGroupFor(groups, poly.material_id);
    const first = group.owner.length;
    const faces = outwardFaces(v, topo.faces);
    addFaces(group, faces, v, index);
    for (const [a, b] of hardEdges(topo, pos)) group.edges.push(...a, ...b);
    group.ranges.push([index, first, faces.length]);
  });
  return [...groups.values()];
}

// ---- instances: bonds and displacements ----
// Every instance of a bond carries the bond, so a pick can find the bond from any of its dashes or dots.
function addBond(collector: InstanceCollector, bond: BondPrimitive, pos: Map<string, Vec3>): void {
  const a = pos.get(bond.a_point_id)!;
  const b = pos.get(bond.b_point_id)!;
  const style = bond.style ?? "solid";
  if (style === "dashed") addDashes(collector, a, b, bond);
  else if (style === "dotted") addDots(collector, a, b, bond);
  else collector.cylinder(a, b, bond.radius, bond.material_id, true, bond);
}

// A dashed bond: cylinders of a dash length in bond radii (with a floor), each followed by a gap.
function addDashes(collector: InstanceCollector, a: Vec3, b: Vec3, bond: BondPrimitive): void {
  const dash = Math.max(DASH.length * bond.radius, DASH.min);
  const gap = (dash * DASH.gap) / DASH.length;
  for (const [start, end] of dashSegments(a, b, dash, gap)) {
    collector.cylinder(start, end, bond.radius, bond.material_id, false, bond);
  }
}

// A dotted bond: spheres along the bond, spaced in bond radii (with a floor).
function addDots(collector: InstanceCollector, a: Vec3, b: Vec3, bond: BondPrimitive): void {
  const spacing = Math.max(DOT.spacing * bond.radius, DOT.spacingMin);
  for (const centre of dotCentres(a, b, spacing)) {
    collector.add("dot", bond.material_id, false, sphereMatrix(centre, DOT.radius * bond.radius), null, bond);
  }
}

// A displacement from its start atom. With anchor "tip" the atom is the arrow's tip; with "tail" it is the tail. The
// scene's per-displacement radius is not used: the viewer takes Blender's default ArrowStyle radius (ARROW.radius).
function addDisplacement(collector: InstanceCollector, d: DisplacementPrimitive, pos: Map<string, Vec3>): void {
  const start = pos.get(d.start_point_id)!;
  const atomIsTip = d.anchor === "tip";
  const tail = atomIsTip ? vsub(start, d.vector) : start;
  const tip = atomIsTip ? start : start.map((x, i) => x + d.vector[i]);
  if ((d.mode ?? "arrow").toLowerCase() === "arrow") addArrow(collector, tail, tip, ARROW.radius);
  else collector.cylinder(tail, tip, ARROW.radius * LINE_RADIUS_SHARE, null, true);
}

// An arrow from a to b: a shaft cylinder and a cone head, the head's length as in geom.arrow_parts. Blender draws arrows
// without an outline; the viewer outlines them (known difference, fixed separately).
function addArrow(collector: InstanceCollector, a: readonly number[], b: readonly number[], radius: number): void {
  const len = span(a, b);
  if (len <= EPS) return;
  const dir: number[] = vunit(vsub(b, a));
  const headLen = Math.min(Math.max(len * ARROW.headLengthRatio, radius * HEAD_MIN_RADII), len * HEAD_MAX_SHARE);
  const shaftLen = Math.max(len - headLen, len * SHAFT_MIN_SHARE);
  const shaftEnd = a.map((x, i) => x + dir[i] * shaftLen);
  collector.cylinder(a, shaftEnd, radius, null, true);
  const headCentre = shaftEnd.map((x, i) => x + dir[i] * headLen * HEAD_CENTRE_SHARE);
  collector.add("cone", null, true, alongMatrix(headCentre, dir, radius * ARROW.headRadiusRatio, headLen));
}

// ---- polyhedra ----
function polyhedronGroupFor(groups: Map<string, PolyhedronGroup>, material: string): PolyhedronGroup {
  let group = groups.get(material);
  if (!group) {
    group = { material, positions: [], edges: [], owner: [], ranges: [] };
    groups.set(material, group);
  }
  return group;
}

// Does every face come with its reverse? compile/polyhedra.py draws a flat polygon from both sides, so a two-sided
// topology says the compiler found it flat.
function isTwoSided(triangles: [number, number, number][]): boolean {
  const keys = new Set(triangles.map((f) => f.join(",")));
  return triangles.every(([i, j, k]) => keys.has([i, k, j].join(",")));
}

// Each triangle of a polyhedron, wound so its normal points away from the polyhedron's centre. A flat polygon (see
// geom/flatness.ts) has no inside, so its compiled winding is kept, as is a two-sided topology's.
function outwardFaces(v: Vec3[], triangles: [number, number, number][]): Face[] {
  const isFlat = isTwoSided(triangles) || shapeOf(v).kind !== "space";
  const mid = meanOf(v);
  return triangles.map(([i, j, k]): Face => {
    const n: number[] = vunit(vcross(vsub(v[j], v[i]), vsub(v[k], v[i])));
    const outwardness = vdot(n, vsub(meanOf([v[i], v[j], v[k]]), mid));
    const isOutward = outwardness >= 0;
    return isFlat || isOutward ? { idx: [i, j, k], n } : { idx: [i, k, j], n: n.map((x) => -x) };
  });
}

function addFaces(group: PolyhedronGroup, faces: Face[], v: Vec3[], index: number): void {
  for (const f of faces) {
    group.positions.push(...v[f.idx[0]], ...v[f.idx[1]], ...v[f.idx[2]]);
    group.owner.push(index);
  }
}

// One copy of each reversed pair of faces (the same three corners in either winding), so a two-sided polygon's fan is
// counted once: its diagonals then have two faces meeting flat, and its outline has one face each.
function oneCopyPerPair(faces: Face[]): Face[] {
  const seen = new Set<string>();
  return faces.filter((f) => {
    const key = [...f.idx].sort((a, b) => a - b).join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The hard edges of a polyhedron, each once: an edge with one face (a boundary), or whose two faces meet at a sharp angle.
export function hardEdges(topo: Topology, points: Map<string, Vec3>): [Vec3, Vec3][] {
  const v = topo.point_ids.map((id) => points.get(id)!);
  const faces = oneCopyPerPair(outwardFaces(v, topo.faces));
  const sides = new Map<string, { i: number; j: number; faces: Face[] }>();
  for (const f of faces) {
    for (let e = 0; e < 3; e++) {
      const i = f.idx[e];
      const j = f.idx[(e + 1) % 3];
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!sides.has(key)) sides.set(key, { i, j, faces: [] });
      sides.get(key)!.faces.push(f);
    }
  }
  const sharpAngle = Math.cos(MathUtils.degToRad(HARD_EDGE_ANGLE_DEG));
  const edges: [Vec3, Vec3][] = [];
  for (const side of sides.values()) {
    const boundary = side.faces.length === 1;
    const sharp = !boundary && vdot(side.faces[0].n, side.faces[1].n) < sharpAngle;
    if (boundary || sharp) edges.push([v[side.i], v[side.j]]);
  }
  return edges;
}

// A see-through material (alpha below 1): its polyhedra are drawn as ghosts, with no outline shell.
export const isGhost = (material: Material): boolean => material.alpha < 1;

// ---- matrices ----
function pointPositions(data: Scene): Map<string, Vec3> {
  return new Map(data.points.map((p) => [p.id, p.position] as [string, Vec3]));
}

// A sphere of radius r centred on c.
function sphereMatrix(c: readonly number[], r: number): number[] {
  return [r, 0, 0, 0, 0, r, 0, 0, 0, 0, r, 0, c[0], c[1], c[2], 1];
}

// The unit cylinder or cone placed along the unit vector d: `length` long, `radius` across, centred on `centre`.
export function alongMatrix(centre: readonly number[], d: readonly number[], radius: number, length: number): number[] {
  const turn = new Quaternion().setFromUnitVectors(UP, new Vector3(...d));
  const scale = new Vector3(radius, length, radius);
  return new Matrix4().compose(new Vector3(...centre), turn, scale).toArray();
}
