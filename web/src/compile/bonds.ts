// Bonds: the neighbour graph, rule matching, bond detection, closing (the last pass over the shown set) and secondary
// completion of polyhedron ligands (compile/bonds.py). Every order here is Python's: lists keep their order.
import type { NeighborSource } from "../structure/structure";
import type { BondRule } from "./config";
import { type Cell, type PointKey, type Shift, type Site, addShifts, image, nameMatches, pointKey } from "./sites";

export interface Neighbor {
  index: number;
  shift: Shift;
  distance: number;
}

export type NeighborGraph = Map<number, Neighbor[]>;

// Python's tuple order on (index, shift): the list order every stage depends on.
function compareNeighbors(a: Neighbor, b: Neighbor): number {
  if (a.index !== b.index) return a.index - b.index;
  for (let axis = 0; axis < 3; axis++) {
    if (a.shift[axis] !== b.shift[axis]) return a.shift[axis] - b.shift[axis];
  }
  return 0;
}

// Neighbours of each supercell atom within the cutoff, each list sorted by (index, shift).
export function buildNeighborGraph(source: NeighborSource, cutoff: number): NeighborGraph {
  const graph: NeighborGraph = new Map();
  if (cutoff <= 0) return graph;
  const pairs = source.neighbors(cutoff);
  for (let n = 0; n < pairs.i.length; n++) {
    const shift: Shift = [pairs.S[3 * n], pairs.S[3 * n + 1], pairs.S[3 * n + 2]];
    const item: Neighbor = { index: pairs.j[n], shift, distance: pairs.d[n] };
    const list = graph.get(pairs.i[n]);
    if (list === undefined) graph.set(pairs.i[n], [item]);
    else list.push(item);
  }
  for (const items of graph.values()) items.sort(compareNeighbors);
  return graph;
}

// The site with this supercell index (the unshifted, snapped origin of every image).
export function siteAt(byIndex: Map<number, Site>, index: number): Site {
  const site = byIndex.get(index);
  if (site === undefined) throw new Error(`no site with index ${index}`);
  return site;
}

// The identity of an unordered pair of points, as one string (Python keys a frozenset of two point keys). Exported so
// the pipeline can key the bonds it has drawn the same way.
export function pairKey(a: PointKey, b: PointKey): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Whether a bond rule names the pair, in either orientation.
export function bondMatches(rule: BondRule, a: Site, b: Site): boolean {
  return (nameMatches(rule.a, a) && nameMatches(rule.b, b)) || (nameMatches(rule.a, b) && nameMatches(rule.b, a));
}

// The first visible rule that names the pair and whose distance window holds `distance`; earlier rules win.
export function bestBondRule(rules: BondRule[], a: Site, b: Site, distance: number): BondRule | null {
  for (const rule of rules) {
    if (rule.visible && rule.min_distance <= distance && distance <= rule.max_distance && bondMatches(rule, a, b)) {
      return rule;
    }
  }
  return null;
}

export interface BondSpec {
  a: Site;
  b: Site; // periodic image next to `a`
  rule: BondRule;
}

// Bonds from every shown site to its neighbour images; the first matching rule wins. A bond whose far atom is not in
// `shown` (by index) is skipped. Rules with `complete: none`, and every rule under an active selection (`strict`),
// also skip a far end outside `shown`. Each geometric bond is returned once.
export function findBonds(
  shown: Site[],
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  rules: BondRule[],
  cell: Cell,
  strict = false,
): BondSpec[] {
  const shownIndices = new Set(shown.map((site) => site.index));
  const shownKeys = new Set(shown.map(pointKey));
  const seen = new Set<string>();
  const out: BondSpec[] = [];
  for (const a of shown) {
    for (const nb of graph.get(a.index) ?? []) {
      if (!shownIndices.has(nb.index)) continue;
      const b = image(siteAt(byIndex, nb.index), addShifts(a.shift, nb.shift), cell);
      const key = pairKey(pointKey(a), pointKey(b));
      if (seen.has(key)) continue;
      const rule = bestBondRule(rules, a, b, nb.distance);
      if (rule === null) continue;
      if ((strict || rule.complete === "none") && !shownKeys.has(pointKey(b))) continue;
      seen.add(key);
      out.push({ a, b, rule });
    }
  }
  return out;
}

// Every bond between two shown points, whatever its rule's `complete` mode. Runs once the shown set is final: it adds
// bonds only, never atoms.
export function closingBonds(
  shown: Site[],
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  rules: BondRule[],
  cell: Cell,
): BondSpec[] {
  const shownKeys = new Set(shown.map(pointKey));
  const seenPairs = new Set<string>(); // each geometric pair is seen from both ends; keep one
  const out: BondSpec[] = [];
  for (const a of shown) {
    for (const nb of graph.get(a.index) ?? []) {
      // The far end's key comes first (pointKey reads only index and shift), so an atom outside the shown set costs no image.
      const farShift = addShifts(a.shift, nb.shift);
      const farKey = pointKey({ index: nb.index, shift: farShift });
      if (!shownKeys.has(farKey)) continue;
      const pair = pairKey(pointKey(a), farKey);
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      const far = image(siteAt(byIndex, nb.index), farShift, cell);
      const rule = bestBondRule(rules, a, far, nb.distance);
      if (rule !== null) out.push({ a, b: far, rule });
    }
  }
  return out;
}

export interface Completion {
  partner: Site; // image of the bonded atom
  rule: BondRule;
}

// Rules with `complete: polyhedra`: an atom pulled in as a polyhedron ligand gets this bond too.
export function completionRules(rules: BondRule[]): BondRule[] {
  return rules.filter((rule) => rule.visible && rule.complete === "polyhedra");
}

// The nearest bonded partner per rule (one per ligand per rule), one hop only.
export function completeLigand(
  ligand: Site,
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  rules: BondRule[],
  cell: Cell,
): Completion[] {
  const out: Completion[] = [];
  for (const rule of rules) {
    let best: { distance: number; partner: Site } | null = null;
    for (const nb of graph.get(ligand.index) ?? []) {
      const base = siteAt(byIndex, nb.index);
      if (!bondMatches(rule, ligand, base)) continue;
      if (!(rule.min_distance <= nb.distance && nb.distance <= rule.max_distance)) continue;
      if (best === null || nb.distance < best.distance) {
        best = { distance: nb.distance, partner: image(base, addShifts(ligand.shift, nb.shift), cell) };
      }
    }
    if (best !== null) out.push({ partner: best.partner, rule });
  }
  return out;
}
