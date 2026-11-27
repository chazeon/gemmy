// The geometry readout: the text for the selected atom, bond or polyhedron (distances, the distortion, the fractional and
// Cartesian positions), as data the React info card draws (src/react/info-card.tsx). The Center buttons are in
// readout-centre.ts: they draw the camera, and this file stays free of the page so the node tests can run it.
import { signal } from "@preact/signals-core";
import * as THREE from "three";
import { loaded, type Target } from "../state";
import type { AtomPrimitive, BondPrimitive, Point, PolyhedronPrimitive, Vec3 } from "../types";

const ANGSTROM_DIGITS = 3;
const FRACTIONAL_DIGITS = 4;
const DELTA_SCALE = 1e4; // the distortion is shown in units of 10^-4
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

// One end of a bond: its species label (the name the config and the panel use), and its reference (null when the point
// has none).
export interface BondEnd {
  label: string;
  ref: string | null;
}

export type Readout =
  | { kind: "none" }
  | {
      kind: "bond";
      name: string; // the title, the two labels with an en dash: "Si–O bond"
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
      label: string;
      ref: string | null;
      fractional: string | null;
      cartesian: string;
      host: string | null; // the label of the polyhedron centre this atom is a corner of
      neighbours: string | null;
    };

// What the card shows now; the card re-renders when it changes (src/react/use-signal.ts).
export const readout = signal<Readout>({ kind: "none" });

// The heading of a readout: the bond's or polyhedron's name, or the atom's label.
export function readoutTitle(data: Readout): string {
  if (data.kind === "none") return "Nothing selected";
  if (data.kind === "polyhedron" || data.kind === "bond") return data.name;
  return `${data.label} atom`;
}

// The notes the readout shows under its rows (the details card).
export const SUPERCELL_NOTE = "Fractional coordinates are in the supercell.";
export const DISTORTION_NOTE = `Δ is the bond-length distortion, the mean of ((d − d̄)/d̄)². ${SUPERCELL_NOTE}`;

// The object the readout shows, for the Center buttons (readout-centre.ts).
let shown: Target | null = null;
export function shownTarget(): Target | null {
  return shown;
}

// The distance between two points, in the scene's units (angstroms).
export function dist(a: Vec3, b: Vec3): number {
  return new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
}

export function pointOf(id: string): Point {
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

// The ids of the points that some atom primitive draws.
function atomPointIds(): Set<string> {
  return new Set(loaded.value.data?.primitives.atoms.map((atom) => atom.point_id) ?? []);
}
// A computed centre, such as a cluster's centroid: a point with no reference that no atom draws. It is not an atom, so
// it is no bond and no host.
function isComputed(point: Point, atomIds: Set<string>): boolean {
  return point.ref === null && !atomIds.has(point.id);
}

// The polyhedra this atom is a corner of, by their real centres (a cluster's centroid is not a host).
function hostsOf(a: AtomPrimitive, atomIds: Set<string>): PolyhedronPrimitive[] {
  const corners = loaded.value.polyhedra.filter((p) => p.ligand_point_ids.includes(a.point_id));
  return corners.filter((p) => !isComputed(pointOf(p.center_point_id), atomIds));
}

// The centre's row: its label with its fractional position, or "centroid" for a cluster's computed centre (the
// polyhedron's name is the title).
function centreText(centre: Point, atomIds: Set<string>): string {
  const label = isComputed(centre, atomIds) ? "centroid" : centre.label;
  if (!centre.fractional) return label;
  return `${label} at (${centre.fractional.map((x) => formatDigits(x, FRACTIONAL_DIGITS)).join(", ")})`;
}

function polyhedronReadout(p: PolyhedronPrimitive): Readout {
  const atomIds = atomPointIds();
  const centre = pointOf(p.center_point_id);
  // The measurements are the real members': a cluster's centroid is one of its ligands, and no bond.
  const members = p.ligand_point_ids.map((id) => pointOf(id)).filter((point) => !isComputed(point, atomIds));
  const bonds = members.map((member) => dist(centre.position, member.position));
  const mean = average(bonds);
  const distortion = average(bonds.map((x) => ((x - mean) / mean) ** 2));
  return {
    kind: "polyhedron",
    name: subscripts(p.name ?? "Polyhedron"),
    centre: centreText(centre, atomIds),
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
    name: `${b.a_label}–${b.b_label} bond`,
    length: formatDigits(dist(a.position, c.position)),
    ends: [
      { label: b.a_label, ref: a.ref ?? null },
      { label: b.b_label, ref: c.ref ?? null },
    ],
  };
}

function atomReadout(a: AtomPrimitive): Readout {
  const point = pointOf(a.point_id);
  const atomIds = atomPointIds();
  const hosts = hostsOf(a, atomIds);
  const neighbours = hosts.map((p) => dist(point.position, pointOf(p.center_point_id).position));
  return {
    kind: "atom",
    label: point.label,
    ref: point.ref ?? null,
    fractional: point.fractional ? point.fractional.map((x) => formatDigits(x, FRACTIONAL_DIGITS)).join(", ") : null,
    cartesian: point.position.map((x) => formatDigits(x)).join(", "),
    host: hosts.length ? pointOf(hosts[0].center_point_id).label : null,
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
