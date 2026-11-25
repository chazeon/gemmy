// The cell box: the twelve edges of the cell's parallelepiped, as corner pairs. The page draws them (scene/load.ts and
// the SVG trace), and both read them from here, so the two boxes are the same lines.
import type { Cell, Vec3 } from "../types";

// Corner n of the cell: the origin, plus a for bit 0, b for bit 1 and c for bit 2 of n.
export function cellCorner(cell: Cell, n: number): Vec3 {
  const [a, b, c] = cell.vectors;
  return [0, 1, 2].map((d) => cell.origin[d] + (n & 1) * a[d] + ((n >> 1) & 1) * b[d] + ((n >> 2) & 1) * c[d]) as Vec3;
}

// Each edge once, from the corner without an axis's bit to the one with it.
export function cellEdges(cell: Cell): [Vec3, Vec3][] {
  const corners = Array.from({ length: 8 }, (_, n) => cellCorner(cell, n));
  const edges: [Vec3, Vec3][] = [];
  for (let n = 0; n < 8; n++) {
    for (let axis = 0; axis < 3; axis++) {
      const bit = 1 << axis;
      if (!(n & bit)) edges.push([corners[n], corners[n | bit]]);
    }
  }
  return edges;
}
