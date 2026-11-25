// Picking: a click selects the atom, bond or polyhedron under it, shows its readout and highlights it in the scene. A pick
// also opens the details panel (panels.ts), and the readout's text comes from readout.ts.
import * as THREE from "three";
import type { BondPrimitive } from "../types";
import { renderer } from "../render/draw";
import { camera, loaded, requestRender, type Target, type PolyTarget } from "../state";
import { describe } from "./readout";
import { showInfo } from "./panels";
import { glideTarget } from "../camera/view";
import { POINTER_SLOP_PX } from "../config";

// ---- the selection highlight ----
// The selection is drawn as an extra mesh over the picked atom, bond or polyhedron: a copy of its material, lit up by an
// emissive term and pulled slightly forward. The instanced and merged meshes themselves are never touched.
const HIGHLIGHT_GLOW = 0.55; // emissive as a fraction of the object's own colour
const PULL_FORWARD = -1; // pulled slightly forward, so the highlight wins the depth test against the original
const GHOST_RENDER_ORDER = 2; // a see-through polyhedron is drawn over its own blended faces
const FLOATS_PER_TRIANGLE = 3 * 3; // three vertices of three numbers each

type AtomTarget = Extract<Target, { kind: "atom" }>;
type BondTarget = Extract<Target, { kind: "bond" }>;

let highlight: THREE.Mesh | null = null;

function clearHighlight() {
  if (!highlight) return;
  highlight.removeFromParent();
  (highlight.material as THREE.Material).dispose();
  if (highlight.userData.own) highlight.geometry.dispose();
  if (highlight instanceof THREE.InstancedMesh) highlight.dispose(); // frees its instance matrices on the GPU
  highlight = null;
}
function highlightMaterial(base: THREE.MeshToonMaterial): THREE.MeshToonMaterial {
  const material = base.clone();
  material.emissive = base.color.clone().multiplyScalar(HIGHLIGHT_GLOW);
  Object.assign(material, { polygonOffset: true, polygonOffsetFactor: PULL_FORWARD, polygonOffsetUnits: PULL_FORWARD });
  return material;
}
function highlightAtom(target: AtomTarget): THREE.Mesh {
  const mesh = new THREE.Mesh(target.mesh.geometry, highlightMaterial(target.mesh.material as THREE.MeshToonMaterial));
  target.mesh.getMatrixAt(target.index, mesh.matrix); // the copy sits where the picked instance sits
  mesh.matrixAutoUpdate = false;
  loaded.value.atomGroup.add(mesh);
  return mesh;
}
// A bond's instances (one, or the dashes or dots of a bond) are copied into a new instanced mesh, sharing the geometry.
function highlightBond(target: BondTarget): THREE.InstancedMesh {
  const material = highlightMaterial(target.mesh.material as THREE.MeshToonMaterial);
  const mesh = new THREE.InstancedMesh(target.mesh.geometry, material, target.indices.length);
  const matrix = new THREE.Matrix4();
  target.indices.forEach((index, copy) => {
    target.mesh.getMatrixAt(index, matrix);
    mesh.setMatrixAt(copy, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  loaded.value.bondGroup.add(mesh);
  return mesh;
}
// A polyhedron's triangles are a range of its material's merged mesh, so the highlight copies that range.
function highlightPolyhedron(target: PolyTarget): THREE.Mesh {
  const from = target.first * FLOATS_PER_TRIANGLE,
    to = (target.first + target.count) * FLOATS_PER_TRIANGLE;
  const geometry = new THREE.BufferGeometry();
  for (const name of ["position", "normal"]) {
    const values = target.mesh.geometry.getAttribute(name).array.slice(from, to);
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, 3));
  }
  const mesh = new THREE.Mesh(geometry, highlightMaterial(target.mesh.material as THREE.MeshToonMaterial));
  mesh.userData.own = true; // its own geometry, so it is disposed with the highlight
  mesh.renderOrder = target.ghost ? GHOST_RENDER_ORDER : 0;
  loaded.value.polyGroup.add(mesh);
  return mesh;
}

// Whether something is selected (the pivot rule, ui/pivot.ts).
export const hasSelection = (): boolean => highlight !== null;

// Selects a target (or clears the selection), shows its readout and redraws.
export function select(target: Target | null) {
  clearHighlight();
  if (target) highlight = highlightOf(target);
  describe(target);
  requestRender();
}
function highlightOf(target: Target): THREE.Mesh {
  switch (target.kind) {
    case "atom":
      return highlightAtom(target);
    case "bond":
      return highlightBond(target);
    case "polyhedron":
      return highlightPolyhedron(target);
  }
}

// ---- picking ----
// What a ray hit stands for: an instanced atom or bond (by instanceId), or a triangle of a merged polyhedron mesh.
function targetOf(hit: THREE.Intersection): Target {
  const mesh = hit.object;
  if (mesh.userData.atoms) {
    const index = hit.instanceId!; // an instanced hit always has an instanceId
    return { kind: "atom", atom: mesh.userData.atoms[index], mesh: mesh as THREE.InstancedMesh, index };
  }
  if (mesh.userData.bonds) return bondTargetOf(mesh as THREE.InstancedMesh, hit.instanceId!);
  const face = hit.faceIndex!; // a merged polyhedron hit always has a faceIndex
  return loaded.value.polyTargets[mesh.userData.owner[face]];
}
// The bond of an instance, with every instance of that bond in the same mesh (its dashes or dots).
function bondTargetOf(mesh: THREE.InstancedMesh, index: number): BondTarget {
  const bonds: (BondPrimitive | undefined)[] = mesh.userData.bonds;
  const bond = bonds[index]!; // isPickable: a hit on an arrow is not a bond, and hitAt drops it
  const indices = bonds.flatMap((b, i) => (b === bond ? [i] : []));
  return { kind: "bond", bond, mesh, indices };
}
// Whether a hit is picked: every atom and polyhedron, and a bond's instance (an arrow's instance is not).
function isPickable(hit: THREE.Intersection): boolean {
  const bonds: (BondPrimitive | undefined)[] | undefined = hit.object.userData.bonds;
  return !bonds || bonds[hit.instanceId!] !== undefined;
}
// The meshes a click can hit: the atoms (while they are shown), the bonds (while they are shown) and the polyhedron
// meshes. The arrows share the bonds' group, and isPickable leaves their instances out.
function pickableObjects(): THREE.Object3D[] {
  const { atomGroup, bondGroup, polyGroup } = loaded.value;
  const atoms = atomGroup.visible ? atomGroup.children.filter((o) => o.userData.atoms) : [];
  const bonds = bondGroup.visible ? bondGroup.children.filter((o) => o.userData.bonds) : [];
  const polys = polyGroup.children.filter((o) => (o as THREE.Mesh).isMesh && o.userData.owner);
  return [...atoms, ...bonds, ...polys];
}

const ray = new THREE.Raycaster();
// The nearest hit under a screen position, or null. A see-through polyhedron does not block the atoms behind its front,
// so a ghost is taken only when nothing else is hit.
function hitAt(clientX: number, clientY: number): THREE.Intersection | null {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera.value);
  const hits = ray.intersectObjects(pickableObjects(), false).filter(isPickable);
  return hits.find((h) => !isGhostHit(h)) ?? hits[0] ?? null;
}
function isGhostHit(hit: THREE.Intersection): boolean {
  const target = targetOf(hit);
  return target.kind === "polyhedron" && target.ghost;
}

// The world point a screen position hits (the atoms, bonds and polyhedra a click can pick), or null when it hits nothing.
// Rotation pivots on the ray to this point (camera/view.ts).
export function pickPointAt(clientX: number, clientY: number): THREE.Vector3 | null {
  const hit = hitAt(clientX, clientY);
  return hit ? hit.point.clone() : null;
}

// A click is a press and a release close together; a drag (a rotate) is not a pick.
// Two clicks close in time and place are a double-click. Pointer events give a mouse and a double-tap the same way, so
// touch needs no code of its own.
const DOUBLE_CLICK_MS = 350; // about the browsers' own double-click time
const DOUBLE_CLICK_SLOP_PX = 10; // a second tap may land a little way from the first
let pressedAt: [number, number] | null = null;
let lastClick: { at: number; x: number; y: number } | null = null;

// Whether this click completes a double-click. A pair is used up, so a third click starts a new one.
function completesDoubleClick(e: PointerEvent): boolean {
  const previous = lastClick;
  lastClick = { at: e.timeStamp, x: e.clientX, y: e.clientY };
  if (!previous) return false;
  const quick = e.timeStamp - previous.at <= DOUBLE_CLICK_MS;
  const near = Math.hypot(e.clientX - previous.x, e.clientY - previous.y) <= DOUBLE_CLICK_SLOP_PX;
  if (!quick || !near) return false;
  lastClick = null;
  return true;
}

// Wires the canvas's clicks. `releaseRotation` lets go of the rotation's pivot when a click clears the selection (the
// pivot's own module is pivot.ts; main.ts passes it, so picking.ts and pivot.ts do not import each other).
export function wirePicking(releaseRotation: () => void): void {
  renderer.domElement.addEventListener("pointerdown", (e) => {
    pressedAt = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!pressedAt) return;
    if (Math.hypot(e.clientX - pressedAt[0], e.clientY - pressedAt[1]) > POINTER_SLOP_PX) return;
    const double = completesDoubleClick(e);
    const hit = hitAt(e.clientX, e.clientY);
    select(hit ? targetOf(hit) : null);
    if (hit) showInfo(true); // a pick opens the details; clearing it leaves them as they are
    // The pivot follows the selection. Only a double-click sets it (the glide makes the hit the target); a single click
    // on another object leaves it where it is, and clearing the selection (a click on empty space, or Esc) lets it go.
    if (double && hit) glideTarget(hit.point);
    else if (!hit) releaseRotation(); // a double-click on empty space is a click on empty space: it lets go
  });
}
