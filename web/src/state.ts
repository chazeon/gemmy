// The viewer's shared state, as signals (@preact/signals-core). A reader takes `.value` (inside an effect or a computed
// that tracks the change) or `.peek()` (where no tracking is wanted, such as a hot loop). Each signal is written by the
// module that owns it: scene/load.ts writes the scene, camera/view.ts and render/draw.ts the camera, lens and fit.
import { signal } from "@preact/signals-core";
import * as THREE from "three";
import { GEMMY } from "./config";
import type { Projection } from "./camera/framing";
import type { AtomPrimitive, Point, PolyhedronPrimitive, Scene, Vec3 } from "./types";

type Camera = THREE.OrthographicCamera | THREE.PerspectiveCamera;
// One pickable thing: an instanced atom, or a polyhedron (its triangles are a range of its material's merged mesh).
export type Target =
  | { kind: "atom"; atom: AtomPrimitive; mesh: THREE.InstancedMesh; index: number }
  | { kind: "polyhedron"; poly: PolyhedronPrimitive; ghost: boolean; mesh: THREE.Mesh; first: number; count: number };

export type PolyTarget = Extract<Target, { kind: "polyhedron" }>;

// The scene on show (`loaded`), replaced whole when a scene loads. Before the first load it is the empty stage: its
// data is undefined (hasScene() says so), and its groups are empty, so the picking and the readout find nothing there.
export interface LoadedScene {
  data: Scene | undefined;
  points: Map<string, Point>;
  polyhedra: PolyhedronPrimitive[];
  centre: Vec3;
  extent: number;
  lattice: THREE.Vector3[];
  atomGroup: THREE.Group;
  polyGroup: THREE.Group;
  box: THREE.LineSegments | null;
  polyTargets: PolyTarget[]; // one pickable target per polyhedron, in scene order
}

const EMPTY_SCENE: LoadedScene = {
  data: undefined, // no scene yet: hasScene() is false
  points: new Map(),
  polyhedra: [],
  centre: [0, 0, 0],
  extent: 1,
  lattice: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
  atomGroup: new THREE.Group(),
  polyGroup: new THREE.Group(),
  box: null,
  polyTargets: [],
};
export const loaded = signal<LoadedScene>(EMPTY_SCENE);
export const hasScene = (): boolean => loaded.peek().data !== undefined;

// The Show toggles of the ☰ menu, and the outlines (ui/stage.ts binds each to what it shows).
export const showAtoms = signal(true);
export const showBox = signal(true);
export const outlines = signal(true);

// The camera on show, the lens in mm, and the zoom of the last fit; the view is "fitted" while the zoom still equals
// it. The placeholder is replaced when draw.ts (imported first by main.ts) puts its orthographic camera on show.
export const camera = signal<Camera>(new THREE.OrthographicCamera());
export const lens = signal<number>(GEMMY.defaultLens);
export const fitValue = signal(1);
// The projection in use, written with the lens by each camera move (camera/view.ts commit).
export const projection = signal<Projection>("ortho");

// A redraw is wanted: requestRender sets the flag, the frame loop clears it when it draws.
let dirty = true;
export function requestRender(): void {
  dirty = true;
}
export function takeDirty(): boolean {
  const was = dirty;
  dirty = false;
  return was;
}
