"""Clusters: a molecule is the hull of one bonded group of matching atoms (a C60 cage); a ring is each smallest cycle of
matching atoms, drawn as a fan from its centroid. The centroid is a computed point, not an atom: the pipeline gives it
its own point.

Each cluster is found once, as a periodic pattern, from the whole supercell (not only the shown atoms). Its copies are
then placed with the display-box rule of sites.base_box, applied to its centroid: one copy for every lattice translation
that puts the centroid in the box, so a cluster the box crops still shows, and a centroid on a box face gives two
clusters, as a polyhedron centre on a face gives two polyhedra. The c60 example (examples/c60) gives its 63
cages at 2x2x2 (tests/test_clusters.py).

A walk keeps the image shift of every atom it reaches. A molecule walk that reaches an atom again with another shift is
a periodic network, not a molecule: it is dropped, with a warning. A ring is a cycle of such images, closed within the
rule's max_size. Every search runs on a step budget (MAX_CLUSTER_SEARCH_STEPS): a rule that uses it up is dropped with
a warning that says the search was cut short.

Order: rules in config order; within a rule, base atoms in index order and neighbours in graph order, then copies in
box_shifts order. web/src/compile/clusters.ts findClusters agrees item for item.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import numpy as np

from ..config import ClusterRule
from ..scene import Vec3
from .bonds import NeighborGraph, add_shifts
from .lattice import MIN_POLYGON_CORNERS, Line, box_shifts, convex_hull_faces, is_planar, shape_of
from .polyhedra import with_back_faces
from .sites import PointKey, Site

# The most steps one rule's searches may take: each neighbour a search looks at, and each node it writes into a path.
# The largest example (examples/private glut1, its ring rule) takes about 70 thousand steps, measured; the budget is
# about 14 times that. The same value as MAX_CLUSTER_SEARCH_STEPS in web/src/compile/clusters.ts
# (tests/test_ts_clusters.py checks they match).
MAX_CLUSTER_SEARCH_STEPS = 1_000_000

# A flat ring (a rule with flat = true) has every atom within this distance (A) of its plane: the plane through the
# centroid whose normal is the ring's area vector (Newell's method). Benzene and the aromatic rings of proteins are flat
# to a few hundredths of an A; the chair of cyclohexane puckers by a quarter of an A. The same value as
# RING_FLAT_TOLERANCE in web/src/compile/clusters.ts (tests/test_shared_constants.py checks they match).
RING_FLAT_TOLERANCE = 0.1


@dataclass(frozen=True, slots=True)
class ClusterSpec:
    members: list[Site]  # periodic images, in discovery order (ring order for a ring)
    centroid: Vec3  # computed point, not an atom
    centroid_fractional: Vec3
    faces: list[tuple[int, int, int]]  # indices into members, or into members + [centroid] for a ring
    rule: ClusterRule
    name: str


def find_clusters(
    shown: list[Site],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    rules: Sequence[ClusterRule],
    cell: np.ndarray,
    box: dict[str, tuple[float, float]],
    periodic: tuple[bool, bool, bool],
    eps: float,
    warnings: list[str] | None = None,
) -> list[ClusterSpec]:
    """Clusters and rings for the visible rules, in rule order.

    `by_index` holds the unshifted, snapped sites of the whole supercell and `graph` must reach every rule's
    max_distance. `shown` is not read: the clusters are found from the supercell and placed in the box, so a cluster
    needs no shown member. A rule whose search runs out of steps gives no clusters. A message naming the rule is
    appended to `warnings` when given, for that case, for a periodic network and for a cluster with no face."""
    hood = Neighbourhood(by_index, graph, cell)
    display = DisplayBox(box, periodic, eps)
    out: list[ClusterSpec] = []
    for rule in rules:
        if not rule.visible:
            continue
        finder = _molecules if rule.kind == "molecule" else _rings
        try:
            out += finder(hood, rule, display, _Budget(), warnings)
        except _SearchCutShort:
            if warnings is not None:
                warnings.append(_cut_short_message(rule))
    return out


@dataclass(frozen=True, slots=True)
class Neighbourhood:
    """The whole supercell: each atom unshifted and snapped by index, the neighbour graph and the cell."""

    by_index: dict[int, Site]
    graph: NeighborGraph
    cell: np.ndarray


@dataclass(frozen=True, slots=True)
class DisplayBox:
    """The display box a centroid must fall in, with the inclusive eps of sites.base_box."""

    box: dict[str, tuple[float, float]]
    periodic: tuple[bool, bool, bool]
    eps: float


class _SearchCutShort(Exception):
    """A rule's searches used up MAX_CLUSTER_SEARCH_STEPS."""


@dataclass(slots=True)
class _Budget:
    """The steps one rule may still take."""

    left: int = field(default_factory=lambda: MAX_CLUSTER_SEARCH_STEPS)

    def spend(self) -> None:
        self.left -= 1
        if self.left < 0:
            raise _SearchCutShort


# ---- molecules ------------------------------------------------------------------------------------------------------


def _molecules(
    hood: Neighbourhood,
    rule: ClusterRule,
    display: DisplayBox,
    budget: _Budget,
    warnings: list[str] | None,
) -> list[ClusterSpec]:
    """Each bonded group of matching atoms, walked once from its lowest-index atom, placed in the display box."""
    out: list[ClusterSpec] = []
    claimed: set[int] = set()  # the atoms of every walk made: a group is walked once, from its lowest index
    networks = 0
    for index in sorted(hood.by_index):
        if index in claimed or not matching_atoms(rule, hood.by_index[index]):
            continue
        group, finite = _walk_group(index, rule, hood, budget)
        claimed.update(member_index for member_index, _shift in group)
        if not finite:
            networks += 1
            continue
        if not in_size_window(rule, len(group)):
            continue
        pattern = [image_at(hood, key) for key in group]
        name = molecule_name(rule, pattern)
        out += _placed(pattern, rule, name, _molecule_faces, hood, display, warnings)
    if networks and warnings is not None:
        warnings.append(_network_message(rule, networks))
    return out


def _walk_group(start: int, rule: ClusterRule, hood: Neighbourhood, budget: _Budget) -> tuple[list[PointKey], bool]:
    """The atoms bonded to `start` through matching atoms, each as the image that reaches it from `start` (which is at
    shift zero), in discovery order. The flag is False when the walk meets an atom with another shift: the group is then
    a periodic network. The walk still goes on to the end, so the whole network is claimed at once."""
    shifts: dict[int, tuple[int, int, int]] = {start: (0, 0, 0)}
    group: list[PointKey] = [(start, (0, 0, 0))]
    finite = True
    for key in group:  # the list is the queue: links append to it while it is read
        for index, shift in _link_keys(key, rule, hood):
            budget.spend()
            known = shifts.get(index)
            if known is None:
                shifts[index] = shift
                group.append((index, shift))
            elif known != shift:
                finite = False
    return group, finite


def _molecule_faces(members: list[Site]) -> list[tuple[int, int, int]]:
    positions = [m.position for m in members]
    faces = convex_hull_faces(positions)
    if faces and is_planar(positions):
        # A flat polygon has no inside: each triangle is drawn from both sides, as compile/polyhedra.py does.
        faces = with_back_faces(faces)
    return faces


# ---- rings ----------------------------------------------------------------------------------------------------------


def _rings(
    hood: Neighbourhood,
    rule: ClusterRule,
    display: DisplayBox,
    budget: _Budget,
    warnings: list[str] | None,
) -> list[ClusterSpec]:
    """Every shortest cycle through each bond of matching atoms, once per ring pattern, placed in the display box."""
    out: list[ClusterSpec] = []
    bonds_done: set[tuple[PointKey, ...]] = set()  # each bond is seen from both ends: searched once
    rings_done: set[tuple[PointKey, ...]] = set()
    drawn_bonds: set[tuple[PointKey, ...]] = set()  # the bonds of every ring drawn so far
    for index in sorted(hood.by_index):
        if not matching_atoms(rule, hood.by_index[index]):
            continue
        origin: PointKey = (index, (0, 0, 0))
        for target in _link_keys(origin, rule, hood):
            bond = _bond_key(origin, target)
            if bond in bonds_done:
                continue
            bonds_done.add(bond)
            for cycle in _shortest_cycles(origin, target, rule, hood, budget):
                identity = _ring_identity(cycle)
                if identity in rings_done:
                    continue
                rings_done.add(identity)
                if not in_size_window(rule, len(cycle)):
                    continue
                ring = _drawn_order(cycle, rule, hood, drawn_bonds)
                pattern = [image_at(hood, key) for key in ring]
                if rule.flat and not is_flat_ring([m.position for m in pattern]):
                    continue
                name = ring_name(rule, len(ring))
                out += _placed(pattern, rule, name, _ring_faces, hood, display, warnings)
    return out


@dataclass(slots=True)
class _Reached:
    """A node of a ring search: its depth in bonds from the origin, and every node one bond nearer. All of them are
    kept, so every shortest path to the node is found."""

    depth: int
    before: list[PointKey] = field(default_factory=list)


def _shortest_cycles(
    origin: PointKey,
    target: PointKey,
    rule: ClusterRule,
    hood: Neighbourhood,
    budget: _Budget,
) -> list[list[PointKey]]:
    """Every shortest cycle through the bond origin-target: each shortest path from origin to target that does not use
    that bond, as the keys of its members from origin to target. The search stops after the layer that reaches target,
    so every predecessor in that layer is kept. It never goes deeper than max_members - 1 bonds, the most a ring of
    max_members members can take."""
    depth_limit = max_members(rule) - 1
    reached: dict[PointKey, _Reached] = {origin: _Reached(depth=0)}
    frontier = [origin]
    depth = 0
    while frontier and depth < depth_limit and target not in reached:
        depth += 1
        next_frontier: list[PointKey] = []
        for here in frontier:
            for there in _link_keys(here, rule, hood):
                budget.spend()
                if here == origin and there == target:
                    continue  # the bond itself does not count
                known = reached.get(there)
                if known is None:
                    reached[there] = _Reached(depth=depth, before=[here])
                    next_frontier.append(there)
                elif known.depth == depth:
                    known.before.append(here)
        frontier = next_frontier
    if target not in reached:
        return []
    return _paths_to(target, reached, origin, budget)


def _paths_to(
    key: PointKey, reached: dict[PointKey, _Reached], origin: PointKey, budget: _Budget
) -> list[list[PointKey]]:
    """Every shortest path from the origin to `key`, following the predecessors back, as keys in order."""
    if key == origin:
        return [[key]]
    paths: list[list[PointKey]] = []
    for before in reached[key].before:
        for path in _paths_to(before, reached, origin, budget):
            budget.spend()
            paths.append([*path, key])
    return paths


def _bond_key(a: PointKey, b: PointKey) -> tuple[PointKey, ...]:
    """The identity of a bond: its two keys moved to shift zero by one translation, in sorted order."""
    return tuple(sorted(_translated_to_origin([a, b])))


def _drawn_order(
    cycle: list[PointKey], rule: ClusterRule, hood: Neighbourhood, drawn_bonds: set[tuple[PointKey, ...]]
) -> list[PointKey]:
    """The order a ring is drawn in: from its origin (its lowest member, the first
    of the cycle), and last the origin's other neighbour on the ring. That neighbour is the one whose bond no drawn ring
    has used yet, else the first in graph order. The ring's bonds are then recorded in drawn_bonds."""
    origin, first, last = cycle[0], cycle[1], cycle[-1]
    links = _link_keys(origin, rule, hood)

    def preference(neighbour: PointKey) -> tuple[bool, int]:
        return (_bond_key(origin, neighbour) in drawn_bonds, links.index(neighbour))

    ordered = cycle if preference(last) <= preference(first) else [origin, *reversed(cycle[1:])]
    for here, there in zip(ordered, [*ordered[1:], ordered[0]], strict=True):
        drawn_bonds.add(_bond_key(here, there))
    return ordered


def _ring_identity(members: list[PointKey]) -> tuple[PointKey, ...]:
    """One tuple for every rotation, reflection and translation of the same ring, so each ring is kept once. The order
    it is drawn in is _drawn_order's, not this one's."""
    moved = _translated_to_origin(members)
    start = moved.index(min(moved))
    ring = moved[start:] + moved[:start]
    first_neighbour, last_neighbour = ring[1], ring[-1]
    if last_neighbour > first_neighbour:
        ring = [ring[0], *reversed(ring[1:])]
    return tuple(ring)


def _ring_faces(members: list[Site]) -> list[tuple[int, int, int]]:
    """A fan from the centroid (index fan_centre, after the members) in ring order, each triangle drawn from both
    sides. A triangle whose corners lie on one line has no area and is dropped. A ring with none left has no face."""
    fan_centre = len(members)
    corners = [*(m.position for m in members), _mean([m.position for m in members])]
    fan = [(k, (k + 1) % fan_centre, fan_centre) for k in range(fan_centre)]
    drawable = [triangle for triangle in fan if not isinstance(shape_of([corners[i] for i in triangle]), Line)]
    return with_back_faces(drawable)


# ---- shared helpers -------------------------------------------------------------------------------------------------


def matching_atoms(rule: ClusterRule, site: Site) -> bool:
    return site.label in rule.atoms


def is_flat_ring(positions: Sequence[Vec3]) -> bool:
    """Whether every corner lies within RING_FLAT_TOLERANCE of the ring's plane (Newell's normal through the centroid).
    A ring with no area has no plane, so it is not flat. The corners are first moved by the first corner, so the area
    and the offsets are sums of small differences: a ring far from the origin is as flat as one at it (the TypeScript
    twin, web/src/compile/clusters.ts isFlatRing, does the same)."""
    corners = np.asarray(positions, dtype=float)
    corners = corners - corners[0]
    area = np.zeros(3)
    for k in range(len(corners)):
        area += np.cross(corners[k], corners[(k + 1) % len(corners)])
    length = float(np.linalg.norm(area))
    if length == 0.0:
        return False
    offsets = (corners - corners.mean(axis=0)) @ (area / length)
    return bool(np.all(np.abs(offsets) <= RING_FLAT_TOLERANCE))


def in_size_window(rule: ClusterRule, members: int) -> bool:
    return rule.min_size <= members and (rule.max_size is None or members <= rule.max_size)


def in_distance_window(rule: ClusterRule, distance: float) -> bool:
    return rule.min_distance <= distance <= rule.max_distance


def max_members(rule: ClusterRule) -> int:
    """The most members a ring may have. Config gives a ring a number, never null."""
    if rule.max_size is None:
        raise ValueError(f"a ring rule needs a max_size, got {rule.max_size!r}")
    return rule.max_size


def image_at(hood: Neighbourhood, key: PointKey) -> Site:
    """The atom at this point key: its unshifted site moved by the key's shift."""
    index, shift = key
    return hood.by_index[index].image(shift, hood.cell)


def _link_keys(key: PointKey, rule: ClusterRule, hood: Neighbourhood) -> list[PointKey]:
    """The keys of the matching neighbours of this point, inside the rule's distance window, in graph order."""
    index, shift = key
    out: list[PointKey] = []
    for link in hood.graph.get(index, []):
        if in_distance_window(rule, link.distance) and matching_atoms(rule, hood.by_index[link.index]):
            out.append((link.index, add_shifts(shift, link.shift)))
    return out


def _translated_to_origin(keys: Sequence[PointKey]) -> list[PointKey]:
    """The keys moved by the translation that puts the lowest of them at shift zero: one pattern, wherever it sits."""
    _anchor_index, anchor_shift = min(keys)
    return [(index, _minus(shift, anchor_shift)) for index, shift in keys]


def _minus(a: tuple[int, int, int], b: tuple[int, int, int]) -> tuple[int, int, int]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _placed(
    pattern: list[Site],
    rule: ClusterRule,
    name: str,
    faces_of: Callable[[list[Site]], list[tuple[int, int, int]]],
    hood: Neighbourhood,
    display: DisplayBox,
    warnings: list[str] | None,
) -> list[ClusterSpec]:
    """The copies of one pattern whose centroid lies in the display box, in box_shifts order. The faces index the
    members in pattern order, so every copy shares them. A pattern with no face is dropped, with a message."""
    shifts = box_shifts(_mean([m.fractional for m in pattern]), display.box, display.periodic, display.eps)
    if not shifts:
        return []
    faces = faces_of(pattern)
    if not faces:
        if warnings is not None:
            warnings.append(_skipped_message(name, len(pattern)))
        return []
    return [_copy(pattern, shift, rule, name, faces, hood) for shift in shifts]


def _copy(
    pattern: list[Site],
    shift: tuple[int, int, int],
    rule: ClusterRule,
    name: str,
    faces: list[tuple[int, int, int]],
    hood: Neighbourhood,
) -> ClusterSpec:
    members = [image_at(hood, (m.index, add_shifts(m.shift, shift))) for m in pattern]
    return ClusterSpec(
        members=members,
        centroid=_mean([m.position for m in members]),
        centroid_fractional=_mean([m.fractional for m in members]),
        faces=faces,
        rule=rule,
        name=name,
    )


def _mean(points: list[Vec3]) -> Vec3:
    count = len(points)
    x, y, z = (sum(column) / count for column in zip(*points, strict=True))
    return (x, y, z)


def _formula(members: list[Site]) -> str:
    """Count of each species label, sorted: C60 for carbon, C_dna24 for labelled carbons."""
    counts: dict[str, int] = {}
    for m in members:
        counts[m.label] = counts.get(m.label, 0) + 1
    return "".join(f"{label}{counts[label]}" for label in sorted(counts))


def molecule_name(rule: ClusterRule, members: list[Site]) -> str:
    """The rule's name, or the formula of the members (C60) when it has none."""
    return rule.name or _formula(members)


def ring_name(rule: ClusterRule, members: int) -> str:
    """The rule's name, or `ring<members>` when it has none."""
    return rule.name or f"ring{members}"


def _skipped_message(name: str, members: int) -> str:
    """Why a cluster has no polygon: its members lie on one line. Same text as skippedMessage in clusters.ts."""
    return (
        f"cluster {name} skipped: its {members} members lie on one line, so there is no polygon to draw "
        f"(a polygon needs {MIN_POLYGON_CORNERS} members that are not on one line)"
    )


def _network_message(rule: ClusterRule, networks: int) -> str:
    """A molecule rule met periodic networks: their atoms link across a cell repeat, so no finite group exists."""
    return (
        f"cluster rule {_rule_label(rule)} skipped {networks} periodic network(s): an atom of the group is bonded to "
        "an image of itself (the group does not close), so it is not a molecule and has no cluster"
    )


def _cut_short_message(rule: ClusterRule) -> str:
    return (
        f"cluster rule {_rule_label(rule)} was not drawn: its search ran out of {MAX_CLUSTER_SEARCH_STEPS} steps and "
        "was cut short, so none of its clusters are shown (a smaller max_size or a narrower bond window searches less)"
    )


def _rule_label(rule: ClusterRule) -> str:
    return rule.name or f"{rule.kind} of {' '.join(rule.atoms)}"
