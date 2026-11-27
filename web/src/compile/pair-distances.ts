// What the structure offers the style panel (docs/plans/stage6-panel.md, section 2): the names a new rule can use, the
// distances between each pair of elements (the bond slider's range and ticks), and a histogram of those distances.
// Pairs are keyed by label (the names a rule uses), in the order of their elements' atomic numbers: "O-Mg", "O-Si".
import { atomicNumber, elementOfLabel } from "../structure/elements";
import type { NeighborSource, Structure } from "../structure/structure";
import type { Vec3 } from "../types";

// Two distances closer than this are one distance. The neighbour search reports each pair from both atoms, and rounding
// can split one shell into two values a hair apart.
export const DISTANCE_TOLERANCE = 1e-6;
// The element of a dummy atom (a LAMMPS type the map does not resolve, or a placeholder). It is no pair the panel shows.
const DUMMY_ELEMENT = "X";

// The most neighbour pairs the distances read. The panel reads the cell out to 4 A, and a dense cluster (10k atoms in 1 A^3)
// has about 1e8 pairs at that cutoff, more than the page can hold. Past this the read stops at a shorter reach, and the
// distances are partial.
export const MAX_HISTOGRAM_PAIRS = 2_000_000;

export interface PairDistanceRead {
  // Keyed by elementPairKey, sorted, without repeats.
  distances: Map<string, number[]>;
  // True when the read reaches less far than the cutoff asked, or stopped at MAX_HISTOGRAM_PAIRS: the histogram is partial.
  partial: boolean;
}

// The pairs within a cutoff, estimated from the cell's density (every atom sees the atoms of its density in a sphere), so
// the neighbour list is not built when it would be too large. A cell with no volume (a molecule with no cell) takes the
// volume of its atoms' bounding box, each side at least the cutoff thick.
function estimatedPairs(source: NeighborSource, cutoff: number): number {
  const atoms = source.positions.length;
  const volume = Math.abs(determinant(source.cell)) || boundingVolume(source.positions, cutoff);
  return (atoms * atoms * (4 / 3) * Math.PI * cutoff ** 3) / volume;
}

function determinant([a, b, c]: [Vec3, Vec3, Vec3]): number {
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

function boundingVolume(positions: readonly Vec3[], minimumSide: number): number {
  let volume = 1;
  for (let axis = 0; axis < 3; axis++) {
    let low = Infinity;
    let high = -Infinity;
    for (const point of positions) {
      low = Math.min(low, point[axis]);
      high = Math.max(high, point[axis]);
    }
    volume *= Math.max(high - low, minimumSide);
  }
  return volume;
}

// The distances of each unordered label pair up to `cutoff`, sorted, with repeats within DISTANCE_TOLERANCE dropped.
// One neighbour query serves every pair. A pair with a dummy element is left out. A cutoff whose pairs would pass the
// budget is read out to the shorter reach that holds about the budget, and the read is partial.
export function pairDistances(source: NeighborSource, cutoff: number): PairDistanceRead {
  const estimate = estimatedPairs(source, cutoff);
  const reach = estimate > MAX_HISTOGRAM_PAIRS ? cutoff * Math.cbrt(MAX_HISTOGRAM_PAIRS / estimate) : cutoff;
  const pairs = source.neighbors(reach);
  const byPair = new Map<string, number[]>();
  let partial = reach < cutoff;
  for (let n = 0; n < pairs.d.length; n++) {
    if (n === MAX_HISTOGRAM_PAIRS) {
      partial = true;
      break;
    }
    if (isDummy(source.symbols[pairs.i[n]]) || isDummy(source.symbols[pairs.j[n]])) continue;
    const key = elementPairKey(source.labels[pairs.i[n]], source.labels[pairs.j[n]]);
    const distances = byPair.get(key);
    if (distances === undefined) byPair.set(key, [pairs.d[n]]);
    else distances.push(pairs.d[n]);
  }
  const distances = new Map([...byPair].map(([key, values]) => [key, distinctSorted(values)]));
  return { distances, partial };
}

export interface Histogram {
  // bins + 1 edges, from the smallest distance to the largest.
  edges: number[];
  // One count per bin: bin k holds [edges[k], edges[k + 1]), and the last bin also holds its upper edge.
  counts: number[];
}

// The counts of the distances in equal-width bins. The range is the distances' own, so a single distance (or none at
// all) still gives bins: one distance fills the first bin, no distances give empty bins over [0, 1].
export function distanceHistogram(distances: readonly number[], bins: number): Histogram {
  if (!Number.isInteger(bins) || bins < 1) throw new RangeError("bins must be a whole number of 1 or more");
  const [low, high] = distances.length > 0 ? extent(distances) : [0, 1];
  const binWidth = (high > low ? high - low : 1) / bins;
  const edges = Array.from({ length: bins + 1 }, (_, edge) => low + edge * binWidth);
  const counts = new Array<number>(bins).fill(0);
  for (const distance of distances) counts[binOf(distance, low, binWidth, bins)] += 1;
  return { edges, counts };
}

// The labels the structure's atoms have, sorted and without repeats. These are the names a rule or a polyhedron can use:
// a label is an atom's style key (the POSCAR species, or the symbol), and an atom with no style key is named by its element.
export function presentNames(structure: Structure): string[] {
  const names = new Set<string>();
  for (const atom of structure.atoms) names.add(atom.styleKey || atom.element);
  return [...names].sort();
}

// The key of a pair of names: the two in the order of their elements' atomic numbers, as JSON (["O","Mg"]), so no name can
// collide with another pair (a joined "C-O-O" would be both (C, O-O) and (C-O, O)). A name that names no element (-1) comes
// before the elements, and two names with the same number go in string order (C before C_dna). Display uses pairName.
export function elementPairKey(first: string, second: string): string {
  const [low, high] = compareNames(first, second) <= 0 ? [first, second] : [second, first];
  return JSON.stringify([low, high]);
}

function compareNames(first: string, second: string): number {
  const byNumber = numberOf(first) - numberOf(second);
  if (byNumber !== 0) return byNumber;
  return first < second ? -1 : Number(first > second);
}

// The atomic number of the element a label names (elementOfLabel: C_dna is carbon), or -1 for a label that names none.
function numberOf(label: string): number {
  return atomicNumber(elementOfLabel(label) ?? "");
}

function isDummy(element: string): boolean {
  return element === DUMMY_ELEMENT;
}

// The values in ascending order, a value within DISTANCE_TOLERANCE of the one before it dropped.
function distinctSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const value of sorted) {
    if (kept.length === 0 || value - kept[kept.length - 1] > DISTANCE_TOLERANCE) kept.push(value);
  }
  return kept;
}

function extent(values: readonly number[]): [number, number] {
  let low = values[0];
  let high = values[0];
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return [low, high];
}

// The bin of a distance. The top distance is the last bin's, not a bin of its own.
function binOf(distance: number, low: number, binWidth: number, bins: number): number {
  const position = Math.floor((distance - low) / binWidth);
  return Math.min(position, bins - 1);
}
