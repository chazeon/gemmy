// The shared pieces of the SVG export: the options, the drawing context, and the lookups the export shares. The traced
// export (trace/traced.ts) and the triad (triad.ts) are the only users.
import { ARROW } from "../config";
import type { Scene, Vec3 } from "../types";
import type { View, ViewOptions } from "./view";

export interface SvgOptions extends ViewOptions {
  data: Scene;
  show: { atoms: boolean; box: boolean };
  outlines: boolean;
  outlineScale: number; // the user's outline width (ui/outline-scale.ts): a multiplier on the automatic width
  lattice: Vec3[]; // the a, b, c vectors, for the triad
  boxColor: string; // CSS colour of the cell box and the triad hub
}

// What the drawing needs besides the options: the camera.
export interface Ctx {
  o: SvgOptions;
  view: View;
}

// A material's sRGB colour (the first three components of its base colour).
export function colorOf(o: SvgOptions, id: string): number[] {
  return o.data.materials[id].base_color.slice(0, 3);
}

// The arrows have no material: they take the arrow colour of the Blender look (ARROW.color).
export function arrowColor(): number[] {
  return ARROW.color.slice(0, 3);
}
