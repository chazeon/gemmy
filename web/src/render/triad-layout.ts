// The a/b/c triad's layout in CSS px, laid out like the Blender overlay (gemmy.render.blender.overlay): the arrows, the
// labels and the origin dot, from the lattice directions in camera space. Pure (no DOM, no page state), so the live
// letters (triad.ts) and the SVG trace (trace/triad-trace.ts) lay the triad out the same way.
import type { Quaternion, Vector3 } from "three";
import { GEMMY } from "../config";
import type { Vec } from "../geom/vector";
// One axis of the triad. `depth` is its camera-space z (larger is nearer the viewer); the arrow fields are absent when
// the axis points (almost) straight at the viewer and shows only as a dot-and-label.
export type TriadItem = TriadLabelled & (TriadArrowed | { shaftEnd?: undefined; head?: undefined });
interface TriadLabelled {
  index: number;
  depth: number;
  fade: number; // how far the axis's colour is mixed toward the background (geom.triad_draw's fades)
  label: { x: number; y: number };
}
interface TriadArrowed {
  shaftEnd: [number, number];
  head: [number, number][];
}

// Pixels, y down. `length` is the arrow length; the arrows, labels and dot are all sized from it.
export interface TriadLayout {
  origin: [number, number];
  items: TriadItem[]; // back to front (geom.triad_draw's order)
  behind: number; // the first `behind` items point away from the viewer: they are drawn under the origin ball
  lineWidth: number;
  fontSize: number;
  dotRadius: number;
  length: number;
}

// `dirs` are the axis directions in camera space (x right, y up, z towards the viewer). The arrows are `triad.size` of
// the frame's SHORTER side long, the origin sits `triad.margin` of the width from the left and of the height from the
// bottom, and each label sits just beyond its arrow tip. `inset` moves the origin right, in px: the live page's stage is
// moved left under the open dock (style.css), and the triad is drawn in the part that stays in view. An export has none.
export function triadLayout(dirs: readonly Vec[], width: number, height: number, inset = 0): TriadLayout {
  const T = GEMMY.triad;
  const length = T.size * Math.min(width, height);
  const origin: [number, number] = [T.margin * width + inset, height - T.margin * height];
  // Far axes first, so near ones draw over them.
  const items = dirs.map((d, index) => triadItem(d, index, origin, length)).sort((p, q) => p.depth - q.depth);
  return {
    origin,
    items,
    behind: items.filter((item) => item.depth < 0).length,
    lineWidth: 2 * T.arrowRadius * length,
    fontSize: T.labelSize * length,
    dotRadius: T.dotRadius * length,
    length,
  };
}

// Below these on-screen lengths (the unit direction's flat part, hypot(x, y)) an axis is treated as pointing at the
// viewer: no head, and a label placed diagonally instead of along the arrow. Same cut-offs as the Python side
// (geom.axis_label_position uses 0.15, geom.triad_layout uses 0.08).
const LABEL_FLAT_MIN = 0.15;
const HEAD_FLAT_MIN = 0.08;
// Where the label of an axis that points at the viewer goes: 1/sqrt(2), up and to the right of the origin.
const DIAGONAL = Math.SQRT1_2;

function triadItem(d: Vec, index: number, origin: [number, number], length: number): TriadItem {
  const T = GEMMY.triad;
  const flat = Math.hypot(d[0], d[1]);
  const onScreen = flat > LABEL_FLAT_MIN;
  const [ux, uy] = labelDirection(d, flat, onScreen);
  // The arrow length plus the head's reach: the radius the Python side passes to axis_label_position as `length`.
  const labelRadius = length * (1 + T.labelReach * T.arrowRadius);
  const reach = onScreen ? labelRadius * flat : 0; // the label's distance from the origin along the arrow
  const pad = T.labelPad * length;
  const label = { x: origin[0] + (reach + pad) * ux, y: origin[1] - (reach + pad) * uy };
  const fade = T.depthFadeMax * Math.max(0, -d[2]); // geom.triad_draw: straight away is the full fade
  return flat > HEAD_FLAT_MIN
    ? { index, depth: d[2], fade, label, ...triadArrow(d, flat, origin, length) }
    : { index, depth: d[2], fade, label };
}

// The unit direction the label is pushed along: the arrow's own direction on screen, or the diagonal when the axis
// points at the viewer.
function labelDirection(d: Vec, flat: number, onScreen: boolean): [number, number] {
  return onScreen ? [d[0] / flat, d[1] / flat] : [DIAGONAL, DIAGONAL];
}

// The shaft and head of an axis that shows its direction on screen. The shaft stops halfway into the head, so the
// join is hidden (SHAFT_INTO_HEAD).
const SHAFT_INTO_HEAD = 0.5;
function triadArrow(d: Vec, flat: number, [ox, oy]: [number, number], length: number): TriadArrowed {
  const T = GEMMY.triad;
  const tip: [number, number] = [ox + d[0] * length, oy - d[1] * length];
  const tx = d[0] / flat; // the unit direction on screen (y points down)
  const ty = -d[1] / flat;
  const headLength = T.headLengthRatio * length;
  const headHalf = T.headRadiusRatio * T.arrowRadius * length;
  const base: [number, number] = [tip[0] - tx * headLength, tip[1] - ty * headLength]; // where the head meets the shaft
  return {
    shaftEnd: [tip[0] - tx * headLength * SHAFT_INTO_HEAD, tip[1] - ty * headLength * SHAFT_INTO_HEAD],
    head: [tip, [base[0] - ty * headHalf, base[1] + tx * headHalf], [base[0] + ty * headHalf, base[1] - tx * headHalf]],
  };
}

// The lattice vectors as the camera sees them: each one rotated back by the camera's orientation.
export function latticeInView(lattice: readonly Vector3[], orientation: Quaternion): number[][] {
  const inverse = orientation.clone().invert();
  return lattice.map((vector) => vector.clone().applyQuaternion(inverse).toArray());
}
