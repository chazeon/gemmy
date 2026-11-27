// Default rings for a structure opened without a config: the flat rings of 5 or 6 atoms, drawn as filled cluster rules of
// kind "ring" (config.ts). Detection finds the chordless cycles of such atoms over the automatic bond windows
// (default-rules.ts), keeps the planar ones (every atom near the ring's plane), and makes one rule per label set, whose sizes
// are a range ("C 6-ring", "C_dna 6-ring", "C,N 5–6-ring"). A rule's distance window is the bond windows of the ring's
// elements, and its colour is the centre colour of the label set's most common label (colour-schemes.ts). Everything else
// is the cluster schema's own default (config.ts).
import { type ClusterRule, type Color, parseSceneConfig, type SceneConfig } from "./config";
import {
  BOND_MIN_DISTANCE,
  type BondWindow,
  DEFAULT_DETECTION,
  candidateWindows,
  elementsOf,
  inWindow,
  isMetal,
  type LabelledElement,
  longestReach,
  pairKey,
} from "./default-rules";
import { isFlatRing } from "./clusters";
import { type ColourScheme, centreColourOf } from "./colour-schemes";
import { atomicNumber } from "../structure/elements";
import type { NeighborPairs, NeighborSource, Structure } from "../structure/structure";
import { vadd, vscale } from "../geom/vector";
import type { Vec3 } from "../types";
import { type Shift, addShifts, isZeroShift, sameShift } from "./sites";

// The ring sizes detection looks for: the aromatic rings (benzene, pyridine, the rings of the DNA bases and the aromatic
// amino acids) and the other common five-membered rings. Larger rings in MOFs and zeolites are frameworks, not rings to fill.
export const RING_SIZES: readonly number[] = [5, 6];

// The most steps (neighbour pairs read to build the graph, and bonds followed by the search) before detection gives up
// on the structure: no rings, and no freeze. Apoferritin (33k atoms) detects in under a tenth of a second, well inside it.
export const RING_SEARCH_STEPS = 10_000_000;

// A ring atom is a non-metal that is not H: a ring of H atoms would be a bond, and metals make no rings to fill.
function isRingAtom(symbol: string): boolean {
  return atomicNumber(symbol) > 0 && !isMetal(symbol) && symbol !== "H";
}

// A bond between two ring atoms: the atom it reaches and the cell offset of that atom from the first.
interface RingBond {
  index: number;
  shift: Shift;
}

type RingBonds = Map<number, RingBond[]>;

// A ring member: an atom and the cell offset that places it, from the ring's origin (the lowest member, at offset zero).
interface Member {
  index: number;
  shift: Shift;
}

// Thrown when the search has taken RING_SEARCH_STEPS steps: detection gives up on the structure.
class SearchOutOfSteps extends Error {}

class StepBudget {
  private left = RING_SEARCH_STEPS;

  spend(): void {
    this.left -= 1;
    if (this.left < 0) throw new SearchOutOfSteps();
  }
}

// The bonds among ring atoms: each neighbour pair inside its automatic window. The list holds each bond from both ends.
// Each pair spends a step too, so a graph too large to search is given up on like a search too large (planarRings).
function ringBondsOf(
  pairs: NeighborPairs,
  source: NeighborSource,
  windows: Map<string, BondWindow>,
  budget: StepBudget,
): RingBonds {
  const bonds: RingBonds = new Map();
  for (let n = 0; n < pairs.i.length; n++) {
    budget.spend();
    const [from, to] = [pairs.i[n], pairs.j[n]];
    if (from === to) continue; // an atom's own periodic image is no ring
    const [symbolFrom, symbolTo] = [source.symbols[from], source.symbols[to]];
    if (!isRingAtom(symbolFrom) || !isRingAtom(symbolTo)) continue;
    const bondWindow = windows.get(pairKey(symbolFrom, symbolTo));
    if (bondWindow === undefined || !inWindow(bondWindow, pairs.d[n])) continue;
    const shift: Shift = [pairs.S[3 * n], pairs.S[3 * n + 1], pairs.S[3 * n + 2]];
    const list = bonds.get(from);
    if (list === undefined) bonds.set(from, [{ index: to, shift }]);
    else list.push({ index: to, shift });
  }
  return bonds;
}

// Every cycle of a size in RING_SIZES through `origin`, whose other members all have a higher index (so each cycle is
// walked from its lowest atom, and the origin sits at offset zero). Each cycle comes twice, once each way round.
function cyclesFrom(origin: number, bonds: RingBonds, budget: StepBudget): Member[][] {
  const cycles: Member[][] = [];
  const longest = Math.max(...RING_SIZES);
  const walk = (path: Member[]): void => {
    const here = path[path.length - 1];
    for (const bond of bonds.get(here.index) ?? []) {
      budget.spend();
      const there: Member = { index: bond.index, shift: addShifts(here.shift, bond.shift) };
      if (there.index === origin) {
        if (isZeroShift(there.shift) && RING_SIZES.includes(path.length)) cycles.push(path);
      } else if (there.index > origin && path.length < longest && !path.some((m) => m.index === there.index)) {
        walk([...path, there]);
      }
    }
  };
  walk([{ index: origin, shift: [0, 0, 0] }]);
  return cycles;
}

// The same cycle, whichever way it was walked and wherever its members are listed.
function cycleKey(cycle: Member[]): string {
  return cycle
    .map((m) => `${m.index}:${m.shift.join(",")}`)
    .sort()
    .join(";");
}

// Whether two ring members are bonded, other than through the ring's own steps.
function bondedMembers(a: Member, b: Member, bonds: RingBonds): boolean {
  return (bonds.get(a.index) ?? []).some(
    (bond) => bond.index === b.index && sameShift(addShifts(a.shift, bond.shift), b.shift),
  );
}

// A cycle with no bond across it: a chord would make it two smaller rings, so the cycle is not a ring of its own.
function isChordless(cycle: Member[], bonds: RingBonds): boolean {
  const last = cycle.length - 1;
  for (let a = 0; a < cycle.length; a++) {
    for (let b = a + 2; b < cycle.length; b++) {
      if (a === 0 && b === last) continue; // the closing step of the ring
      if (bondedMembers(cycle[a], cycle[b], bonds)) return false;
    }
  }
  return true;
}

// The position of a member: its atom moved by its cell offset.
function positionOf(member: Member, source: NeighborSource): Vec3 {
  return member.shift.reduce(
    (point, n, axis) => vadd(point, vscale(source.cell[axis], n)),
    source.positions[member.index] as number[],
  ) as Vec3;
}

// The planar chordless rings of size in RING_SIZES, each once. Returns null when the graph build or the search runs out of
// steps: the budget starts before the graph is built, so a huge structure is given up on before its graph is in memory.
function planarRings(
  source: NeighborSource,
  windows: Map<string, BondWindow>,
  pairs: NeighborPairs,
): Member[][] | null {
  const budget = new StepBudget();
  const rings: Member[][] = [];
  try {
    const bonds = ringBondsOf(pairs, source, windows, budget);
    for (const origin of [...bonds.keys()].sort((a, b) => a - b)) {
      const seen = new Set<string>();
      for (const cycle of cyclesFrom(origin, bonds, budget)) {
        const key = cycleKey(cycle);
        if (seen.has(key)) continue;
        seen.add(key);
        if (isChordless(cycle, bonds) && isFlatRing(cycle.map((m) => positionOf(m, source)))) rings.push(cycle);
      }
    }
  } catch (error) {
    if (error instanceof SearchOutOfSteps) return null;
    throw error;
  }
  return rings;
}

// The label counts of a ring, in sorted label order.
function countsOf(labels: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return new Map([...counts].sort(([a], [b]) => (a < b ? -1 : 1)));
}

// The name of a ring rule: its label set and sizes, as "C 6-ring", "C_dna 6-ring", "C,C_dna 5-ring" or, for a range of sizes,
// "C,N 5–6-ring" (an en dash). The same pattern as the panel's folder titles (shapes-nodes.ts).
function ringRuleName(atoms: string[], minSize: number, maxSize: number): string {
  const sizes = minSize === maxSize ? `${minSize}` : `${minSize}–${maxSize}`;
  return `${atoms.join(",")} ${sizes}-ring`;
}

// The most common label of a ring (the first in sorted order on a tie), with its element: the colour of the ring is taken
// from it.
function colourLabelOf(members: LabelledElement[]): LabelledElement {
  let best = "";
  let bestCount = 0;
  for (const [label, count] of countsOf(members.map((member) => member.label))) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  const member = members.find((candidate) => candidate.label === best);
  return { label: best, element: member?.element ?? best };
}

// A ring rule as detection makes it: the schema fills the rest (visible, material).
interface DetectedRing {
  kind: "ring";
  atoms: string[];
  min_distance: number;
  max_distance: number;
  min_size: number;
  max_size: number;
  flat: true;
  color: Color;
  name: string;
}

// The longest bond window among a ring's own neighbours: the distance window of a rule that draws it. The rule's window is
// one number for every pair of its atoms, so it reaches only the pairs the ring bonds, not every pair its elements make: a
// C,Si rule that reached the Si-Si window would take a benzene's C-C diagonals (2.42 A) for bonds. `elements` are the
// ring's elements in ring order (the windows are the elements').
function ringReach(elements: string[], windows: Map<string, BondWindow>): number {
  let reach = 0;
  elements.forEach((element, k) => {
    const bondWindow = windows.get(pairKey(element, elements[(k + 1) % elements.length]));
    if (bondWindow !== undefined) reach = Math.max(reach, bondWindow.max);
  });
  return reach;
}

// A group of rings: those of one label set and one size. The unit the merge decides on (keepUnmerged).
interface SizeGroup {
  size: number;
  atoms: string[]; // the group's labels, sorted: the rule's atoms
  members: LabelledElement[]; // every member's label and element, for the colour
  reach: number; // the distance window of the group's rule (ringReach, the longest over its rings)
  nearestContact: number; // the nearest pair of its labels that is not a bond of its windows (Infinity when none)
}

// A rule: the kept size groups of one label set. A cluster rule matches atoms by label, so it draws every ring of its labels
// with a size in its range; `flat` keeps only the flat ones.
interface RingGroup {
  atoms: string[];
  minSize: number;
  maxSize: number;
  members: LabelledElement[]; // every member's label and element, for the colour
  reach: number; // the longest of the size groups' windows (ringReach)
}

// The shortest distance between two atoms of the group's labels that its windows do not call a bond. A rule with a wider
// window would draw such a contact as a bond, so this is what the group's rings must stay short of. The window is the
// pair's elements'.
function nearestContactOf(
  atoms: string[],
  source: NeighborSource,
  windows: Map<string, BondWindow>,
  pairs: NeighborPairs,
): number {
  let nearest = Infinity;
  for (let n = 0; n < pairs.i.length; n++) {
    if (!atoms.includes(source.labels[pairs.i[n]]) || !atoms.includes(source.labels[pairs.j[n]])) continue;
    const distance = pairs.d[n];
    if (distance < BOND_MIN_DISTANCE) continue;
    const bondWindow = windows.get(pairKey(source.symbols[pairs.i[n]], source.symbols[pairs.j[n]]));
    if (bondWindow !== undefined && inWindow(bondWindow, distance)) continue;
    nearest = Math.min(nearest, distance);
  }
  return nearest;
}

// The groups of the rings, one per element set and size. A group merges into a larger element set of the same size when
// that rule draws exactly its rings (mergesInto), so a ring is drawn once; the kept groups are then one rule per element set
// (ruleGroupsOf).
function ringGroupsOf(
  rings: Member[][],
  source: NeighborSource,
  windows: Map<string, BondWindow>,
  pairs: NeighborPairs,
): RingGroup[] {
  const groups = new Map<string, SizeGroup>();
  for (const ring of rings) {
    const members = ring.map((m) => ({ label: source.labels[m.index], element: source.symbols[m.index] }));
    const atoms = [...new Set(members.map((member) => member.label))].sort();
    const key = JSON.stringify([ring.length, atoms]);
    const group = groups.get(key) ?? { size: ring.length, atoms, members: [], reach: 0, nearestContact: Infinity };
    group.members.push(...members);
    const elements = members.map((member) => member.element);
    group.reach = Math.max(group.reach, ringReach(elements, windows));
    groups.set(key, group);
  }
  const all = [...groups.values()].map((group) => ({
    ...group,
    nearestContact: nearestContactOf(group.atoms, source, windows, pairs),
  }));
  return ruleGroupsOf(keepUnmerged(all));
}

// One rule per element set: the kept size groups of a set become one group, whose sizes are their range and whose members
// and window are the union of theirs. The range draws only the sizes the groups kept, so no ring is drawn twice. That holds
// because RING_SIZES has two consecutive sizes: a size a larger rule took can then never lie between two sizes this set kept.
function ruleGroupsOf(groups: SizeGroup[]): RingGroup[] {
  const bySet = new Map<string, RingGroup>();
  for (const group of groups) {
    const key = group.atoms.join(",");
    const rule = bySet.get(key);
    if (rule === undefined) {
      bySet.set(key, {
        atoms: group.atoms,
        minSize: group.size,
        maxSize: group.size,
        members: [...group.members],
        reach: group.reach,
      });
    } else {
      rule.minSize = Math.min(rule.minSize, group.size);
      rule.maxSize = Math.max(rule.maxSize, group.size);
      rule.members.push(...group.members);
      rule.reach = Math.max(rule.reach, group.reach);
    }
  }
  return [...bySet.values()];
}

// The groups that keep a rule. Larger label sets are decided first, so a group merges into a rule that is itself kept.
function keepUnmerged(groups: SizeGroup[]): SizeGroup[] {
  const kept: SizeGroup[] = [];
  for (const group of [...groups].sort((a, b) => b.atoms.length - a.atoms.length)) {
    if (!kept.some((larger) => mergesInto(group, larger))) kept.push(group);
  }
  return kept;
}

// Whether the larger group's rule draws the rings of `group`, and only those: the same ring size, every label of
// `group` and more besides, a window that reaches the group's own bonds, and no contact of the group's labels inside that
// window (a benzene's 2.42 A diagonals, inside a C,Si window of 2.55 A, would break its rings).
function mergesInto(group: SizeGroup, larger: SizeGroup): boolean {
  return (
    larger.size === group.size &&
    larger.atoms.length > group.atoms.length &&
    group.atoms.every((atom) => larger.atoms.includes(atom)) &&
    larger.reach >= group.reach &&
    group.nearestContact > larger.reach
  );
}

// One cluster rule per ring group, in smallest size then name order.
function ringRulesOf(groups: RingGroup[], styles: SceneConfig["elements"], scheme: ColourScheme): DetectedRing[] {
  return groups
    .map((group) => ({ ...group, name: ringRuleName(group.atoms, group.minSize, group.maxSize) }))
    .sort((a, b) => a.minSize - b.minSize || (a.name < b.name ? -1 : 1))
    .map((group) => {
      const centre = colourLabelOf(group.members);
      return {
        kind: "ring" as const,
        atoms: group.atoms,
        min_distance: BOND_MIN_DISTANCE,
        max_distance: group.reach,
        min_size: group.minSize,
        max_size: group.maxSize,
        flat: true as const,
        color: centreColourOf(styles, centre.label, centre.element, scheme),
        name: group.name,
      };
    });
}

// The default ring rules of a structure, from the rings of 5 or 6 flat atoms its bonds make. Empty when the search runs out
// of steps (a huge structure) or no ring is flat. `styles` is the config's element styles and `scheme` the page's colour
// scheme (each rule's colour).
export function defaultRingRules(
  structure: Structure,
  source: NeighborSource,
  styles: SceneConfig["elements"],
  scheme: ColourScheme,
): ClusterRule[] {
  const windows = candidateWindows(elementsOf(structure), DEFAULT_DETECTION);
  // One neighbour list serves the bonds, the rings' contacts and the groups: it reaches the longest window.
  const pairs = source.neighbors(longestReach(windows));
  const rings = planarRings(source, windows, pairs);
  if (rings === null || rings.length === 0) return [];
  const groups = ringGroupsOf(rings, source, windows, pairs);
  // parseSceneConfig fills ClusterRule's defaults and checks the rules the way a user's config is checked.
  return parseSceneConfig({ clusters: ringRulesOf(groups, styles, scheme) }).clusters;
}
