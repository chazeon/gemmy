// The shared pieces of the SVG export: the options, the shape record that the painter's sort runs on, the drawing
// context, and the lookups the builders share. Each builder lives in its own file under export/ and imports from here.
import { Vector3 } from "three";
import { ARROW } from "../config";
import type { Scene, Vec3 } from "../types";
import type { Attrs } from "./markup";
import type { View, ViewOptions } from "./view";

export interface SvgOptions extends ViewOptions {
  data: Scene;
  show: { atoms: boolean; box: boolean };
  outlines: boolean;
  lattice: Vec3[]; // the a, b, c vectors, for the triad
  boxColor: string; // CSS colour of the cell box and the triad hub
}

export interface Shape { z: number; svg: string } // z: sort key, larger is nearer

// An atom that is drawn: where it is, its radius, and its sort key. A bond or shaft that ends on it is cut at its sphere.
export interface DrawnAtom { centre: Vector3; radius: number; z: number }

// The drawn atoms at the two ends of a piece of bond (null: that end is not on a drawn atom).
export interface Ends { a: DrawnAtom | null; b: DrawnAtom | null }

export interface Face { idx: [number, number, number]; n: Vector3; front: boolean }

export interface Ctx {
  o: SvgOptions;
  view: View;
  points: Map<string, Vector3>;
  light: Vector3; // the key light, unit length, camera space
  outlineHex: string; // the outline colour: linear in LOOK, so the sRGB hex is lighter than the edges' (see linearHex)
  edgeHex: string; // the polyhedron edge lines: sRGB, as the page's edgeMaterial
  outlineWidth: number;
}

// For each atom on a polyhedron vertex: the depth it must sort after, or before (see recordTouch in polyhedra.ts).
export interface Touch { after: Map<string, number>; before: Map<string, number> }

// Sort-key offset: an atom on a polyhedron vertex goes just after or just before it, and a bond's end on its atom goes
// just after it (or stays behind it).
export const DEPTH_NUDGE = 1e-6;

// The stroke of an outlined shape: the outline colour and width, with round joins.
export function outlineStroke(ctx: Ctx, on: boolean): Attrs {
  return on && ctx.o.outlines ? { stroke: ctx.outlineHex, "stroke-width": ctx.outlineWidth, "stroke-linejoin": "round" } : {};
}

// The attributes of a filled shape with an outline: painted with paint-order="stroke", so the stroke goes first and the
// fill covers its inner half, and only the outer half shows.
export function outlineAttrs(ctx: Ctx, on: boolean): Attrs {
  return on && ctx.o.outlines ? { ...outlineStroke(ctx, on), "paint-order": "stroke" } : {};
}

// A material's sRGB colour (the first three components of its base colour).
export function colorOf(o: SvgOptions, id: string): number[] {
  return o.data.materials[id].base_color.slice(0, 3);
}

// The arrows have no material: they take the arrow colour of the Blender look (ARROW.color).
export function arrowColor(): number[] {
  return ARROW.color.slice(0, 3);
}

export function pointOf(ctx: Ctx, id: string): Vector3 {
  const p = ctx.points.get(id);
  if (!p) throw new Error(`export: no point ${id}`);
  return p;
}
