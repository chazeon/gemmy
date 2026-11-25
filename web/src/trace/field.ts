// The outline of one object's region, sub-pixel. The region's binary mask is blurred into a coverage field, and the 0.5
// iso-line of that field is traced with d3-contour (linear interpolation along the cell edges). A straight edge between
// an inside and an outside pixel blurs to values 1/3 and 2/3 either side of the boundary, so the 0.5 line falls on the
// true boundary, and curved edges get the same sub-pixel placement from their neighbouring values.
import { contours } from "d3-contour";

// ---- constants ----
const FIELD_RADIUS_PX = 1; // box blur radius, in render-scale pixels (the window is 2 * radius + 1 pixels across)
const FIELD_BORDER_PX = 2; // outside pixels around the box, so the blur never reads past the mask and every ring closes
const ISO_LEVEL = 0.5; // the coverage that marks the edge: halfway between inside (1) and outside (0)

// A ring in render-scale pixel coordinates, top row first. Pixel (x, y) spans x..x+1 by y..y+1, so its centre is x + 0.5.
export type Ring = [number, number][];

export interface Box { x0: number; y0: number; x1: number; y1: number } // inclusive pixel bounds; x1 < x0 when empty

// The rings of the pixels whose key matches `match`, within `box`.
export function regionRings(keys: Uint32Array, width: number, box: Box, match: (key: number) => boolean): Ring[] {
  if (box.x1 < box.x0) return [];
  const cols = box.x1 - box.x0 + 1 + 2 * FIELD_BORDER_PX;
  const rows = box.y1 - box.y0 + 1 + 2 * FIELD_BORDER_PX;
  const mask = new Float64Array(cols * rows);
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (match(keys[y * width + x])) mask[(y - box.y0 + FIELD_BORDER_PX) * cols + (x - box.x0 + FIELD_BORDER_PX)] = 1;
    }
  }
  const field = boxBlur(boxBlur(mask, cols, rows, FIELD_RADIUS_PX, true), cols, rows, FIELD_RADIUS_PX, false);
  const multi = contours().size([cols, rows]).thresholds([ISO_LEVEL])(Array.from(field))[0];
  const offsetX = box.x0 - FIELD_BORDER_PX + 0.5; // grid index i is the centre of pixel i (the field's samples)
  const offsetY = box.y0 - FIELD_BORDER_PX + 0.5;
  const rings: Ring[] = [];
  for (const polygon of multi.coordinates) {
    for (const ring of polygon) {
      const points = ring.slice(0, -1).map(([gx, gy]): [number, number] => [gx + offsetX, gy + offsetY]); // drop the repeated end
      if (points.length >= 3) rings.push(points);
    }
  }
  return rings;
}

// One separable box blur pass, along x (horizontal) or y. The edges clamp to the border, which is always zero.
function boxBlur(src: Float64Array, cols: number, rows: number, radius: number, horizontal: boolean): Float64Array {
  const out = new Float64Array(cols * rows);
  const weight = 1 / (2 * radius + 1);
  const length = horizontal ? cols : rows;
  for (let line = 0; line < (horizontal ? rows : cols); line++) {
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = Math.min(length - 1, Math.max(0, i + k));
        sum += horizontal ? src[line * cols + j] : src[j * cols + line];
      }
      if (horizontal) out[line * cols + i] = sum * weight;
      else out[i * cols + line] = sum * weight;
    }
  }
  return out;
}
