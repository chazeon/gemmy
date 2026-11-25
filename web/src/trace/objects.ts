// The objects the traced SVG draws, and the meshes that carry their ids. Each instance of an instanced group is one object
// (an atom, a bond piece, an arrow part), and each polyhedron is one object. The groups come from the same pure functions
// the live view builds its meshes from (render/instancing.ts), so the table lines up with what is on screen.
// An object's id is its table index plus one: id 0 is the background of the id render.
import * as THREE from "three";
import { instanced, SHAPES } from "../render/draw";
import { type InstanceGroup, instanceGroups, polyhedronGroups } from "../render/instancing";
import type { Scene, Vec3 } from "../types";

export interface TracedObject {
  kind: string; // the instance shape ("sphere" atoms, "cylinder" bonds and arrow shafts, "dot", "cone") or "polyhedron"
  material: string | null; // the material id; null for arrows
  alpha: number; // below 1 for a ghost polyhedron, drawn with this fill opacity
  outlined: boolean; // gets an outline in the SVG (the live view's outline shell)
  centre: Vec3; // scene position, for the back-to-front sort
  poly?: number; // for a polyhedron: its index in data.primitives.polyhedra
  matrix?: number[]; // for an instance: its 16 matrix numbers (a sphere's radius, a cylinder's axis, see exact.ts)
}

interface IdMeshes {
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
  const meshes: THREE.Mesh[] = [];
  const shells: THREE.Mesh[] = [];
  const thin: THREE.Mesh[] = [];
  for (const group of instanceGroups(data)) {
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
      mesh.userData = { shape: group.shape };
      meshes.push(mesh);
      if (group.outlined) {
        // The live view's outline shell: the same geometry and matrices, drawn back-face (see passes.ts).
        const shell = instanceSet(group, first, kept, material);
        shell.userData = { shape: group.shape, shell: true };
        shells.push(shell);
      }
    }
    if (dropped.length) {
      const mesh = instanceSet(group, first, dropped, material);
      mesh.userData = { shape: group.shape, thin: true };
      thin.push(mesh);
    }
  }

  // Polyhedra: one object each, numbered after the instanced objects in scene order. Their triangles carry the id.
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
    mesh.userData = { shape: "polyhedron" };
    meshes.push(mesh);
    // A see-through polyhedron (alpha < 1) has no shell in the live view.
    if (group.material && (data.materials[group.material].alpha ?? 1) >= 1) {
      const shell = new THREE.Mesh(geometry, material);
      shell.userData = { shape: "polyhedron", shell: true };
      shells.push(shell);
    }
  }
  return { objects, meshes, shells, thin };
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
