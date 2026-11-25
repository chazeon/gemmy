// The geometry readout: the text for the selected atom, bond or polyhedron (distances, the distortion, the fractional and
// Cartesian positions), as data the React info card draws (src/react/info-card.tsx). The Center button frames the shown
// object as Fit frames the structure.
import { signal } from "@preact/signals-core";
import * as THREE from "three";
import { loaded, type Target } from "../state";
import { centreOn } from "../camera/view";
import { lookAlongAt } from "./views";
import type { AtomPrimitive, BondPrimitive, Point, PolyhedronPrimitive, Vec3 } from "../types";

const ANGSTROM_DIGITS = 3;
const FRACTIONAL_DIGITS = 4;
const DELTA_SCALE = 1e4; // the distortion is shown in units of 10^-4
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

// One end of a bond: its element, and its reference (null when the point has none).
export interface BondEnd {
  element: string;
  ref: string | null;
}

export type Readout =
  | { kind: "none" }
  | {
      kind: "bond";
      name: string; // the title, the two elements with an en dash: "Si–O bond"
      length: string;
      ends: [BondEnd, BondEnd];
    }
  | {
      kind: "polyhedron";
      name: string;
      centre: string;
      bonds: string;
      mean: string;
      delta: string;
    }
  | {
      kind: "atom";
      element: string;
      ref: string | null;
      fractional: string | null;
      cartesian: string;
      host: string | null; // the element of the polyhedron centre this atom is a corner of
      neighbours: string | null;
    };

// What the card shows now; the card re-renders when it changes (src/react/use-signal.ts).
export const readout = signal<Readout>({ kind: "none" });

// The distance between two points, in the scene's units (angstroms).
export function dist(a: Vec3, b: Vec3): number {
  return new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
}

function pointOf(id: string): Point {
  const point = loaded.value.points.get(id);
  if (!point) throw new Error(`gemmy viewer: the scene has no point ${id}`);
  return point;
}
// A number written with fixed digits, as the readout shows it.
function formatDigits(x: number, digits = ANGSTROM_DIGITS): string {
  return x.toFixed(digits);
}
function average(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}
// Digits as subscripts, so a polyhedron named "Si6" reads Si₆.
function subscripts(s: string): string {
  return s.replace(/\d+/g, (m) => [...m].map((c) => SUBSCRIPT_DIGITS[Number(c)]).join(""));
}
// Equal distances written once with a count: "2 × 1.970, 2.011".
function grouped(values: number[]): string {
  const counts = new Map<string, number>();
  for (const x of values) counts.set(formatDigits(x), (counts.get(formatDigits(x)) || 0) + 1);
  return [...counts]
    .sort((p, q) => Number(p[0]) - Number(q[0]))
    .map(([x, n]) => (n > 1 ? `${n} × ${x}` : x))
    .join(", ");
}

// The object the readout shows, for its Center button.
let shown: Target | null = null;

// The Center button's framing: the object's centre and size in scene units (the origin is the structure's middle). An
// atom's size is its diameter; a bond's is its length plus a radius at each end; a polyhedron's is the diagonal of the
// box round its corners, and its centre the box's.
function objectBounds(target: Target): { centre: THREE.Vector3; size: number } {
  const offset = new THREE.Vector3(...loaded.value.centre);
  if (target.kind === "atom") {
    const position = new THREE.Vector3(...pointOf(target.atom.point_id).position).sub(offset);
    return { centre: position, size: 2 * target.atom.radius };
  }
  if (target.kind === "bond") {
    const a = new THREE.Vector3(...pointOf(target.bond.a_point_id).position);
    const b = new THREE.Vector3(...pointOf(target.bond.b_point_id).position);
    return { centre: a.clone().lerp(b, 0.5).sub(offset), size: a.distanceTo(b) + 2 * target.bond.radius };
  }
  const corners = target.poly.ligand_point_ids.map((id) => new THREE.Vector3(...pointOf(id).position));
  const box = new THREE.Box3().setFromPoints(corners);
  return { centre: box.getCenter(new THREE.Vector3()).sub(offset), size: box.min.distanceTo(box.max) };
}

function polyhedronReadout(p: PolyhedronPrimitive): Readout {
  const centre = pointOf(p.center_point_id);
  const bonds = p.ligand_point_ids.map((id) => dist(centre.position, pointOf(id).position));
  const mean = average(bonds);
  const distortion = average(bonds.map((x) => ((x - mean) / mean) ** 2));
  const centreText = centre.fractional
    ? `${centre.element} at (${centre.fractional.map((x) => formatDigits(x, FRACTIONAL_DIGITS)).join(", ")})`
    : centre.element;
  return {
    kind: "polyhedron",
    name: subscripts(p.name ?? "Polyhedron"),
    centre: centreText,
    bonds: grouped(bonds),
    mean: formatDigits(mean),
    delta: (distortion * DELTA_SCALE).toFixed(2),
  };
}

function bondReadout(b: BondPrimitive): Readout {
  const a = pointOf(b.a_point_id);
  const c = pointOf(b.b_point_id);
  return {
    kind: "bond",
    name: `${b.a_element}–${b.b_element} bond`,
    length: formatDigits(dist(a.position, c.position)),
    ends: [
      { element: b.a_element, ref: a.ref ?? null },
      { element: b.b_element, ref: c.ref ?? null },
    ],
  };
}

function atomReadout(a: AtomPrimitive): Readout {
  const point = pointOf(a.point_id);
  const hosts = loaded.value.polyhedra.filter((p) => p.ligand_point_ids.includes(a.point_id));
  const neighbours = hosts.map((p) => dist(point.position, pointOf(p.center_point_id).position));
  return {
    kind: "atom",
    element: point.element,
    ref: point.ref ?? null,
    fractional: point.fractional ? point.fractional.map((x) => formatDigits(x, FRACTIONAL_DIGITS)).join(", ") : null,
    cartesian: point.position.map((x) => formatDigits(x)).join(", "),
    host: hosts.length ? pointOf(hosts[0].center_point_id).element : null,
    neighbours: hosts.length ? grouped(neighbours) : null,
  };
}

// Fills the readout for a pick (or shows the empty state for none).
export function describe(target: Target | null): void {
  shown = target;
  if (!target) readout.value = { kind: "none" };
  else if (target.kind === "polyhedron") readout.value = polyhedronReadout(target.poly);
  else if (target.kind === "bond") readout.value = bondReadout(target.bond);
  else readout.value = atomReadout(target.atom);
}

// The Center button: frames the shown object.
export function centreShown(): void {
  if (!shown) return;
  const { centre, size } = objectBounds(shown);
  centreOn(centre, size);
}

// The same, looking along a cell axis (the card's a, b and c).
export function centreShownAlong(axis: "a" | "b" | "c"): void {
  if (!shown) return;
  const { centre, size } = objectBounds(shown);
  lookAlongAt(axis, centre, size);
}
