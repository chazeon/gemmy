// Build (or rebuild) everything drawn from a scene document: atoms, bonds and arrows as instanced meshes, polyhedra as
// one triangle soup per material, and the cell box. The framing numbers come from scene/bounds.ts (the Blender frame).
import * as THREE from "three";
import { baseDistance } from "../camera/framing";
import { ZOOM_MAX, ZOOM_MIN } from "../camera/view-state";
import { instanceGroups, isGhost, polyhedronGroups } from "../render/instancing";
import { cellEdges } from "../geom/cell";
import {
  SHAPES,
  boxMaterial,
  controls,
  disposeScene,
  edgeMaterial,
  instanced,
  orthoCamera,
  outlineOf,
  root,
  toon,
} from "../render/draw";
import type { Cell, Scene, Vec3 } from "../types";
import type { Bounds } from "./bounds";
import { type LoadedScene, type PolyTarget, loaded } from "../state";

// The orthographic far plane, in structure sizes from the camera. Only the orthographic camera's far plane is fixed
// here: the perspective one moves with the camera (camera/view.ts syncClip).
const ORTHO_FAR_EXTENTS = 40;

// Replace whatever is on show with `doc`, framed by `bounds`. The caller (ui/stage.ts) clears the selection and resizes.
export function load(doc: Scene, bounds: Bounds): void {
  disposeScene();
  loaded.value = build(doc, bounds);
}

// The scene's objects, built into a new LoadedScene (not yet on show).
function build(doc: Scene, bounds: Bounds): LoadedScene {
  const extent = bounds.extent;
  const centre = bounds.centre;
  frame(centre, extent);
  return {
    data: doc,
    points: new Map(doc.points.map((p) => [p.id, p])),
    polyhedra: doc.primitives.polyhedra,
    centre,
    extent,
    // A scene without a cell keeps the lattice of the scene before it.
    lattice: doc.cell ? latticeOf(doc.cell) : loaded.peek().lattice,
    ...addObjects(doc, root),
  };
}

// The objects a scene draws, added under `parent`: the structure's root on the stage, or the group of a thumbnail,
// which draws the scene apart from the stage. The atoms' and the bonds' groups are returned for the Atoms toggle and
// picking.
function addObjects(
  doc: Scene,
  parent: THREE.Object3D,
): Pick<LoadedScene, "atomGroup" | "bondGroup" | "polyGroup" | "polyTargets" | "box"> {
  const { atomGroup, bondGroup } = addAtomsBondsAndArrows(doc, parent);
  const { polyGroup, polyTargets } = addPolyhedra(doc, parent);
  const box = addCellBox(doc.cell, parent);
  return { atomGroup, bondGroup, polyGroup, polyTargets, box };
}

// Puts the structure's centre at the origin, and sets the camera's distance limits and far plane from its size.
function frame(centre: Vec3, extent: number): void {
  root.position.set(-centre[0], -centre[1], -centre[2]);
  orthoCamera.far = extent * ORTHO_FAR_EXTENTS;
  controls.minDistance = baseDistance(extent) / ZOOM_MAX;
  controls.maxDistance = baseDistance(extent) / ZOOM_MIN;
}

// The unit lattice vectors of the cell: the view buttons look along them.
function latticeOf(cell: Cell): THREE.Vector3[] {
  return cell.vectors.map((vec) => new THREE.Vector3(...vec).normalize());
}

type ShapeName = keyof typeof SHAPES;

// One InstancedMesh per (shape, material). Picking maps an instance back to its atom (`atoms`) or to its bond (`bonds`,
// undefined for an arrow's instance).
// An outline shell goes in the group of the mesh it outlines, so hiding that group (the Atoms toggle) hides it too.
// Returns the atoms' group and the bonds' group (the arrows are in the bonds' group too, with no bond).
function addAtomsBondsAndArrows(
  doc: Scene,
  parent: THREE.Object3D,
): { atomGroup: THREE.Group; bondGroup: THREE.Group } {
  const atomGroup = new THREE.Group();
  const bondGroup = new THREE.Group();
  const shapes = new Map<ShapeName, THREE.BufferGeometry>();
  for (const g of instanceGroups(doc)) {
    const shapeName: ShapeName = g.shape;
    let shape = shapes.get(shapeName);
    if (!shape) {
      shape = SHAPES[shapeName]();
      shapes.set(shapeName, shape);
    }
    const mesh = instanced(shape, toon(g.material, doc.materials), g.matrices);
    const isAtom = g.shape === "sphere";
    const owner = isAtom ? atomGroup : bondGroup;
    owner.add(mesh);
    mesh.userData = isAtom ? { atoms: g.refs } : { bonds: g.bonds };
    if (g.outlined) owner.add(outlineOf(mesh));
  }
  parent.add(atomGroup, bondGroup);
  return { atomGroup, bondGroup };
}

// One triangle soup per material, with flat faces wound outwards, and its edges as one set of line segments. Materials
// with alpha < 1 are see-through ghosts drawn after the opaque atoms. A click gives a triangle, and owner[] says which
// polyhedron it is.
function addPolyhedra(doc: Scene, parent: THREE.Object3D): { polyGroup: THREE.Group; polyTargets: PolyTarget[] } {
  const polyGroup = new THREE.Group();
  const polyTargets = new Array<PolyTarget>(doc.primitives.polyhedra.length);
  for (const g of polyhedronGroups(doc)) {
    const ghost = isGhost(doc.materials[g.material]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(g.positions, 3));
    geometry.computeVertexNormals(); // not indexed, so each face keeps its own normal
    const mesh = new THREE.Mesh(geometry, toon(g.material, doc.materials, { faces: true, ghost }));
    mesh.userData = { owner: g.owner };
    if (ghost) mesh.renderOrder = 1; // after the opaque atoms and bonds inside
    for (const [index, first, count] of g.ranges) {
      polyTargets[index] = { kind: "polyhedron", poly: doc.primitives.polyhedra[index], ghost, mesh, first, count };
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(g.edges, 3));
    polyGroup.add(mesh, new THREE.LineSegments(edgeGeometry, edgeMaterial));
    if (!ghost) polyGroup.add(outlineOf(mesh));
  }
  parent.add(polyGroup);
  return { polyGroup, polyTargets };
}

// The twelve edges of the cell's parallelepiped, drawn as line segments. Shown only when the scene has a cell.
function addCellBox(cell: Cell | null, parent: THREE.Object3D): THREE.LineSegments | null {
  if (!cell) return null;
  const boxGeometry = new THREE.BufferGeometry();
  boxGeometry.setAttribute("position", new THREE.Float32BufferAttribute(cellEdges(cell).flat(2), 3));
  const cellBox = new THREE.LineSegments(boxGeometry, boxMaterial);
  parent.add(cellBox);
  return cellBox;
}
