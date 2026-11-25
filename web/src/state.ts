// Mutable state shared by the viewer modules. An importer reads these live (an ES module binding always shows the
// current value). Only the owner of a value writes it directly; any other module changes it through the setter beside
// it, since an import cannot be assigned. The scene values are set by scene/load.ts, the camera and lens by
// render/draw.ts and ui/ui.ts.
import * as THREE from "three";
import { GEMMY } from "./config";
import type { AtomPrimitive, Point, PolyhedronPrimitive, Scene, Vec3 } from "./types";

export type Camera = THREE.OrthographicCamera | THREE.PerspectiveCamera;
// One pickable thing: an instanced atom, or a polyhedron (its triangles are a range of its material's merged mesh).
export type Target =
  | { kind: "atom"; atom: AtomPrimitive; mesh: THREE.InstancedMesh; index: number }
  | { kind: "polyhedron"; poly: PolyhedronPrimitive; ghost: boolean; mesh: THREE.Mesh; first: number; count: number };

export type PolyTarget = Extract<Target, { kind: "polyhedron" }>;

// The scene on show. load() sets these before anything reads them (hence the casts on the first value).
export let data = undefined as unknown as Scene;
export let points = new Map<string, Point>();
export let polyhedra: PolyhedronPrimitive[] = [];
export let centre: Vec3 = [0, 0, 0];
export let extent = 1;
export let lattice = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
export let atomGroup = new THREE.Group();
export let polyGroup = new THREE.Group();
export let outlineGroup = new THREE.Group();
export let box: THREE.LineSegments | null = null;
export let polyTargets: PolyTarget[] = []; // one pickable target per polyhedron, in scene order
export const show = { atoms: true, box: true };
export let outlines = true;

// The camera on show (orthographic until the user picks a lens; draw.ts sets it) and the lens in mm.
export let camera = undefined as unknown as Camera;
export let lens = GEMMY.defaultLens;
// The zoom of the last fit; the view is "fitted" while the zoom still equals it.
export let fitValue = 1;

// A redraw is wanted: requestRender sets the flag, the frame loop clears it when it draws.
let dirty = true;
export function requestRender(): void { dirty = true; }
export function takeDirty(): boolean { const was = dirty; dirty = false; return was; }

export function setData(value: Scene): void { data = value; }
export function setPoints(value: Map<string, Point>): void { points = value; }
export function setPolyhedra(value: PolyhedronPrimitive[]): void { polyhedra = value; }
export function setCentre(value: Vec3): void { centre = value; }
export function setExtent(value: number): void { extent = value; }
export function setLattice(value: THREE.Vector3[]): void { lattice = value; }
export function setAtomGroup(value: THREE.Group): void { atomGroup = value; }
export function setPolyGroup(value: THREE.Group): void { polyGroup = value; }
export function setOutlineGroup(value: THREE.Group): void { outlineGroup = value; }
export function setBox(value: THREE.LineSegments | null): void { box = value; }
export function setPolyTargets(value: PolyTarget[]): void { polyTargets = value; }
export function setOutlines(value: boolean): void { outlines = value; }
export function setCamera(value: Camera): void { camera = value; }
export function setLens(value: number): void { lens = value; }
export function setFitValue(value: number): void { fitValue = value; }
