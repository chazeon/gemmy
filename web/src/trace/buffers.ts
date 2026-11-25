import type { Box } from "./field";

// The pass readback as one value, and the key the id and band passes combine into. Pure: no three.js, so the node tests
// can load the modules that read these buffers.

// The depth of a pixel with no object: beyond any NDC depth in [0, 1], so it sorts behind every object.
export const BACKGROUND_DEPTH = 2;

// A key is 2 * id + dark: each object has a lit key (even) and a dark key (odd). Key 0 is background, and no object has id 0.
export const litKey = (id: number): number => 2 * id;
export const darkKey = (id: number): number => 2 * id + 1;
export const idOf = (key: number): number => key >> 1;

// The per-pixel results of the passes, top row first. Off the image every accessor reads as nothing (background, no shell,
// no line), so a neighbour test needs no bounds check of its own.
export class Passes {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly keys: Uint32Array, // 0 background, else the lit or dark key of the nearest object
    readonly depth: Float32Array, // the nearest object's NDC depth in 0..1, or BACKGROUND_DEPTH
    readonly shell: Uint8Array, // 1 where the live view's outline shell is the visible surface
    readonly lineId: Uint32Array, // the id of the thin bond, edge or box line that is the nearest surface (0: none)
  ) {}

  keyAt(x: number, y: number): number {
    return this.read(this.keys, x, y);
  }

  shellAt(x: number, y: number): boolean {
    return this.read(this.shell, x, y) === 1;
  }

  lineIdAt(x: number, y: number): number {
    return this.read(this.lineId, x, y);
  }

  private read(values: ArrayLike<number>, x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return values[y * this.width + x];
  }
}

// What the render says about each object: its bounding box (x0, y0, x1, y1; x1 < 0 when none is visible), its nearest visible
// depth and its visible pixels (both bands).
export interface ObjectStats {
  boxes: Int32Array;
  nearest: Float64Array;
  pixels: Uint32Array;
}

// A box's start before any pixel: beyond any image coordinate, so the first pixel of an object replaces it.
const OUT_OF_RANGE = 1 << 30;

// The bounding box of each object's pixels in one scan: four numbers per id (x0, y0, x1, y1), x1 < 0 when none is visible.
// The nearest depth of each object is taken in the same scan (BACKGROUND_DEPTH is beyond any depth, so an empty object sorts last).
export function objectBoxes(passes: Passes, count: number): ObjectStats {
  const { keys, depth, width } = passes;
  const pixels = new Uint32Array(count + 1); // visible pixels per object (both bands)
  const boxes = new Int32Array((count + 1) * 4);
  const nearest = new Float64Array(count + 1).fill(BACKGROUND_DEPTH);
  for (let id = 0; id <= count; id++) boxes.set([OUT_OF_RANGE, OUT_OF_RANGE, -1, -1], 4 * id);
  for (let p = 0; p < keys.length; p++) {
    const k = keys[p];
    if (k === 0) continue;
    const id = idOf(k);
    const b = 4 * id;
    nearest[id] = Math.min(nearest[id], depth[p]);
    pixels[id]++;
    const x = p % width;
    const y = (p - x) / width;
    if (x < boxes[b]) boxes[b] = x;
    if (y < boxes[b + 1]) boxes[b + 1] = y;
    if (x > boxes[b + 2]) boxes[b + 2] = x;
    if (y > boxes[b + 3]) boxes[b + 3] = y;
  }
  return { boxes, nearest, pixels };
}

export function boxOf(boxes: Int32Array, id: number): Box {
  return { x0: boxes[4 * id], y0: boxes[4 * id + 1], x1: boxes[4 * id + 2], y1: boxes[4 * id + 3] };
}

// The object at the render pixel under a projected point (0 when off the image). The centre pixel tells whether an object is
// the visible surface at its centre, i.e. whole rather than a fragment.
export function keyAtCentre(passes: Passes, p: { x: number; y: number }): number {
  return idOf(passes.keyAt(Math.floor(p.x), Math.floor(p.y)));
}
