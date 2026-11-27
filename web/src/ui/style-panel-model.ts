// The style panel's pure helpers (react/style-panel): the slider ranges and default windows, read from the pair distances,
// the names a new rule starts with, the config's per-axis parts, and the wrapper that turns a rejected edit into a message.
// No React and no geometry here: the distances come from compile/pair-distances.ts and the edits from the compile/config-edit-*.ts files.
import { type Axis, type ElementStyle, type SceneConfig, defaultElementStyle } from "../compile/config";
import { elementPairKey } from "../compile/pair-distances";
import { ConfigError } from "../compile/config-errors";

export type Span = [number, number];
// The distances of each unordered element pair, sorted, keyed by elementPairKey (compile/pair-distances.ts).
export type PairDistances = Map<string, number[]>;
// Applies one config edit: the edit runs, and its result (or its rejection) goes to the panel's callbacks.
export type Apply = (edit: () => SceneConfig) => void;

// Sliders step in hundredths of an angstrom, and the slider of a pair reaches this far past its farthest distance.
export const DISTANCE_STEP = 0.01;
const DISTANCE_MARGIN = 0.25;
// The top of a pair's slider when the structure has no such pair, and the window a rule gets with no distances to read.
const FALLBACK_TOP = 6;
const FALLBACK_WINDOW: Span = [0, 3];
// A default window covers the first shell: distances closer than SHELL_GAP are one shell, and the window reaches
// WINDOW_MARGIN past the shell's ends (inside the gap, so it does not take in the next shell).
const SHELL_GAP = 0.3;
const WINDOW_MARGIN = 0.1;

export const ATOM_RADIUS_RANGE: Span = [0.05, 1.5];
export const BOND_RADIUS_RANGE: Span = [0.01, 0.5];
export const RADIUS_STEP = 0.01;
// The largest supercell the panel offers per axis (a panel limit, not a schema limit: the config accepts more).
export const MAX_SUPERCELL = 10;

const DASH = "–";

export function pairName(a: string, b: string): string {
  return `${a}${DASH}${b}`;
}

export function pairDistances(distances: PairDistances, a: string, b: string): number[] {
  return distances.get(elementPairKey(a, b)) ?? [];
}

// The distances of a centre to each of its ligands (a polyhedron's bonds).
export function distancesBetween(distances: PairDistances, centre: string, ligands: readonly string[]): number[] {
  return sortedUnion(ligands.map((ligand) => pairDistances(distances, centre, ligand)));
}

// The distances between every pair of a set, a name with itself included (a cluster's bonds).
export function distancesWithin(distances: PairDistances, names: readonly string[]): number[] {
  const lists = names.flatMap((first, i) => names.slice(i).map((second) => pairDistances(distances, first, second)));
  return sortedUnion(lists);
}

function sortedUnion(lists: readonly (readonly number[])[]): number[] {
  return lists.flat().sort((x, y) => x - y);
}

// The element pair a new bond starts with: among the pairs of `names` that have distances, the one whose first shell ends
// nearest, preferring two different names. Null when no pair has distances.
export function defaultPair(distances: PairDistances, names: readonly string[]): [string, string] | null {
  const pairs: { pair: [string, string]; edge: number }[] = [];
  names.forEach((first, i) => {
    for (const second of names.slice(i)) {
      const shells = pairDistances(distances, first, second);
      if (shells.length > 0) pairs.push({ pair: [first, second], edge: firstShellWindow(shells)[1] });
    }
  });
  const distinct = pairs.filter(({ pair: [first, second] }) => first !== second);
  const candidates = distinct.length > 0 ? distinct : pairs;
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => (candidate.edge < best.edge ? candidate : best)).pair;
}

// The two names a new bond's Add row starts with: the default pair, else the first name twice, and two empty names when
// there are none.
export function defaultBondNames(distances: PairDistances, names: readonly string[]): [string, string] {
  return defaultPair(distances, names) ?? [names[0] ?? "", names[0] ?? ""];
}

// The atoms a new cluster starts with: the nearest pair's names (one name when the pair is the same name twice).
export function defaultClusterAtoms(distances: PairDistances, names: readonly string[]): string[] {
  const pair = defaultPair(distances, names);
  return pair ? [...new Set(pair)] : [];
}

// A distance slider's range: from 0 to past the farthest distance of its pair (the fallback top when it has none).
export function distanceDomain(distances: readonly number[]): Span {
  const farthest =
    distances.length > 0 ? distances.reduce((top, distance) => Math.max(top, distance), 0) : FALLBACK_TOP;
  return [0, farthest + DISTANCE_MARGIN];
}

// The window a new rule starts with: the first distance shell of its pairs.
export function firstShellWindow(distances: readonly number[]): Span {
  if (distances.length === 0) return FALLBACK_WINDOW;
  const sorted = [...distances].sort((x, y) => x - y);
  let shellEnd = 0;
  while (shellEnd + 1 < sorted.length && sorted[shellEnd + 1] - sorted[shellEnd] <= SHELL_GAP) shellEnd += 1;
  return [Math.max(0, sorted[0] - WINDOW_MARGIN), sorted[shellEnd] + WINDOW_MARGIN];
}

// The atom's style, as config.elements holds it; a name with no entry shows the built-in style.
export function elementStyleOf(config: SceneConfig, name: string): ElementStyle {
  return Object.hasOwn(config.elements, name) ? config.elements[name] : defaultElementStyle();
}

// The window of a cell axis, as the config's box holds it (the whole cell, [0, 1], when the axis has no entry).
export function boxOf(config: SceneConfig, axis: Axis): Span {
  return config.cell.box[axis] ?? [0, 1];
}

// A value of a three-part setting (the supercell) with one part replaced.
export function withPart(
  parts: readonly [number, number, number],
  index: number,
  value: number,
): [number, number, number] {
  const next: [number, number, number] = [...parts];
  next[index] = value;
  return next;
}

// The chosen name when the structure still has it, else the first name (a list whose name went away shows a name).
export function chosenName(chosen: string, names: readonly string[]): string {
  return names.includes(chosen) ? chosen : (names[0] ?? "");
}

// An edit's wrapper: the result goes to onChange, and a rejected edit (ConfigError) goes to onError as its message.
export function applier(onChange: (next: SceneConfig) => void, onError: (message: string) => void): Apply {
  return (edit) => {
    try {
      onChange(edit());
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      onError(error.message);
    }
  };
}
