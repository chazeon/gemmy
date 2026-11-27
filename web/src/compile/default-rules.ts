// Default bonds for a structure opened without a config: the rules the page uses when the user has given none, as VESTA
// draws bonds by default. Two atoms are bonded when their distance lies in a window set by their covalent radii. The
// window is the element pair's (C_dna is carbon), and the rule names the labels of the bonded atoms: C-C, C-C_dna and
// C_dna-C_dna are rules of their own. Everything but the pair and the window is BondRule's own default (config.ts), so
// the rules validate and export like rules the user wrote.
import { type BondRule, parseSceneConfig } from "./config";
import type { NeighborSource, Structure } from "../structure/structure";
import { DUMMY_ELEMENT, atomicNumber } from "../structure/elements";
import covalentRadiiTable from "./covalent-radii.json";

// The shortest distance that counts as a bond. Closer pairs are atoms on top of each other (an atom and its own image, or
// two sites on one spot), not bonds. The shortest real bond, H-H in H2, is 0.74 A, so 0.4 A cuts nothing real.
export const BOND_MIN_DISTANCE = 0.4;

// The window's upper end is the sum of the two covalent radii, plus this fraction of that sum. Bond detection from radii
// usually uses a tolerance on the sum (ASE's natural_cutoffs uses the bare sum, mult = 1). 15% is the value chosen here,
// not a constant copied from another code.
export const BOND_TOLERANCE = 0.15;

// The options a detection takes. The tolerance widens the window (see BOND_TOLERANCE); metalPairs gives metal-metal pairs a
// window too (off by default: their contacts are metallic).
export interface DetectionOptions {
  tolerance: number;
  metalPairs: boolean;
}

export const DEFAULT_DETECTION: DetectionOptions = { tolerance: BOND_TOLERANCE, metalPairs: false };

// The non-metals. The metalloids B, Si, As and Te are here too: in the structures gemmy shows they bond covalently
// (Si-O, B-N, As-S, Te-O), so a default bond from them is a bond, not a metallic contact. Every other known element is a
// metal.
const NONMETALS: ReadonlySet<string> = new Set([
  "H",
  "He",
  "B",
  "C",
  "N",
  "O",
  "F",
  "Ne",
  "Si",
  "P",
  "S",
  "Cl",
  "Ar",
  "As",
  "Se",
  "Br",
  "Kr",
  "Te",
  "I",
  "Xe",
  "At",
  "Rn",
]);

// Whether a symbol is a known element that is not a non-metal.
export function isMetal(symbol: string): boolean {
  return atomicNumber(symbol) > 0 && !NONMETALS.has(symbol);
}

export interface BondWindow {
  a: string; // the element with the lower atomic number
  b: string;
  min: number;
  max: number;
}

// The two symbols with the lower atomic number first, so an element pair has one name in either order.
function inAtomicOrder(first: string, second: string): [string, string] {
  return atomicNumber(first) <= atomicNumber(second) ? [first, second] : [second, first];
}

// The map key of an element pair, as JSON (collision-free for any symbol).
export function pairKey(first: string, second: string): string {
  return JSON.stringify(inAtomicOrder(first, second));
}

// The covalent radius of an element in angstrom, or null when the table has none.
function covalentRadius(symbol: string): number | null {
  const table: Record<string, unknown> = covalentRadiiTable;
  const radius = table[symbol];
  return typeof radius === "number" ? radius : null;
}

// The window of an element pair, or null when it has none: the dummy element, an element with no radius, or two metals
// (unless the options allow metal pairs).
function windowOf(first: string, second: string, options: DetectionOptions): BondWindow | null {
  const [a, b] = inAtomicOrder(first, second);
  const radiusA = covalentRadius(a);
  const radiusB = covalentRadius(b);
  if (radiusA === null || radiusB === null) return null;
  if (a === DUMMY_ELEMENT || b === DUMMY_ELEMENT) return null;
  if (!options.metalPairs && isMetal(a) && isMetal(b)) return null;
  return { a, b, min: BOND_MIN_DISTANCE, max: (radiusA + radiusB) * (1 + options.tolerance) };
}

// The structure's elements, in atomic-number order.
export function elementsOf(structure: Structure): string[] {
  const symbols = new Set(structure.atoms.map((atom) => atom.element));
  return [...symbols].sort((x, y) => atomicNumber(x) - atomicNumber(y));
}

// A label of the structure and the element it is (its atoms' element): the pairs and centres detection names by label.
export interface LabelledElement {
  label: string;
  element: string;
}

// The structure's labels with their elements, in atomic-number order of the elements, then by label. A label is an atom's
// style key, or its element when it has none.
export function labelsOf(structure: Structure): LabelledElement[] {
  const elementOf = new Map<string, string>();
  for (const atom of structure.atoms) {
    const label = atom.styleKey || atom.element;
    if (!elementOf.has(label)) elementOf.set(label, atom.element);
  }
  return [...elementOf]
    .map(([label, element]) => ({ label, element }))
    .sort((x, y) => atomicNumber(x.element) - atomicNumber(y.element) || compareText(x.label, y.label));
}

function compareText(x: string, y: string): number {
  return x < y ? -1 : Number(x > y);
}

// The window of every element pair of the elements. The map keeps the order of the pairs: by the first element's atomic
// number, then the second's.
export function candidateWindows(elements: string[], options: DetectionOptions): Map<string, BondWindow> {
  const windows = new Map<string, BondWindow>();
  elements.forEach((first, i) => {
    for (const second of elements.slice(i)) {
      const bondWindow = windowOf(first, second, options);
      if (bondWindow !== null) windows.set(pairKey(first, second), bondWindow);
    }
  });
  return windows;
}

// The longest upper end of a set of windows: the reach of a neighbour list that every one of them can use. 0 for none.
export function longestReach(windows: Map<string, BondWindow>): number {
  let reach = 0;
  for (const bondWindow of windows.values()) reach = Math.max(reach, bondWindow.max);
  return reach;
}

export function inWindow(bondWindow: BondWindow, distance: number): boolean {
  return bondWindow.min <= distance && distance <= bondWindow.max;
}

// A bonded pair of labels: the two labels in the order of their elements (then by label), and the window of their elements.
interface BondedPair {
  a: string;
  b: string;
  bondWindow: BondWindow;
}

// The label pair of two atoms, in the order of their elements' atomic numbers and then by label, so a pair has one name.
function labelPairOf(first: LabelledElement, second: LabelledElement): [string, string] {
  const byElement = atomicNumber(first.element) - atomicNumber(second.element);
  const inOrder = byElement < 0 || (byElement === 0 && first.label <= second.label);
  return inOrder ? [first.label, second.label] : [second.label, first.label];
}

// The label pairs with a neighbour pair inside the window of their elements. One neighbour list serves every pair, so it
// is read once, out to the widest window.
function bondedPairsOf(source: NeighborSource, windows: Map<string, BondWindow>, widest: number): BondedPair[] {
  const bonded = new Map<string, BondedPair>();
  const pairs = source.neighbors(widest);
  for (let n = 0; n < pairs.i.length; n++) {
    const bondWindow = windows.get(pairKey(source.symbols[pairs.i[n]], source.symbols[pairs.j[n]]));
    if (bondWindow === undefined || !inWindow(bondWindow, pairs.d[n])) continue;
    const [a, b] = labelPairOf(
      { label: source.labels[pairs.i[n]], element: source.symbols[pairs.i[n]] },
      { label: source.labels[pairs.j[n]], element: source.symbols[pairs.j[n]] },
    );
    const key = JSON.stringify([a, b]);
    if (!bonded.has(key)) bonded.set(key, { a, b, bondWindow });
  }
  return [...bonded.values()];
}

// The order of bonded pairs: by the atomic numbers of their elements, then by their labels.
function byElementThenLabel(x: BondedPair, y: BondedPair): number {
  return (
    atomicNumber(x.bondWindow.a) - atomicNumber(y.bondWindow.a) ||
    atomicNumber(x.bondWindow.b) - atomicNumber(y.bondWindow.b) ||
    compareText(x.a, y.a) ||
    compareText(x.b, y.b)
  );
}

// The default bond rules of a structure, in atomic-number order of their element pairs, then by label.
//
// By default two metals get no rule. Their contacts are metallic, not bonds, and a metal-only structure then shows no
// default bonds (a config can still ask for metal-metal bonds, and options.metalPairs gives them windows). This departs from
// VESTA, which keeps any pair inside its window: rock-salt MgO would get Mg-Mg, whose nearest distance (2.97 A) is inside
// the window (up to 3.24 A). Any other pair that occurs in its window gets a rule, H-H included.
//
// A rule has `complete: "none"`: it bonds only atoms that are shown. The default `ends` would also pull in the atom
// across a box face, so a bond at the cell edge gets a dangling atom outside the box.
export function defaultBondRules(
  structure: Structure,
  source: NeighborSource,
  options: DetectionOptions = DEFAULT_DETECTION,
): BondRule[] {
  const windows = candidateWindows(elementsOf(structure), options);
  const widest = longestReach(windows);
  const bonds = bondedPairsOf(source, windows, widest)
    .sort(byElementThenLabel)
    .map(({ a, b, bondWindow }) => ({
      a,
      b,
      min_distance: bondWindow.min,
      max_distance: bondWindow.max,
      complete: "none" as const,
    }));
  // parseSceneConfig fills BondRule's defaults and checks the rules the way a user's config is checked.
  return parseSceneConfig({ bonds }).bonds;
}
