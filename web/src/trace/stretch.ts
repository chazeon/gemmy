// Boundary stretches, their outline decision, and their snapping. A region's boundary is cut where the object on the other
// side changes (background, or another object). Each stretch is split where the live view's outline shell starts or stops
// along it (the shell mask of passes.ts, sampled in a thin band just outside the boundary). Each piece is then tested
// against the exact curves it could lie on (the caller supplies them): if one fits within SNAP_TOL_RENDER_PX (RMS), the piece
// is written as that exact primitive (L for a line, A for an ellipse); otherwise it falls back to the fitted Bézier of
// curves.ts. Consecutive pieces join where they meet.
import { type Curve, curveRms, onLine } from "./candidates";
import { arcTo, fullEllipseArcs, paramOf, pointAt } from "./ellipse";
import { closedPath, fitCommands, type Pt } from "./curves";
import { type Passes, idOf } from "./buffers";
import { fmtPt } from "../export/markup";
import type { Ellipse } from "../export/view";

// The RMS distance (render px) under which a stretch counts as lying on a curve. About a pixel of the id render at 1x is
// 1 CSS px, so 0.6 render px is 0.6 px at 1x and 0.3 px at 2x.
const SNAP_TOL_RENDER_PX = 0.6;
// The outline decision samples the shell mask at these distances outside the boundary (render px): a band 1.5 px wide. A
// point is outlined when more than half of its samples are shell.
const BAND_OFFSETS_PX = [0.5, 1, 1.5];
// The flag of a point is the majority over this many points either side of it, so the decision does not flicker pixel by
// pixel along a boundary that the shell only just covers.
const FLAG_HALF_WINDOW = 3;
// Where a stretch is cut between two labels, the label is the object on the outside (0: background).
const BACKGROUND = 0;

// What the outline decision reads: the object's id and the passes, at the render scale.
interface Ctx {
  id: number;
  passes: Passes;
  scale: number;
}

export interface Stretch {
  pts: Pt[]; // CSS px, along the boundary
  label: number; // the object on the outside of the stretch (0: background)
  outlined: boolean; // the live view's outline shell covers this piece's outside: its outline is drawn
}

// The stretches of one object's ring (render px in, CSS px out), each cut at label changes and at outline changes. A ring
// with one label and no outline change is one closed stretch.
export function stretchesOf(ring: Pt[], id: number, passes: Passes, scale: number): { stretches: Stretch[]; whole: boolean } {
  const labels = fillGaps(ring.map(([x, y]) => labelAt(x, y, id, passes)));
  if (labels === null) return { stretches: [], whole: false };
  const css = ring.map(([x, y]): Pt => [x / scale, y / scale]);
  const ctx: Ctx = { id, passes, scale };
  if (labels.every((l) => l === labels[0])) return wholeRing(css, labels[0], ctx);
  const [pts, rotatedLabels] = rotateToChange(css, labels);
  return { stretches: splitAtLabelChanges(pts, rotatedLabels, ctx), whole: false };
}

// A ring with one label: one closed stretch, or cut where its outline changes.
function wholeRing(css: Pt[], label: number, ctx: Ctx): { stretches: Stretch[]; whole: boolean } {
  const flags = shellFlags(css, true, ctx);
  if (flags.every((f) => f === flags[0])) return { stretches: [{ pts: css, label, outlined: flags[0] }], whole: true };
  return { stretches: cyclicRuns(css, flags, label), whole: false };
}

// The label at each point, with the points that see no label (null) taking the label of the point before them. Null when
// no point has one.
function fillGaps(labels: (number | null)[]): number[] | null {
  const first = labels.find((l): l is number => l !== null);
  if (first === undefined) return null;
  let prev = first;
  return labels.map((l) => {
    if (l === null) return prev;
    prev = l;
    return l;
  });
}

// The ring walked from a label change, so no stretch is split by the ring's start.
function rotateToChange(css: Pt[], labels: number[]): [Pt[], number[]] {
  const start = labels.findIndex((l, i) => l !== labels[(i - 1 + labels.length) % labels.length]);
  return [[...css.slice(start), ...css.slice(0, start)], [...labels.slice(start), ...labels.slice(0, start)]];
}

// The stretches of a walk, cut where the label changes and again where the outline does.
function splitAtLabelChanges(pts: Pt[], labels: number[], ctx: Ctx): Stretch[] {
  const stretches: Stretch[] = [];
  for (let i = 0; i < pts.length; ) {
    let j = i;
    while (j + 1 < pts.length && labels[j + 1] === labels[i]) j++;
    // this label's span [i, j], cut again where the outline changes
    const span = pts.slice(i, j + 1);
    for (const piece of runsOf(span, shellFlags(span, false, ctx))) {
      stretches.push({ pts: piece.pts, label: labels[i], outlined: piece.outlined });
    }
    i = j + 1;
  }
  return stretches;
}

// The label of the outside at one boundary point (render px): the 2x2 pixels around the point vote, and the winner is the
// object (or background) most of them show outside this object's region.
function labelAt(x: number, y: number, id: number, passes: Passes): number | null {
  const left = Math.floor(x - 0.5);
  const top = Math.floor(y - 0.5);
  let inside = false;
  const votes: number[] = [];
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const key = passes.keyAt(left + dx, top + dy);
      if (key !== 0 && idOf(key) === id) {
        inside = true;
        continue;
      }
      votes.push(key === 0 ? BACKGROUND : idOf(key));
    }
  }
  return inside ? mostCommon(votes) : null;
}

// The value that occurs most often (the first of equal counts to reach the top), or null when there are none.
function mostCommon(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// The outline flags of boundary points (CSS px). The outside of each point is the side that is not this object's region;
// the shell is sampled in the band just there.
function shellFlags(pts: Pt[], closed: boolean, ctx: Ctx): boolean[] {
  const n = pts.length;
  const raw = pts.map((p, i) => {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const [nx, ny] = outwardNormal(p, a, b, ctx);
    let hits = 0;
    for (const d of BAND_OFFSETS_PX) if (shellAt([p[0] + (nx * d) / ctx.scale, p[1] + (ny * d) / ctx.scale], ctx)) hits++;
    return hits * 2 > BAND_OFFSETS_PX.length;
  });
  return majority(raw, closed);
}

// The unit normal at p, from its neighbours a and b, pointing out of this object. The sign of the normal follows the walk's
// direction, so the test asks which side is the object's own region: a point just along the normal that is the object's
// own means the normal points in, and it is flipped.
function outwardNormal(p: Pt, a: Pt, b: Pt, ctx: Ctx): Pt {
  const tx = b[0] - a[0];
  const ty = b[1] - a[1];
  const len = Math.hypot(tx, ty) || 1;
  const n: Pt = [ty / len, -tx / len];
  return ownAt([p[0] + n[0] / ctx.scale, p[1] + n[1] / ctx.scale], ctx) ? [-n[0], -n[1]] : n;
}

// Each flag replaced by the majority of the flags in its window (wrapping on a closed ring, clamped on an open one).
function majority(flags: boolean[], closed: boolean): boolean[] {
  const n = flags.length;
  return flags.map((_, i) => {
    let count = 0;
    let seen = 0;
    for (let k = -FLAG_HALF_WINDOW; k <= FLAG_HALF_WINDOW; k++) {
      const j = closed ? (i + k + n * 2) % n : i + k;
      if (j < 0 || j >= n) continue;
      seen++;
      if (flags[j]) count++;
    }
    return count * 2 > seen;
  });
}

// The pixel under a boundary point (CSS px, scaled to render px), read with the passes' bounds.
const pixelOf = (p: Pt, ctx: Ctx): [number, number] => [Math.floor(p[0] * ctx.scale), Math.floor(p[1] * ctx.scale)];

function ownAt(p: Pt, ctx: Ctx): boolean {
  const key = ctx.passes.keyAt(...pixelOf(p, ctx));
  return key !== 0 && idOf(key) === ctx.id;
}

function shellAt(p: Pt, ctx: Ctx): boolean {
  return ctx.passes.shellAt(...pixelOf(p, ctx));
}

// Consecutive points with the same flag as pieces. Neighbouring pieces share their boundary point, so they join.
function runsOf(pts: Pt[], flags: boolean[]): { pts: Pt[]; outlined: boolean }[] {
  const out: { pts: Pt[]; outlined: boolean }[] = [];
  if (pts.length < 2) return [{ pts, outlined: flags[0] }];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1; // every piece has at least two points, so the walk always moves on
    while (j + 1 < pts.length && flags[j + 1] === flags[i]) j++;
    out.push({ pts: pts.slice(i, j + 1), outlined: flags[i] });
    i = j; // the next piece starts at this piece's last point, so the two join
  }
  return out;
}

// A closed span cut into pieces where the flag changes, starting at a change so the wrap-around is not split.
function cyclicRuns(pts: Pt[], flags: boolean[], label: number): Stretch[] {
  const n = pts.length;
  const change = flags.findIndex((f, i) => f !== flags[(i - 1 + n) % n]);
  const from = change < 0 ? 0 : change;
  const rotatedPts = [...pts.slice(from), ...pts.slice(0, from), pts[from]];
  const rotatedFlags = [...flags.slice(from), ...flags.slice(0, from), flags[from]];
  return runsOf(rotatedPts, rotatedFlags).map((piece) => ({ pts: piece.pts, label, outlined: piece.outlined }));
}

// The path data of one ring's stretches: the fill (a closed ring) and the outline (the outlined pieces).
// `candidates` gives the exact curves a stretch may lie on. Consecutive stretches join at their shared point.
interface RingPaths {
  fill: string;
  outline: string;
}

export function ringPaths(stretches: Stretch[], whole: boolean, candidates: (st: Stretch) => Curve[], tol: number): RingPaths {
  if (stretches.length === 0) return { fill: "", outline: "" };
  if (whole) {
    const st = stretches[0];
    const best = bestCurve(candidates(st), st.pts, tol);
    if (best?.kind === "ellipse") {
      const d = `M${startOf(best.e, st.pts[0])}${fullEllipseArcs(best.e, pointAt(best.e, paramOf(best.e, st.pts[0])))}Z`;
      return { fill: d, outline: st.outlined ? d : "" };
    }
    const d = closedPath(st.pts);
    return { fill: d, outline: st.outlined ? d : "" };
  }
  // Each stretch's curve is chosen first, so the path can start on the first stretch's curve: an arc is drawn from the
  // current point, so that point must lie on its ellipse.
  const bests = stretches.map((st) => bestCurve(candidates(st), st.pts, tol));
  let cur: Pt = startOn(bests[0], stretches[0].pts[0]);
  let d = `M${fmtPt(cur)}`;
  const pieces: { start: Pt; cmd: string; outlined: boolean }[] = [];
  stretches.forEach((st, index) => {
    const start = cur;
    const piece = pieceFor(st, bests[index], start);
    cur = piece.end;
    d += piece.cmd;
    pieces.push({ start, cmd: piece.cmd, outlined: st.outlined });
  });
  d += "Z";
  return { fill: d, outline: outlineOf(pieces) };
}

// The command that carries the walk from `start` along a stretch on its best curve (a line, an arc, or the fitted Bézier),
// and the point it ends at.
function pieceFor(st: Stretch, best: Curve | null, start: Pt): { cmd: string; end: Pt } {
  const last = st.pts[st.pts.length - 1];
  if (best?.kind === "line") {
    const end = onLine(best.a, best.b, last);
    return { cmd: `L${fmtPt(end)}`, end };
  }
  if (best?.kind === "ellipse") {
    const end = pointAt(best.e, paramOf(best.e, last));
    return { cmd: arcTo(best.e, pointAt(best.e, paramOf(best.e, start)), end, st.pts), end };
  }
  return { cmd: fitCommands([start, ...st.pts.slice(1)]), end: last };
}

// The outline: consecutive outlined pieces as open paths.
function outlineOf(pieces: { start: Pt; cmd: string; outlined: boolean }[]): string {
  let out = "";
  let open = false;
  for (const p of pieces) {
    if (!p.outlined) {
      open = false;
      continue;
    }
    if (!open) out += `M${fmtPt(p.start)}`;
    out += p.cmd;
    open = true;
  }
  return out;
}

function bestCurve(curves: Curve[], pts: Pt[], tol: number): Curve | null {
  let best: Curve | null = null;
  let bestRms = tol;
  for (const c of curves) {
    const rms = curveRms(c, pts);
    if (rms <= bestRms) {
      best = c;
      bestRms = rms;
    }
  }
  return best;
}

// The snap tolerance in CSS px, from the render-px constant and the render scale.
export function snapTolerance(scale: number): number {
  return SNAP_TOL_RENDER_PX / scale;
}

// The point a stretch starts from: its first point, moved onto the curve it is written as.
function startOn(curve: Curve | null, p: Pt): Pt {
  if (!curve) return p;
  if (curve.kind === "line") return onLine(curve.a, curve.b, p);
  return pointAt(curve.e, paramOf(curve.e, p));
}

function startOf(e: Ellipse, p: Pt): string {
  return fmtPt(pointAt(e, paramOf(e, p)));
}
