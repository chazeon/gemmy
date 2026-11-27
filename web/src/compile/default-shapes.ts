// Default polyhedra for a structure opened without a config: the centre labels whose elements coordinate anions get one
// polyhedron rule each (a C_dna centre is a centre of its own, apart from a C one). The rule's ligands are the anion labels
// the centre's atoms actually bond to, found with the automatic bond windows (default-rules.ts), so a polyhedron's edges are
// the bonds detection would draw. Everything but the centre, the ligands and the window is the polyhedron schema's default
// (config.ts), so the rules validate and export like rules the user wrote.
import { type Color, type PolyhedronRule, type SceneConfig, parseSceneConfig } from "./config";
import { type ColourScheme, centreColourOf } from "./colour-schemes";
import {
  BOND_MIN_DISTANCE,
  type BondWindow,
  DEFAULT_DETECTION,
  candidateWindows,
  elementsOf,
  inWindow,
  type LabelledElement,
  labelsOf,
  longestReach,
  pairKey,
} from "./default-rules";
import type { NeighborSource, Structure } from "../structure/structure";

// The anions: the elements that bond to a centre as its ligands. A centre coordinated by these is a polyhedron (a
// silicate's Si in O, a salt's cation in Cl). The list is short on purpose: an anion is what a coordination shell is made of.
export const LIGAND_ELEMENTS: ReadonlySet<string> = new Set(["O", "S", "Se", "Te", "F", "Cl", "Br", "I", "N"]);

// Elements that never centre a polyhedron. H has one bond at most, and the noble gases do not coordinate.
const NON_CENTRE_ELEMENTS: ReadonlySet<string> = new Set(["H", "He", "Ne", "Ar", "Kr", "Xe", "Rn"]);

// The median number of anion neighbours of an element's atoms must lie in this range. Below 4 a centre is a bond, not a
// polyhedron (a protein's C has a few O neighbours and no shell). Above 12 there is no coordination shell to draw.
export const MIN_COORDINATION = 4;
export const MAX_COORDINATION = 12;

// A polyhedron rule as detection makes it: the centre label, its ligand labels, the window and the colour (the schema fills
// the rest).
interface DetectedPolyhedron {
  center: string;
  ligands: string[];
  min_distance: number;
  max_distance: number;
  color: Color;
  image_centers: boolean;
}

// An anion neighbour of a centre atom: the anion's label and the automatic bond window of the pair.
interface AnionBond {
  ligand: string;
  window: BondWindow;
}

// Whether an element can centre a polyhedron: any element that is not an anion, H or a noble gas.
function isCentreElement(symbol: string): boolean {
  return !LIGAND_ELEMENTS.has(symbol) && !NON_CENTRE_ELEMENTS.has(symbol);
}

// The median of a list of counts: the middle value, or the mean of the two middle values for an even count.
export function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function inCoordinationRange(coordination: number): boolean {
  return MIN_COORDINATION <= coordination && coordination <= MAX_COORDINATION;
}

// The anion neighbours of each centre atom, by atom index. A neighbour counts when its pair lies inside the pair's automatic
// bond window, so the anions counted are the ones the bonds would show. The window is the elements' (the pair's elements,
// not its labels), and the anion is named by its label. The neighbour list is full (each pair is seen from its centre), so
// reading it from the centre's side counts each bond once.
function anionBondsByAtom(source: NeighborSource, windows: Map<string, BondWindow>): Map<number, AnionBond[]> {
  const reach = longestReach(windows);
  const pairs = source.neighbors(reach);
  const anions = new Map<number, AnionBond[]>();
  for (let n = 0; n < pairs.i.length; n++) {
    const centre = source.symbols[pairs.i[n]];
    const ligand = source.symbols[pairs.j[n]];
    if (!isCentreElement(centre) || !LIGAND_ELEMENTS.has(ligand)) continue;
    const bondWindow = windows.get(pairKey(centre, ligand));
    if (bondWindow === undefined || !inWindow(bondWindow, pairs.d[n])) continue;
    const bonds = anions.get(pairs.i[n]) ?? [];
    bonds.push({ ligand: source.labels[pairs.j[n]], window: bondWindow });
    anions.set(pairs.i[n], bonds);
  }
  return anions;
}

// The indices of the atoms of each label, in the order the neighbour pairs refer to. One pass over the atoms, so a centre
// finds its atoms without a scan of all of them (a structure with a label per atom would make that quadratic).
function indicesByLabel(source: NeighborSource): Map<string, number[]> {
  const byLabel = new Map<string, number[]>();
  source.labels.forEach((label, index) => {
    const indices = byLabel.get(label);
    if (indices === undefined) byLabel.set(label, [index]);
    else indices.push(index);
  });
  return byLabel;
}

// The anion bonds of a label's atoms, one per bonded anion neighbour.
function anionBondsOf(atomIndices: number[], anions: Map<number, AnionBond[]>): AnionBond[] {
  return atomIndices.flatMap((index) => anions.get(index) ?? []);
}

// The polyhedron of a centre label as the config file writes it (the schema fills the rest), or null when its median
// coordination is out of range. Its colour is the centre's (centreColourOf).
function polyhedronOf(
  centre: LabelledElement,
  atomIndices: number[],
  anions: Map<number, AnionBond[]>,
  elements: SceneConfig["elements"],
  scheme: ColourScheme,
): DetectedPolyhedron | null {
  const coordinations = atomIndices.map((index) => (anions.get(index) ?? []).length);
  if (!inCoordinationRange(median(coordinations))) return null;
  const bonds = anionBondsOf(atomIndices, anions);
  const ligands = [...new Set(bonds.map((bond) => bond.ligand))].sort();
  // One window serves every ligand, so it reaches the longest of the ligands' bond windows. A loop, not a spread: a large
  // structure's bonds are more arguments than a call takes.
  let longestBond = 0;
  for (const bond of bonds) longestBond = Math.max(longestBond, bond.window.max);
  // An image of a centre is drawn as an atom, so it needs its polyhedron too, or it shows bare.
  return {
    center: centre.label,
    ligands,
    min_distance: BOND_MIN_DISTANCE,
    max_distance: longestBond,
    color: centreColourOf(elements, centre.label, centre.element, scheme),
    image_centers: true,
  };
}

// The default polyhedron rules of a structure, in atomic-number order of their centre elements, then by label. `styles` is
// the config's element styles and `scheme` the page's colour scheme: each rule's colour is its centre's (centreColourOf).
export function defaultPolyhedronRules(
  structure: Structure,
  source: NeighborSource,
  styles: SceneConfig["elements"],
  scheme: ColourScheme,
): PolyhedronRule[] {
  const windows = candidateWindows(elementsOf(structure), DEFAULT_DETECTION);
  const anions = anionBondsByAtom(source, windows);
  const atomsOf = indicesByLabel(source);
  const rules = labelsOf(structure)
    .filter((centre) => isCentreElement(centre.element))
    .map((centre) => polyhedronOf(centre, atomsOf.get(centre.label) ?? [], anions, styles, scheme))
    .filter((rule): rule is DetectedPolyhedron => rule !== null);
  // parseSceneConfig fills PolyhedronRule's defaults and checks the rules the way a user's config is checked.
  return parseSceneConfig({ polyhedra: rules }).polyhedra;
}
