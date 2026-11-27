// Lattice geometry (compile/lattice.py): snapping and wrapping with a tolerance, display-box shifts and cartesian
// limits. Plain 3-vector arithmetic, in the order numpy does it. `cell` rows are lattice vectors.
import type { Vec3 } from "../types";
import type { Cell, Shift } from "./sites";

export type Interval = [number, number];
// The display box as config gives it: a range per axis; a missing axis is not limited (see resolveBox).
export type BoxRanges = Partial<Record<"x" | "y" | "z", Interval>>;
// The display box with every axis filled in: [x, y, z] ranges, the default [0, 1] where the config is silent.
export type Box = [Interval, Interval, Interval];

// lattice.offset: a position and fractional coordinates moved together.
export interface Offset {
  position: Vec3;
  fractional: Vec3;
}

// lattice.snap: the snapped fractional coordinates and the Cartesian position they stand for.
export interface Snapped {
  fractional: Vec3;
  position: Vec3;
}

// lattice.cell_box: the display box's origin and its three edge vectors, all Cartesian.
export interface CellBox {
  origin: Vec3;
  vectors: [Vec3, Vec3, Vec3];
}

const AXES = ["x", "y", "z"] as const;

// The most images boxShifts makes along one axis for one site: a backstop, since config only checks that a range is
// finite. The same value as MAX_IMAGES_PER_AXIS in src/gemmy/compile/lattice.py (tests/test_shared_constants.py).
export const MAX_IMAGES_PER_AXIS = 1000;

// The most sites a display box makes in all, copies included, and the most one site's copies may number. The page's atom
// budget (ui/load-budgets.ts, MAX_ATOMS_IN_PAGE) is the same number. The same value as MAX_BOX_SITES in
// src/gemmy/compile/lattice.py (tests/test_shared_constants.py checks they match).
export const MAX_BOX_SITES = 200_000;

// The largest whole number a shift may be (Number.MAX_SAFE_INTEGER): past it the shift loop stalls.
const MAX_SHIFT = Number.MAX_SAFE_INTEGER;

// np.round: half to even. JS Math.round rounds half up, so 2.5 would become 3.
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const fraction = x - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Python has no negative zero in an integer, so -0 (from a negated 0 or a ceiling) is read back as 0.
export function withoutNegativeZero(n: number): number {
  return n === 0 ? 0 : n;
}

// A row vector times the cell (coefficients @ cell), summed in the order of the rows.
function along(coefficients: Vec3, cell: Cell): Vec3 {
  const at = (c: number) => coefficients[0] * cell[0][c] + coefficients[1] * cell[1][c] + coefficients[2] * cell[2][c];
  return [at(0), at(1), at(2)];
}

// lattice.offset: position and fractional coordinates translated by an integer lattice shift.
export function offset(position: Vec3, fractional: Vec3, shift: Shift, cell: Cell): Offset {
  const moved = along(shift, cell);
  return {
    position: position.map((p, k) => p + moved[k]) as Vec3,
    fractional: fractional.map((f, k) => f + shift[k]) as Vec3,
  };
}

// One coordinate pulled onto the nearest integer when it is within eps of it.
function snapCoordinate(f: number, eps: number): number {
  const nearest = roundHalfEven(f);
  return Math.abs(f - nearest) <= eps ? nearest : f;
}

// lattice.snap: pull coordinates within eps of an integer onto it (0.99999 -> 1). Null when nothing moves.
export function snap(fractional: Vec3, position: Vec3, cell: Cell, eps: number): Snapped | null {
  const snapped = fractional.map((f) => snapCoordinate(f, eps)) as Vec3;
  if (snapped.every((s, k) => s === fractional[k])) return null;
  const delta = snapped.map((s, k) => s - fractional[k]) as Vec3;
  const moved = along(delta, cell);
  return { fractional: snapped, position: position.map((p, k) => p + moved[k]) as Vec3 };
}

// lattice.wrap_shift: the integer shift that brings a site into [0, 1) on periodic axes.
export function wrapShift(fractional: Vec3, periodic: readonly [boolean, boolean, boolean]): Shift {
  return AXES.map((_axis, k) => (periodic[k] ? withoutNegativeZero(-Math.floor(fractional[k])) : 0)) as Shift;
}

// lattice.resolve_box: the ranges of all three axes; an axis the config leaves out is [0, 1].
export function resolveBox(box: BoxRanges): Box {
  return AXES.map((axis) => {
    const range = box[axis];
    return range === undefined ? [0, 1] : [range[0], range[1]];
  }) as Box;
}

// lattice.cell_box: display box as origin + edge vectors (cartesian) of the supercell `cell`.
export function cellBox(cell: Cell, box: BoxRanges): CellBox {
  const ranges = resolveBox(box);
  const lows = ranges.map(([lo]) => lo) as Vec3;
  const vectors = ranges.map(([lo, hi], k) => cell[k].map((c) => (hi - lo) * c)) as [Vec3, Vec3, Vec3];
  return { origin: along(lows, cell), vectors };
}

// The integer shifts along one axis: the inclusive range [first, last] that puts a fractional coordinate in [lo, hi]
// (inclusive with eps). A non-periodic axis gives [0, 0] inside the box, and an empty range outside it when the box names
// that axis. A periodic range past the safe integers is refused: n + 1 === n there, so a loop over it never ends.
export interface ShiftRange {
  first: number;
  last: number;
}

export function axisRange(
  axis: string,
  fractional: number,
  lo: number,
  hi: number,
  eps: number,
  periodic: boolean,
  explicit: boolean,
): ShiftRange {
  if (!periodic) {
    const inside = lo - eps <= fractional && fractional <= hi + eps;
    return inside || !explicit ? { first: 0, last: 0 } : { first: 1, last: 0 };
  }
  const first = withoutNegativeZero(Math.ceil(lo - eps - fractional));
  const last = withoutNegativeZero(Math.floor(hi + eps - fractional));
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
    throw new Error(
      `box range ${axis} reaches past ${MAX_SHIFT} images (the largest whole number the page counts); narrow the box range ${axis}.`,
    );
  }
  return { first, last };
}

// The number of images one axis gives: the range's length, zero for an empty range.
function countOf(range: ShiftRange): number {
  return Math.max(range.last - range.first + 1, 0);
}

// _check_image_count: refuses a periodic axis whose range gives too many images, before any list of them is built.
function checkImageCount(axis: string, count: number): void {
  if (count > MAX_IMAGES_PER_AXIS) {
    throw new Error(
      `box range ${axis} gives ${count} images along ${axis} for one site (more than MAX_IMAGES_PER_AXIS = ${MAX_IMAGES_PER_AXIS}); narrow the box range ${axis}.`,
    );
  }
}

// The ranges of the three axes of one site, checked: each axis's count is within MAX_IMAGES_PER_AXIS.
function checkedRanges(fractional: Vec3, box: BoxRanges, periodic: readonly [boolean, boolean, boolean], eps: number) {
  const ranges = resolveBox(box);
  const explicit = AXES.map((axis) => box[axis] !== undefined);
  return AXES.map((axis, k) => {
    const range = axisRange(axis, fractional[k], ranges[k][0], ranges[k][1], eps, periodic[k], explicit[k]);
    if (periodic[k]) checkImageCount(axis, countOf(range));
    return range;
  });
}

// The shift order of lattice.box_shifts: the unshifted site first (its key is (False, (0, 0, 0))), then the rest in
// lexicographic order of the shift.
function compareShifts(a: Shift, b: Shift): number {
  const anyA = a.some((n) => n !== 0);
  const anyB = b.some((n) => n !== 0);
  if (anyA !== anyB) return anyA ? 1 : -1;
  for (let k = 0; k < 3; k++) {
    if (a[k] !== b[k]) return a[k] - b[k];
  }
  return 0;
}

// The images the three axes' ranges make together: the product of their counts.
function imagesOf(ranges: ShiftRange[]): number {
  return ranges.reduce((product, range) => product * countOf(range), 1);
}

// lattice.box_image_count: how many images the display box makes of one site, counted without listing any of them.
export function boxImageCount(
  fractional: Vec3,
  box: BoxRanges,
  periodic: readonly [boolean, boolean, boolean],
  eps: number,
): number {
  return imagesOf(checkedRanges(fractional, box, periodic, eps));
}

// lattice.check_box_sites: refuses a display box that would make more sites than MAX_BOX_SITES, before any is made.
// `atoms` is how many sites the box is made from (one for a single site), so the message names both.
export function checkBoxSites(copies: number, atoms: number): void {
  if (copies > MAX_BOX_SITES) {
    throw new Error(
      `the display box makes ${copies} sites from ${atoms} atoms (more than MAX_BOX_SITES = ${MAX_BOX_SITES}); narrow the box range.`,
    );
  }
}

// lattice.box_shifts: the lattice shifts that place a site inside the display box, one per boundary copy, origin first.
// The count is checked before any shift is listed, so a box too large to draw is refused in O(1).
export function boxShifts(
  fractional: Vec3,
  box: BoxRanges,
  periodic: readonly [boolean, boolean, boolean],
  eps: number,
): Shift[] {
  const ranges = checkedRanges(fractional, box, periodic, eps);
  checkBoxSites(imagesOf(ranges), 1);
  const perAxis = ranges.map((range) => {
    const shifts: number[] = [];
    for (let n = range.first; n <= range.last; n++) shifts.push(n);
    return shifts;
  });
  const shifts: Shift[] = [];
  // itertools.product order: the last axis changes fastest.
  for (const a of perAxis[0]) {
    for (const b of perAxis[1]) {
      for (const c of perAxis[2]) shifts.push([a, b, c]);
    }
  }
  return shifts.sort(compareShifts);
}

// lattice.within_limits: is the point inside the cartesian limits? An axis without a limit is not checked.
export function withinLimits(point: Vec3, limits: BoxRanges | null | undefined): boolean {
  if (!limits) return true;
  return AXES.every((axis, k) => {
    const limit = limits[axis];
    return limit === undefined || (limit[0] <= point[k] && point[k] <= limit[1]);
  });
}
