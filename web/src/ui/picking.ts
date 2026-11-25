// Picking: a click selects the atom or polyhedron under it, shows its readout and highlights it in the scene. A pick
// also opens the details panel (panels.ts), and the readout's text comes from readout.ts.
import * as THREE from "three";
import { renderer } from "../render/draw";
import { atomGroup, camera, polyGroup, polyTargets, requestRender, type Target, type PolyTarget } from "../state";
import { describe } from "./readout";
import { showInfo } from "./panels";
import { glideTo } from "../camera/glide";
import { releasePivot } from "../camera/pivot";
import { POINTER_SLOP_PX } from "../config";

// ---- the selection highlight ----
// The selection is drawn as an extra mesh over the picked atom or polyhedron: a copy of its material, lit up by an
// emissive term and pulled slightly forward. The instanced and merged meshes themselves are never touched.
const HIGHLIGHT_GLOW = 0.55; // emissive as a fraction of the object's own colour
const PULL_FORWARD = -1; // pulled slightly forward, so the highlight wins the depth test against the original
const GHOST_RENDER_ORDER = 2; // a see-through polyhedron is drawn over its own blended faces
const FLOATS_PER_TRIANGLE = 3 * 3; // three vertices of three numbers each

type AtomTarget = Extract<Target, { kind: "atom" }>;

let highlight: THREE.Mesh | null = null;

function clearHighlight() {
  if (!highlight) return;
  highlight.removeFromParent();
  (highlight.material as THREE.Material).dispose();
  if (highlight.userData.own) highlight.geometry.dispose();
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
  atomGroup.add(mesh);
  return mesh;
}
// A polyhedron's triangles are a range of its material's merged mesh, so the highlight copies that range.
function highlightPolyhedron(target: PolyTarget): THREE.Mesh {
  const from = target.first * FLOATS_PER_TRIANGLE, to = (target.first + target.count) * FLOATS_PER_TRIANGLE;
  const geometry = new THREE.BufferGeometry();
  for (const name of ["position", "normal"]) {
    const values = target.mesh.geometry.getAttribute(name).array.slice(from, to);
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, 3));
  }
  const mesh = new THREE.Mesh(geometry, highlightMaterial(target.mesh.material as THREE.MeshToonMaterial));
  mesh.userData.own = true; // its own geometry, so it is disposed with the highlight
  mesh.renderOrder = target.ghost ? GHOST_RENDER_ORDER : 0;
  polyGroup.add(mesh);
  return mesh;
}

// Selects a target (or clears the selection), shows its readout and redraws.
export function select(target: Target | null) {
  clearHighlight();
  if (target) highlight = target.kind === "atom" ? highlightAtom(target) : highlightPolyhedron(target);
  describe(target);
  requestRender();
}

// ---- picking ----
// What a ray hit stands for: an instanced atom (by instanceId) or a triangle of a merged polyhedron mesh.
function targetOf(hit: THREE.Intersection): Target {
  const mesh = hit.object;
  if (mesh.userData.atoms) {
    const index = hit.instanceId!; // an instanced hit always has an instanceId
    return { kind: "atom", atom: mesh.userData.atoms[index], mesh: mesh as THREE.InstancedMesh, index };
  }
  const face = hit.faceIndex!; // a merged polyhedron hit always has a faceIndex
  return polyTargets[mesh.userData.owner[face]];
}
// The meshes a click can hit: the atoms (while they are shown) and the polyhedron meshes.
function pickableObjects(): THREE.Object3D[] {
  const atoms = atomGroup.visible ? atomGroup.children.filter((o) => o.userData.atoms) : [];
  const polys = polyGroup.children.filter((o) => (o as THREE.Mesh).isMesh && o.userData.owner);
  return [...atoms, ...polys];
}

const ray = new THREE.Raycaster();
// The nearest hit under a screen position, or null. A see-through polyhedron does not block the atoms behind its front,
// so a ghost is taken only when nothing else is hit.
function hitAt(clientX: number, clientY: number): THREE.Intersection | null {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickableObjects(), false);
  return hits.find((h) => !isGhostHit(h)) ?? hits[0] ?? null;
}
function isGhostHit(hit: THREE.Intersection): boolean {
  const target = targetOf(hit);
  return target.kind === "polyhedron" && target.ghost;
}

// The world point a screen position hits (the atoms and polyhedra a click can pick), or null when it hits nothing.
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
  if (double && hit) glideTo(hit.point); // a double-click on empty space is a click on empty space: it lets go
  else if (!hit) releasePivot();
});
