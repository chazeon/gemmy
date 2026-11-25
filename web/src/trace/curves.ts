// Polylines to SVG path data: resample at a fixed spacing, split at sharp corners, and fit each smooth piece with cubic
// Béziers (Schneider's algorithm, fit-curve). Corners stay sharp because every piece starts and ends on one, so the
// neighbouring pieces meet there with their own tangents.
import fitCurve from "fit-curve";
import { MathUtils } from "three";
import { fmt, fmtPt } from "../export/markup";

// Lengths are CSS px unless a name says otherwise.
const RESAMPLE_PX = 0.25; // spacing of the points the fit sees
const CORNER_ANGLE_DEG = 50; // a turn sharper than this is a corner: the curve is split there
const CORNER_WINDOW_PX = 1; // the turn is measured across this much arc, so a corner is one turn, not a staircase of small ones
const WINDOW_SAMPLES = Math.max(1, Math.round(CORNER_WINDOW_PX / RESAMPLE_PX)); // the window in samples
const FIT_ERROR_PX = 0.3; // the largest distance between a fitted curve and the points (fit-curve takes the square)

export type Pt = [number, number];

// Path data for straight spans: each "M p L q".
export function segmentsPath(spans: [Pt, Pt][]): string {
  return spans.map(([p, q]) => `M${fmtPt(p)}L${fmtPt(q)}`).join("");
}

// SVG path data for a closed ring: M, then the fitted curves, then Z.
export function closedPath(points: Pt[]): string {
  return pathFrom(points, true);
}

// The fitted curve commands of an open line, without the leading M: for a stretch that continues from a point already set.
export function fitCommands(points: Pt[]): string {
  return smoothPieces(points, false).map(fitPiece).join("");
}

// SVG path data from a point: M, then the fitted curves, then Z for a ring.
function pathFrom(points: Pt[], closed: boolean): string {
  const pieces = smoothPieces(points, closed);
  if (pieces.length === 0) return "";
  const [x0, y0] = pieces[0][0];
  const d = `M${fmt(x0)} ${fmt(y0)}${pieces.map(fitPiece).join("")}`;
  return closed ? `${d}Z` : d;
}

// The pieces of a line or ring that each fit one smooth curve: resampled, then cut at the corners.
function smoothPieces(points: Pt[], closed: boolean): Pt[][] {
  const line = resample(points, closed, RESAMPLE_PX);
  if (line.length < 2) return [];
  const corners = cornerIndices(turningAngles(line, closed), closed);
  return closed ? ringPieces(line, corners) : linePieces(line, corners);
}

// Points at a fixed arc-length spacing. A closed ring is walked back to its start, and the start is not repeated.
function resample(points: Pt[], closed: boolean, spacing: number): Pt[] {
  const ring = closed ? [...points, points[0]] : points;
  const lengths = [0];
  for (let i = 1; i < ring.length; i++) lengths.push(lengths[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const total = lengths[lengths.length - 1];
  if (total === 0) return [];
  const count = Math.max(2, Math.round(total / spacing));
  const out: Pt[] = [];
  let seg = 0;
  const steps = closed ? count : count - 1; // a closed ring's last sample would repeat the first
  for (let k = 0; k <= steps; k++) {
    const target = (k * total) / (closed ? count : steps);
    while (seg < ring.length - 2 && lengths[seg + 1] < target) seg++;
    const span = lengths[seg + 1] - lengths[seg] || 1;
    const t = Math.min(1, Math.max(0, (target - lengths[seg]) / span));
    const a = ring[seg];
    const b = ring[seg + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// The turn in degrees at each point: the angle between the chord from the point before (across the window) and the chord
// to the point after it. Ends of an open line have no turn; the caller makes them corners.
function turningAngles(line: Pt[], closed: boolean): number[] {
  const n = line.length;
  const step = WINDOW_SAMPLES;
  const turns = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const before = closed ? (i - step + n) % n : i - step;
    const after = closed ? (i + step) % n : i + step;
    if (!closed && (before < 0 || after >= n)) continue;
    const ax = line[i][0] - line[before][0];
    const ay = line[i][1] - line[before][1];
    const bx = line[after][0] - line[i][0];
    const by = line[after][1] - line[i][1];
    turns[i] = MathUtils.radToDeg(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    turns[i] = Math.abs(turns[i]);
  }
  return turns;
}

// The corners: points whose turn is above the threshold and is the largest turn within the window (one per corner).
function cornerIndices(turns: number[], closed: boolean): number[] {
  const n = turns.length;
  const reach = WINDOW_SAMPLES;
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turns[i] <= CORNER_ANGLE_DEG) continue;
    let isPeak = true;
    for (let k = -reach; k <= reach && isPeak; k++) {
      if (k === 0) continue;
      const j = closed ? (i + k + n) % n : i + k;
      if (j < 0 || j >= n) continue;
      if (turns[j] > turns[i] || (turns[j] === turns[i] && k < 0)) isPeak = false;
    }
    if (isPeak) corners.push(i);
  }
  return corners;
}

// A closed ring cut at its corners: each piece runs corner to corner, and the last one wraps to the first corner. With no
// corner the ring is one piece that starts and ends at the same point.
function ringPieces(line: Pt[], corners: number[]): Pt[][] {
  const n = line.length;
  if (corners.length === 0) return [[...line, line[0]]];
  const pieces: Pt[][] = [];
  for (let c = 0; c < corners.length; c++) {
    const from = corners[c];
    const to = corners[(c + 1) % corners.length];
    const piece: Pt[] = [];
    for (let i = from; ; i = (i + 1) % n) {
      piece.push(line[i]);
      if (i === to && piece.length > 1) break;
    }
    pieces.push(piece);
  }
  return pieces;
}

// An open line cut at its interior corners; the two ends are always pieces' ends.
function linePieces(line: Pt[], corners: number[]): Pt[][] {
  const cuts = [0, ...corners.filter((i) => i > 0 && i < line.length - 1), line.length - 1];
  const pieces: Pt[][] = [];
  for (let c = 0; c < cuts.length - 1; c++) pieces.push(line.slice(cuts[c], cuts[c + 1] + 1));
  return pieces;
}

// The commands of one piece, starting where the previous piece ended: fitted curves, or a straight line for two points.
function fitPiece(piece: Pt[]): string {
  if (piece.length < 3) return piece.slice(1).map((p) => `L${fmt(p[0])} ${fmt(p[1])}`).join("");
  const curves = fitCurve(piece.map((p) => [p[0], p[1]] as [number, number]), FIT_ERROR_PX * FIT_ERROR_PX);
  return curves.map(([, c1, c2, end]) => `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(end[0])} ${fmt(end[1])}`).join("");
}
