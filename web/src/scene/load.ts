// Build (or rebuild) everything drawn from a scene document: atoms, bonds and arrows as instanced meshes, polyhedra as
// one triangle soup per material, and the cell box. The framing numbers come from scene/bounds.ts (the Blender frame).
import * as THREE from "three";
import { baseDistance } from "../camera/framing";
import { ORTHO_FAR_EXTENTS, ZOOM_MAX, ZOOM_MIN } from "../camera/view";
import { instanceGroups, polyhedronGroups } from "../render/instancing";
import {
  SHAPES, boxMaterial, controls, disposeScene, edgeMaterial, instanced, outlineOf, orthoCamera, root, toon,
} from "../render/draw";
import { resize } from "../render/loop";
import { select } from "../ui/picking";
import type { Cell, Scene } from "../types";
import type { Bounds } from "./bounds";
import {
  atomGroup, centre, data, extent, outlineGroup, outlines, polyGroup, polyTargets, polyhedra, show,
  setAtomGroup, setBox, setCentre, setData, setExtent, setLattice, setOutlineGroup, setPoints, setPolyGroup,
  setPolyTargets, setPolyhedra, type PolyTarget,
} from "../state";

// Replace whatever is on show with `doc`, framed by `bounds`.
export function load(doc: Scene, bounds: Bounds): void {
  disposeScene();
  select(null);
  setData(doc);
  setPoints(new Map(doc.points.map((p) => [p.id, p])));
  setPolyhedra(doc.primitives.polyhedra);
  frame(bounds, doc.cell);
  addAtomsBondsAndArrows();
  addPolyhedra();
  addCellBox(doc.cell);
  resize();
}

// Put the structure's centre at the origin, and set the camera's distance limits and far plane from its size.
function frame(bounds: Bounds, cell: Cell | null): void {
  setCentre(bounds.centre);
  setExtent(bounds.extent);
  if (cell) setLattice(cell.vectors.map((vec) => new THREE.Vector3(...vec).normalize()));
  root.position.set(-centre[0], -centre[1], -centre[2]);
  orthoCamera.far = extent * ORTHO_FAR_EXTENTS;
  controls.minDistance = baseDistance(extent) / ZOOM_MAX;
  controls.maxDistance = baseDistance(extent) / ZOOM_MIN;
}

type ShapeName = keyof typeof SHAPES;

// One InstancedMesh per (shape, material). Picking maps an instance back to its atom, so only atoms carry `atoms`.
function addAtomsBondsAndArrows(): void {
  setAtomGroup(new THREE.Group());
  const bondGroup = new THREE.Group();
  setOutlineGroup(new THREE.Group());
  outlineGroup.visible = outlines;
  const shapes = new Map<ShapeName, THREE.BufferGeometry>();
  for (const g of instanceGroups(data)) {
    const shapeName: ShapeName = g.shape;
    let shape = shapes.get(shapeName);
    if (!shape) {
      shape = SHAPES[shapeName]();
      shapes.set(shapeName, shape);
    }
    const mesh = instanced(shape, toon(g.material), g.matrices);
    const isAtom = g.shape === "sphere";
    (isAtom ? atomGroup : bondGroup).add(mesh);
    if (isAtom) mesh.userData = { atoms: g.refs };
    if (g.outlined) outlineGroup.add(outlineOf(mesh));
  }
  atomGroup.visible = show.atoms;
  root.add(atomGroup, bondGroup, outlineGroup);
}

// One triangle soup per material, with flat faces wound outwards, and its edges as one set of line segments. Materials
// with alpha < 1 are see-through ghosts drawn after the opaque atoms. A click gives a triangle, and owner[] says which
// polyhedron it is.
function addPolyhedra(): void {
  setPolyGroup(new THREE.Group());
  setPolyTargets(new Array<PolyTarget>(polyhedra.length));
  for (const g of polyhedronGroups(data)) {
    const ghost = (data.materials[g.material].alpha ?? 1) < 1;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(g.positions, 3));
    geometry.computeVertexNormals(); // not indexed, so each face keeps its own normal
    const mesh = new THREE.Mesh(geometry, toon(g.material, { faces: true, ghost }));
    mesh.userData = { owner: g.owner };
    if (ghost) mesh.renderOrder = 1; // after the opaque atoms and bonds inside
    for (const [index, first, count] of g.ranges) {
      polyTargets[index] = { kind: "polyhedron", poly: polyhedra[index], ghost, mesh, first, count };
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(g.edges, 3));
    polyGroup.add(mesh, new THREE.LineSegments(edgeGeometry, edgeMaterial));
    if (!ghost) outlineGroup.add(outlineOf(mesh));
  }
  root.add(polyGroup);
}

// The twelve edges of the cell's parallelepiped, drawn as line segments. Shown only when the scene has a cell.
function addCellBox(cell: Cell | null): void {
  setBox(null);
  if (!cell) return;
  const positions: number[] = [];
  const corners = Array.from({ length: 8 }, (_, n) => cellCorner(cell, n));
  for (let n = 0; n < 8; n++) {
    for (let axis = 0; axis < 3; axis++) {
      const bit = 1 << axis;
      if (n & bit) continue; // each edge once: from the corner without this bit to the one with it
      positions.push(...corners[n], ...corners[n | bit]);
    }
  }
  const boxGeometry = new THREE.BufferGeometry();
  boxGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const cellBox = new THREE.LineSegments(boxGeometry, boxMaterial);
  setBox(cellBox);
  cellBox.visible = show.box;
  root.add(cellBox);
}

// Corner n of the cell: bit 0 steps along the first lattice vector, bit 1 along the second, bit 2 along the third.
function cellCorner(cell: Cell, n: number): number[] {
  const [a, b, c] = cell.vectors;
  return [0, 1, 2].map(
    (d) => cell.origin[d] + (n & 1) * a[d] + ((n >> 1) & 1) * b[d] + ((n >> 2) & 1) * c[d],
  );
}

