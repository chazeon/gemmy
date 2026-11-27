// Clusters: molecules (the hull of one bonded group of matching atoms) and rings (each smallest cycle as a fan from its
// centroid), as in compile/clusters.py. Each cluster is found once as a periodic pattern and then placed in the display
// box by its centroid. Every order here is Python's: lists keep their order, and the walks visit neighbours in graph
// order.
import { shapeOf } from "../geom/flatness";
import { meanOf, vadd, vcross, vdot, vsub } from "../geom/vector";
import type { Vec3 } from "../types";
import type { ClusterRule } from "./config";
import { type NeighborGraph, siteAt } from "./bonds";
import { convexHullFaces, isPlanar, MIN_POLYGON_CORNERS, type Triangle } from "./hull";
import { type BoxRanges, boxShifts } from "./lattice";
import { withBackFaces } from "./polyhedra";
import { type Cell, type PointKey, type Shift, type Site, addShifts, image, pointKey, sameShift } from "./sites";

// The most steps one rule's searches may take: each neighbour a search looks at, and each node it writes into a path.
// The same value as MAX_CLUSTER_SEARCH_STEPS in src/gemmy/compile/clusters.py (tests/test_ts_clusters.py checks it).
export const MAX_CLUSTER_SEARCH_STEPS = 1_000_000;

// A flat ring (a rule with flat = true) has every atom within this distance (A) of its plane: the plane through the
// centroid whose normal is the ring's area vector (Newell's method). The same value as RING_FLAT_TOLERANCE in
// src/gemmy/compile/clusters.py (tests/test_shared_constants.py checks they match).
export const RING_FLAT_TOLERANCE = 0.1;

export interface ClusterSpec {
  members: Site[]; // periodic images, in discovery order (ring order for a ring)
  centroid: Vec3; // computed point, not an atom
  centroidFractional: Vec3;
  faces: Triangle[]; // indices into members, or into members + [centroid] for a ring
  rule: ClusterRule;
  name: string;
}

// A periodic image: a base atom index and the lattice shift that places it. The identity of a point, as point_key.
interface Image {
  index: number;
  shift: Shift;
}

// The whole supercell: each atom unshifted and snapped by index, the neighbour graph and the cell.
interface Neighbourhood {
  byIndex: Map<number, Site>;
  graph: NeighborGraph;
  cell: Cell;
}

// The display box a centroid must fall in, with the inclusive eps of sites.base_box.
interface DisplayBox {
  box: BoxRanges;
  periodic: readonly [boolean, boolean, boolean];
  eps: number;
}

type Finder = (
  hood: Neighbourhood,
  rule: ClusterRule,
  display: DisplayBox,
  budget: Budget,
  warnings: string[] | undefined,
) => ClusterSpec[];

// Thrown when a rule's searches have used up MAX_CLUSTER_SEARCH_STEPS: the rule is dropped with a warning.
class SearchCutShort extends Error {}

class Budget {
  private left = MAX_CLUSTER_SEARCH_STEPS;

  spend(): void {
    this.left -= 1;
    if (this.left < 0) throw new SearchCutShort();
  }
}

// Clusters and rings for the visible rules, in rule order (compile/clusters.py find_clusters). `byIndex` holds the
// unshifted, snapped sites of the whole supercell and `graph` must reach every rule's max_distance. `shown` is not
// read: the clusters are found from the supercell and placed in the box (`_shown` is Python's `shown`, unused as well).
export function findClusters(
  _shown: Site[],
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  rules: ClusterRule[],
  cell: Cell,
  box: BoxRanges,
  periodic: readonly [boolean, boolean, boolean],
  eps: number,
  warnings?: string[],
): ClusterSpec[] {
  const hood: Neighbourhood = { byIndex, graph, cell };
  const display: DisplayBox = { box, periodic, eps };
  const out: ClusterSpec[] = [];
  for (const rule of rules) {
    if (!rule.visible) continue;
    const finder: Finder = rule.kind === "molecule" ? molecules : rings;
    try {
      appendAll(out, finder(hood, rule, display, new Budget(), warnings));
    } catch (error) {
      if (!(error instanceof SearchCutShort)) throw error;
      warnings?.push(cutShortMessage(rule));
    }
  }
  return out;
}

// Appends each item to target. Not target.push(...items): a spread over a data-sized array overflows the argument limit.
function appendAll<T>(target: T[], items: readonly T[]): void {
  for (const item of items) target.push(item);
}

// ---- molecules ------------------------------------------------------------------------------------------------------

// Each bonded group of matching atoms, walked once from its lowest-index atom, placed in the display box.
const molecules: Finder = (hood, rule, display, budget, warnings) => {
  const out: ClusterSpec[] = [];
  const claimed = new Set<number>(); // the atoms of every walk made: a group is walked once, from its lowest index
  let networks = 0;
  for (const index of sortedIndices(hood.byIndex)) {
    if (claimed.has(index) || !matchingAtoms(rule, siteAt(hood.byIndex, index))) continue;
    const { group, finite } = walkGroup({ index, shift: [0, 0, 0] }, rule, hood, budget);
    for (const member of group) claimed.add(member.index);
    if (!finite) {
      networks++;
      continue;
    }
    if (!inSizeWindow(rule, group.length)) continue;
    const pattern = group.map((key) => imageAt(hood, key));
    appendAll(out, placed(pattern, rule, moleculeName(rule, pattern), moleculeFaces, hood, display, warnings));
  }
  if (networks > 0) warnings?.push(networkMessage(rule, networks));
  return out;
};

// The atoms bonded to `start` through matching atoms, each as the image that reaches it from `start` (which is at shift
// zero), in discovery order. `finite` is false when the walk meets an atom with another shift: the group is then a
// periodic network. The walk still goes on to the end, so the whole network is claimed at once.
function walkGroup(
  start: Image,
  rule: ClusterRule,
  hood: Neighbourhood,
  budget: Budget,
): { group: Image[]; finite: boolean } {
  const shifts = new Map<number, Shift>([[start.index, start.shift]]);
  const group: Image[] = [start];
  let finite = true;
  for (let head = 0; head < group.length; head++) {
    // The list is the queue: links append to it while it is read.
    for (const link of linkImages(group[head], rule, hood)) {
      budget.spend();
      const known = shifts.get(link.index);
      if (known === undefined) {
        shifts.set(link.index, link.shift);
        group.push(link);
      } else if (!sameShift(known, link.shift)) {
        finite = false;
      }
    }
  }
  return { group, finite };
}

function moleculeFaces(members: Site[]): Triangle[] {
  const positions = members.map((m) => m.position);
  const faces = convexHullFaces(positions);
  if (faces.length > 0 && isPlanar(positions)) {
    // A flat polygon has no inside: each triangle is drawn from both sides, as compile/polyhedra.py does.
    return withBackFaces(faces);
  }
  return faces;
}

// ---- rings ----------------------------------------------------------------------------------------------------------

// Every shortest cycle through each bond of matching atoms, once per ring, placed in the display box.
const rings: Finder = (hood, rule, display, budget, warnings) => {
  const out: ClusterSpec[] = [];
  const bondsDone = new Set<string>(); // each bond is seen from both ends: searched once
  const ringsDone = new Set<string>();
  const drawnBonds = new Set<string>(); // the bonds of every ring drawn so far
  for (const index of sortedIndices(hood.byIndex)) {
    if (!matchingAtoms(rule, siteAt(hood.byIndex, index))) continue;
    const origin: Image = { index, shift: [0, 0, 0] };
    for (const target of linkImages(origin, rule, hood)) {
      const bond = bondKey(origin, target);
      if (bondsDone.has(bond)) continue;
      bondsDone.add(bond);
      for (const cycle of shortestCycles(origin, target, rule, hood, budget)) {
        const identity = ringIdentity(cycle);
        if (ringsDone.has(identity)) continue;
        ringsDone.add(identity);
        if (!inSizeWindow(rule, cycle.length)) continue;
        const ring = drawnOrder(cycle, rule, hood, drawnBonds);
        const pattern = ring.map((key) => imageAt(hood, key));
        if (rule.flat && !isFlatRing(pattern.map((m) => m.position))) continue;
        appendAll(out, placed(pattern, rule, ringName(rule, ring.length), ringFaces, hood, display, warnings));
      }
    }
  }
  return out;
};

// The identity of a bond: its two images moved to shift zero by one translation, in sorted order.
function bondKey(a: Image, b: Image): string {
  return translatedToOrigin([a, b]).sort(compareImages).map(pointKey).join(";");
}

// The order a ring is drawn in, the order compile/clusters.py draws it in: from its origin (its lowest member, the first of the cycle),
// and last the origin's other neighbour on the ring. That neighbour is the one whose bond no drawn ring has used yet,
// else the first in graph order. The ring's bonds are then recorded in drawnBonds.
function drawnOrder(cycle: Image[], rule: ClusterRule, hood: Neighbourhood, drawnBonds: Set<string>): Image[] {
  const origin = cycle[0];
  const first = cycle[1];
  const last = cycle[cycle.length - 1];
  const links = linkImages(origin, rule, hood).map(pointKey);
  const preference = (neighbour: Image) => ({
    drawn: drawnBonds.has(bondKey(origin, neighbour)),
    position: links.indexOf(pointKey(neighbour)),
  });
  const lastRank = preference(last);
  const firstRank = preference(first);
  const lastPreferred = lastRank.drawn !== firstRank.drawn ? !lastRank.drawn : lastRank.position <= firstRank.position;
  const ordered = lastPreferred ? cycle : [origin, ...cycle.slice(1).reverse()];
  for (let k = 0; k < ordered.length; k++) drawnBonds.add(bondKey(ordered[k], ordered[(k + 1) % ordered.length]));
  return ordered;
}

// A node of a ring search: its depth in bonds from the origin, and every node one bond nearer. All of them are kept, so
// every shortest path to the node is found.
interface Reached {
  depth: number;
  before: Image[];
}

// Every shortest cycle through the bond origin-target: each shortest path from origin to target that does not use that
// bond, as its members from origin to target. The search stops after the layer that reaches target, so every
// predecessor in that layer is kept. It never goes deeper than max_members - 1 bonds, the most a ring of max_members
// members can take.
function shortestCycles(
  origin: Image,
  target: Image,
  rule: ClusterRule,
  hood: Neighbourhood,
  budget: Budget,
): Image[][] {
  const depthLimit = maxMembers(rule) - 1;
  const originKey = pointKey(origin);
  const targetKey = pointKey(target);
  const reached = new Map<PointKey, Reached>([[originKey, { depth: 0, before: [] }]]);
  let frontier: Image[] = [origin];
  let depth = 0;
  while (frontier.length > 0 && depth < depthLimit && !reached.has(targetKey)) {
    depth += 1;
    const nextFrontier: Image[] = [];
    for (const here of frontier) {
      for (const there of linkImages(here, rule, hood)) {
        budget.spend();
        if (pointKey(here) === originKey && pointKey(there) === targetKey) continue; // the bond itself does not count
        const thereKey = pointKey(there);
        const known = reached.get(thereKey);
        if (known === undefined) {
          reached.set(thereKey, { depth, before: [here] });
          nextFrontier.push(there);
        } else if (known.depth === depth) {
          known.before.push(here);
        }
      }
    }
    frontier = nextFrontier;
  }
  if (!reached.has(targetKey)) return [];
  return pathsTo(target, reached, origin, budget);
}

// Every shortest path from the origin to `key`, following the predecessors back, as images in order.
function pathsTo(key: Image, reached: Map<PointKey, Reached>, origin: Image, budget: Budget): Image[][] {
  if (pointKey(key) === pointKey(origin)) return [[key]];
  const node = reached.get(pointKey(key));
  if (node === undefined) throw new Error(`ring search lost ${pointKey(key)}`);
  const paths: Image[][] = [];
  for (const before of node.before) {
    for (const path of pathsTo(before, reached, origin, budget)) {
      budget.spend();
      paths.push([...path, key]);
    }
  }
  return paths;
}

// One string for every rotation, reflection and translation of the same ring, so each ring is kept once. The order it is
// drawn in is drawnOrder's, not this one's.
function ringIdentity(members: Image[]): string {
  const moved = translatedToOrigin(members);
  const least = moved.reduce((a, b) => (compareImages(b, a) < 0 ? b : a));
  const start = moved.findIndex((key) => pointKey(key) === pointKey(least));
  const ring = [...moved.slice(start), ...moved.slice(0, start)];
  const firstNeighbour = ring[1];
  const lastNeighbour = ring[ring.length - 1];
  const oriented = compareImages(lastNeighbour, firstNeighbour) > 0 ? [ring[0], ...ring.slice(1).reverse()] : ring;
  return oriented.map(pointKey).join(";");
}

// A fan from the centroid (index fanCentre, after the members) in ring order, each triangle drawn from both sides. A
// triangle whose corners lie on one line has no area and is dropped. A ring with none left has no face.
function ringFaces(members: Site[]): Triangle[] {
  const fanCentre = members.length;
  const corners = [...members.map((m) => m.position), mean(members.map((m) => m.position))];
  const fan: Triangle[] = [];
  for (let k = 0; k < fanCentre; k++) fan.push([k, (k + 1) % fanCentre, fanCentre]);
  const drawable = fan.filter((triangle) => shapeOf(triangle.map((i) => corners[i])).kind !== "line");
  return withBackFaces(drawable);
}

// ---- shared helpers -------------------------------------------------------------------------------------------------

// Whether every corner lies within RING_FLAT_TOLERANCE of the ring's plane (Newell's normal through the centroid). A ring
// with no area has no plane, so it is not flat.
// The corners are first moved by the first corner, so the area and the offsets are sums of small differences: a ring far
// from the origin is as flat as one at it (the Python twin, compile/clusters.py is_flat_ring, does the same).
export function isFlatRing(corners: readonly Vec3[]): boolean {
  const local = corners.map((corner) => vsub(corner, corners[0]));
  let area = [0, 0, 0];
  local.forEach((corner, k) => {
    area = vadd(area, vcross(corner, local[(k + 1) % local.length]));
  });
  const length = Math.hypot(...area);
  if (length === 0) return false;
  const normal = area.map((x) => x / length);
  const centre = meanOf(local);
  return local.every((corner) => Math.abs(vdot(vsub(corner, centre), normal)) <= RING_FLAT_TOLERANCE);
}

function matchingAtoms(rule: ClusterRule, site: Site): boolean {
  return rule.atoms.includes(site.label);
}

function inSizeWindow(rule: ClusterRule, members: number): boolean {
  return rule.min_size <= members && (rule.max_size === null || members <= rule.max_size);
}

function inDistanceWindow(rule: ClusterRule, distance: number): boolean {
  return rule.min_distance <= distance && distance <= rule.max_distance;
}

// The most members a ring may have. Config gives a ring a number, never null.
function maxMembers(rule: ClusterRule): number {
  if (rule.max_size === null) throw new Error(`a ring rule needs a max_size, got ${rule.max_size}`);
  return rule.max_size;
}

// The atom at this point: its unshifted site moved by the image's shift.
function imageAt(hood: Neighbourhood, key: Image): Site {
  return image(siteAt(hood.byIndex, key.index), key.shift, hood.cell);
}

// The images of the matching neighbours of this one, inside the rule's distance window, in graph order.
function linkImages(key: Image, rule: ClusterRule, hood: Neighbourhood): Image[] {
  const out: Image[] = [];
  for (const link of hood.graph.get(key.index) ?? []) {
    if (inDistanceWindow(rule, link.distance) && matchingAtoms(rule, siteAt(hood.byIndex, link.index))) {
      out.push({ index: link.index, shift: addShifts(key.shift, link.shift) });
    }
  }
  return out;
}

// The images moved by the translation that puts the lowest of them at shift zero: one pattern, wherever it sits.
function translatedToOrigin(keys: Image[]): Image[] {
  const anchor = keys.reduce((a, b) => (compareImages(b, a) < 0 ? b : a));
  return keys.map((key) => ({ index: key.index, shift: key.shift.map((n, axis) => n - anchor.shift[axis]) as Shift }));
}

// Python's tuple order on (index, shift): the order the lowest image and the ring's start depend on.
function compareImages(a: Image, b: Image): number {
  if (a.index !== b.index) return a.index - b.index;
  for (let axis = 0; axis < 3; axis++) {
    if (a.shift[axis] !== b.shift[axis]) return a.shift[axis] - b.shift[axis];
  }
  return 0;
}

function sortedIndices(byIndex: Map<number, Site>): number[] {
  return [...byIndex.keys()].sort((a, b) => a - b);
}

// The copies of one pattern whose centroid lies in the display box, in box_shifts order. The faces index the members in
// pattern order, so every copy shares them. A pattern with no face is dropped, with a message.
function placed(
  pattern: Site[],
  rule: ClusterRule,
  name: string,
  facesOf: (members: Site[]) => Triangle[],
  hood: Neighbourhood,
  display: DisplayBox,
  warnings: string[] | undefined,
): ClusterSpec[] {
  const shifts = boxShifts(mean(pattern.map((m) => m.fractional)), display.box, display.periodic, display.eps);
  if (shifts.length === 0) return [];
  const faces = facesOf(pattern);
  if (faces.length === 0) {
    warnings?.push(skippedMessage(name, pattern.length));
    return [];
  }
  return shifts.map((shift) => copyOf(pattern, shift, rule, name, faces, hood));
}

function copyOf(
  pattern: Site[],
  shift: Shift,
  rule: ClusterRule,
  name: string,
  faces: Triangle[],
  hood: Neighbourhood,
): ClusterSpec {
  const members = pattern.map((m) => imageAt(hood, { index: m.index, shift: addShifts(m.shift, shift) }));
  return {
    members,
    centroid: mean(members.map((m) => m.position)),
    centroidFractional: mean(members.map((m) => m.fractional)),
    faces,
    rule,
    name,
  };
}

function mean(points: Vec3[]): Vec3 {
  return meanOf(points) as Vec3;
}

// Label counts in sorted label order, e.g. C60, or C_dna24 for labelled carbons.
function formula(members: Site[]): string {
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.label, (counts.get(m.label) ?? 0) + 1);
  return [...counts.keys()]
    .sort()
    .map((label) => `${label}${counts.get(label)}`)
    .join("");
}

// The rule's name, or the formula of the members when it has none.
function moleculeName(rule: ClusterRule, members: Site[]): string {
  return rule.name || formula(members);
}

// The rule's name, or `ring<members>` when it has none.
function ringName(rule: ClusterRule, members: number): string {
  return rule.name || `ring${members}`;
}

// Why a cluster has no polygon: its members lie on one line. Same text as compile/clusters.py _skipped_message.
function skippedMessage(name: string, members: number): string {
  return (
    `cluster ${name} skipped: its ${members} members lie on one line, so there is no polygon to draw ` +
    `(a polygon needs ${MIN_POLYGON_CORNERS} members that are not on one line)`
  );
}

// A molecule rule met periodic networks: their atoms link across a cell repeat, so no finite group exists.
function networkMessage(rule: ClusterRule, networks: number): string {
  return (
    `cluster rule ${ruleLabel(rule)} skipped ${networks} periodic network(s): an atom of the group is bonded to ` +
    "an image of itself (the group does not close), so it is not a molecule and has no cluster"
  );
}

function cutShortMessage(rule: ClusterRule): string {
  return (
    `cluster rule ${ruleLabel(rule)} was not drawn: its search ran out of ${MAX_CLUSTER_SEARCH_STEPS} steps and ` +
    "was cut short, so none of its clusters are shown (a smaller max_size or a narrower bond window searches less)"
  );
}

function ruleLabel(rule: ClusterRule): string {
  return rule.name || `${rule.kind} of ${rule.atoms.join(" ")}`;
}
