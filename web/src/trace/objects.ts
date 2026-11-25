// The objects the traced SVG draws, and the meshes that carry their ids. Each instance of an instanced group is one object
// (an atom, a bond piece, an arrow part), and each polyhedron is one object. The groups come from the same pure functions
// the live view builds its meshes from (render/instancing.ts), so the table lines up with what is on screen.
// An object's id is its table index plus one: id 0 is the background of the id render.
import * as THREE from "three";
import { instanced, SHAPES } from "../render/draw";
import { type InstanceGroup, instanceGroups, polyhedronGroups } from "../render/instancing";
import type { Scene, Vec3 } from "../types";

interface Common {
  material: string | null; // the material id; null for arrows
  alpha: number; // below 1 for a ghost polyhedron, drawn with this fill opacity
  outlined: boolean; // gets an outline in the SVG (the live view's outline shell)
  centre: Vec3; // scene position, for the back-to-front sort
}

// An instance of one shape: an atom, a bond, a dot, or an arrow part. Its matrix is the 16 numbers of the instance (a
// sphere's radius, a cylinder's axis, see candidates.ts).
export interface InstanceObject extends Common {
  kind: InstanceGroup["shape"];
  matrix: number[];
}

// A polyhedron: `poly` is its index in data.primitives.polyhedra.
export interface PolyhedronObject extends Common {
  kind: "polyhedron";
  poly: number;
}

export type TracedObject = InstanceObject | PolyhedronObject;

// What a mesh is for: a solid (drawn by the id, band and depth passes), its outline shell, a thin shape, or a line set.
export type Role = "solid" | "shell" | "thin" | "line";

// A mesh's userData: its role, and the shape it draws (a polyhedron's faces take the polygon offset in the passes).
export interface MeshRole {
  role: Role;
  shape?: string;
}

export const roleOf = (mesh: THREE.Object3D): MeshRole => mesh.userData as MeshRole;

export interface IdMeshes {
  objects: TracedObject[];
  meshes: THREE.Mesh[]; // each carries the per-object id as the attribute `objectId`; its material is set by the pass
  shells: THREE.Mesh[]; // the live view's outline shells of the outlined objects (the mask pass only)
  thin: THREE.Mesh[]; // the objects not kept in the passes (thin bonds, dots): drawn as lines, in the line pass only
}

// Builds the table and the meshes of every object. `material` is a placeholder: the passes swap in their own shader.
// `keep` decides which objects are drawn in the id, band and depth passes; the others (thin shapes, drawn as lines) get
// no pixels. Their ids stay reserved, so the table index still gives the id.
export function buildIdMeshes(data: Scene, material: THREE.Material, keep: (obj: TracedObject) => boolean = () => true): IdMeshes {
  const objects: TracedObject[] = [];
  const parts: MeshParts = { meshes: [], shells: [], thin: [] };
  for (const group of instanceGroups(data)) addInstanceGroup(group, objects, parts, material, keep);
  addPolyhedra(data, objects, parts, material);
  return { objects, ...parts };
}

type MeshParts = Omit<IdMeshes, "objects">;

// One instanced group: its objects (in table order), its kept instances as a mesh (and its outline shell), and the rest as
// thin meshes.
function addInstanceGroup(group: InstanceGroup, objects: TracedObject[], parts: MeshParts, material: THREE.Material, keep: (obj: TracedObject) => boolean): void {
  const first = objects.length + 1; // the id of instance 0
  const kept: number[] = [];
  const dropped: number[] = [];
  group.refs.forEach((_, i) => {
    const obj: TracedObject = { kind: group.shape, material: group.material, alpha: 1, outlined: group.outlined, centre: instanceCentre(group.matrices, i), matrix: group.matrices.slice(16 * i, 16 * i + 16) };
    objects.push(obj);
    (keep(obj) ? kept : dropped).push(i);
  });
  if (kept.length) {
    const mesh = instanceSet(group, first, kept, material);
    mesh.userData = { shape: group.shape, role: "solid" } satisfies MeshRole;
    parts.meshes.push(mesh);
    if (group.outlined) {
      // The live view's outline shell: the same geometry and matrices, drawn back-face (see passes.ts).
      const shell = instanceSet(group, first, kept, material);
      shell.userData = { shape: group.shape, role: "shell" } satisfies MeshRole;
      parts.shells.push(shell);
    }
  }
  if (dropped.length) {
    const mesh = instanceSet(group, first, dropped, material);
    mesh.userData = { shape: group.shape, role: "thin" } satisfies MeshRole;
    parts.thin.push(mesh);
  }
}

// Polyhedra: one object each, numbered after the instanced objects in scene order. Their triangles carry the id.
function addPolyhedra(data: Scene, objects: TracedObject[], parts: MeshParts, material: THREE.Material): void {
  const points = new Map(data.points.map((p) => [p.id, p.position] as const));
  const polyBase = objects.length; // polyhedron p has id polyBase + p + 1
  data.primitives.polyhedra.forEach((poly, index) => {
    const alpha = data.materials[poly.material_id].alpha ?? 1;
    objects.push({
      kind: "polyhedron",
      material: poly.material_id,
      alpha,
      outlined: alpha >= 1,
      centre: points.get(poly.center_point_id)!,
      poly: index,
    });
  });
  for (const group of polyhedronGroups(data)) {
    const ids = new Float32Array(group.owner.length * 3); // three vertices per triangle
    group.owner.forEach((p, t) => ids.fill(polyBase + p + 1, t * 3, t * 3 + 3));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(group.positions, 3));
    geometry.setAttribute("objectId", new THREE.BufferAttribute(ids, 1));
    geometry.computeVertexNormals(); // not indexed, so each face keeps its own normal, as the live view
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { shape: "polyhedron", role: "solid" } satisfies MeshRole;
    parts.meshes.push(mesh);
    // A see-through polyhedron (alpha < 1) has no shell in the live view.
    if (group.material && (data.materials[group.material].alpha ?? 1) >= 1) {
      const shell = new THREE.Mesh(geometry, material);
      shell.userData = { shape: "polyhedron", role: "shell" } satisfies MeshRole;
      parts.shells.push(shell);
    }
  }
}

// The translation column of instance i's matrix (16 numbers, column-major): where the instance sits.
function instanceCentre(matrices: readonly number[], i: number): Vec3 {
  return [matrices[16 * i + 12], matrices[16 * i + 13], matrices[16 * i + 14]];
}

// One instanced mesh of the given instances of a group. Each instance carries its table id (first + index) as objectId.
function instanceSet(group: InstanceGroup, first: number, indices: number[], material: THREE.Material): THREE.Mesh {
  const ids = new Float32Array(indices.length);
  indices.forEach((i, k) => (ids[k] = first + i));
  const matrices = indices.flatMap((i) => group.matrices.slice(16 * i, 16 * i + 16));
  const geometry = SHAPES[group.shape]();
  geometry.setAttribute("objectId", new THREE.InstancedBufferAttribute(ids, 1));
  return instanced(geometry, material, matrices);
}
