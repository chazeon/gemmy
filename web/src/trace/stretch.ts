// Boundary stretches, their outline decision, and their snapping. A region's boundary is cut where the object on the other
// side changes (background, or another object). Each stretch is split where the live view's outline shell starts or stops
// along it (the shell mask of passes.ts, sampled in a thin band just outside the boundary). Each piece is then tested
// against the exact curves it could lie on (the caller supplies them): if one fits within SNAP_TOL_RENDER_PX (RMS), the piece
// is written as that exact primitive (L for a line, A for an ellipse); otherwise it falls back to the fitted Bézier of
// curves.ts. Consecutive pieces join where they meet.
import { type Curve, arcTo, curveRms, fullEllipseArcs, onLine, paramOf, pointAt } from "./exact";
import { closedPath, fitCommands, type Pt } from "./curves";
import type { Ring } from "./field";

// ---- constants ----
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

export interface Stretch {
  pts: Pt[]; // CSS px, along the boundary
  label: number; // the object on the outside of the stretch (0: background)
  outlined: boolean; // the live view's outline shell covers this piece's outside: its outline is drawn
}

// The label of the outside at one boundary point (render px): the 2x2 pixels around the point vote, and the winner is the
// object (or background) most of them show outside this object's region.
function labelAt(x: number, y: number, id: number, keys: Uint32Array, width: number, height: number): number | null {
  const left = Math.floor(x - 0.5);
  const top = Math.floor(y - 0.5);
  let inside = false;
  const votes = new Map<number, number>();
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const px = left + dx;
      const py = top + dy;
      const key = px >= 0 && py >= 0 && px < width && py < height ? keys[py * width + px] : 0;
      if (key !== 0 && key >> 1 === id) {
        inside = true;
        continue;
      }
      const label = key === 0 ? BACKGROUND : key >> 1;
      votes.set(label, (votes.get(label) ?? 0) + 1);
    }
  }
  if (!inside || votes.size === 0) return null;
  let best = -1;
  let bestCount = 0;
  for (const [label, count] of votes) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

// The stretches of one object's ring (render px in, CSS px out), each cut at label changes and at outline changes. A ring
// with one label and no outline change is one closed stretch.
export function stretchesOf(ring: Ring, id: number, keys: Uint32Array, width: number, height: number, scale: number, shell: Uint8Array): { stretches: Stretch[]; whole: boolean } {
  const labels = ring.map(([x, y]) => labelAt(x, y, id, keys, width, height));
  const first = labels.find((l) => l !== null);
  if (first === undefined) return { stretches: [], whole: false };
  let prev = first;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === null) labels[i] = prev;
    else prev = labels[i]!;
  }
  const css = ring.map(([x, y]): Pt => [x / scale, y / scale]);
  const ctx = { id, keys, width, height, scale, shell };
  if (labels.every((l) => l === labels[0])) {
    const flags = shellFlags(css, true, ctx);
    if (flags.every((f) => f === flags[0])) return { stretches: [{ pts: css, label: labels[0]!, outlined: flags[0] }], whole: true };
    return { stretches: cyclicRuns(css, flags, labels[0]!), whole: false };
  }
  // Start the walk at a label change, so no stretch is split by the ring's start.
  const start = labels.findIndex((l, i) => l !== labels[(i - 1 + labels.length) % labels.length]);
  const rotated = [...css.slice(start), ...css.slice(0, start)];
  const rotatedLabels = [...labels.slice(start), ...labels.slice(0, start)] as number[];
  const stretches: Stretch[] = [];
  for (let i = 0; i < rotated.length; ) {
    let j = i;
    while (j + 1 < rotated.length && rotatedLabels[j + 1] === rotatedLabels[i]) j++;
    // this label's span [i, j], cut again where the outline changes
    for (const piece of runsOf(rotated.slice(i, j + 1), shellFlags(rotated.slice(i, j + 1), false, ctx))) {
      stretches.push({ pts: piece.pts, label: rotatedLabels[i], outlined: piece.outlined });
    }
    i = j + 1;
  }
  return { stretches, whole: false };
}

// The outline flags of boundary points (CSS px). The outside of each point is the side that is not this object's region;
// the shell is sampled in the band just there.
function shellFlags(pts: Pt[], closed: boolean, ctx: { id: number; keys: Uint32Array; width: number; height: number; scale: number; shell: Uint8Array }): boolean[] {
  const n = pts.length;
  const raw = pts.map((p, i) => {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    let nx = ty / len;
    let ny = -tx / len;
    if (ownAt([p[0] + nx / ctx.scale, p[1] + ny / ctx.scale], ctx)) {
      nx = -nx;
      ny = -ny;
    }
    let hits = 0;
    for (const d of BAND_OFFSETS_PX) if (shellAt([p[0] + (nx * d) / ctx.scale, p[1] + (ny * d) / ctx.scale], ctx)) hits++;
    return hits * 2 > BAND_OFFSETS_PX.length;
  });
  return majority(raw, closed);
}

function ownAt(p: Pt, ctx: { id: number; keys: Uint32Array; width: number; height: number; scale: number }): boolean {
  const x = Math.floor(p[0] * ctx.scale);
  const y = Math.floor(p[1] * ctx.scale);
  if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height) return false;
  const key = ctx.keys[y * ctx.width + x];
  return key !== 0 && key >> 1 === ctx.id;
}

function shellAt(p: Pt, ctx: { width: number; height: number; scale: number; shell: Uint8Array }): boolean {
  const x = Math.floor(p[0] * ctx.scale);
  const y = Math.floor(p[1] * ctx.scale);
  return x >= 0 && y >= 0 && x < ctx.width && y < ctx.height && ctx.shell[y * ctx.width + x] === 1;
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
interface RingPaths { fill: string; outline: string }

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
    const best = bests[index];
    let cmd: string;
    if (best?.kind === "line") {
      const end = onLine(best.a, best.b, st.pts[st.pts.length - 1]);
      cmd = `L${fmtPt(end)}`;
      cur = end;
    } else if (best?.kind === "ellipse") {
      const from = pointAt(best.e, paramOf(best.e, start));
      const end = pointAt(best.e, paramOf(best.e, st.pts[st.pts.length - 1]));
      cmd = arcTo(best.e, from, end, st.pts);
      cur = end;
    } else {
      const pts = [start, ...st.pts.slice(1)];
      cmd = fitCommands(pts);
      cur = st.pts[st.pts.length - 1];
    }
    d += cmd;
    pieces.push({ start, cmd, outlined: st.outlined });
  });
  d += "Z";
  return { fill: d, outline: outlineOf(pieces) };
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

function startOf(e: { cx: number; cy: number; rx: number; ry: number; phi: number }, p: Pt): string {
  return fmtPt(pointAt(e, paramOf(e, p)));
}

function fmtPt(p: Pt): string {
  return `${Math.round(p[0] * 100) / 100 || 0} ${Math.round(p[1] * 100) / 100 || 0}`;
}
