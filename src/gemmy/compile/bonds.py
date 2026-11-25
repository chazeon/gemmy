"""Bonds: neighbour search, rule matching, bond detection (stage 4), secondary completion (stage 6) and
closing, the last pass over the final shown set."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from ase import Atoms
from ase.neighborlist import neighbor_list

from ..config import BondRule
from .sites import PointKey, Site, name_score, point_key


@dataclass(frozen=True, slots=True)
class Neighbor:
    index: int
    shift: tuple[int, int, int]
    distance: float


NeighborGraph = dict[int, list[Neighbor]]


def build_neighbor_graph(atoms: Atoms, cutoff: float) -> NeighborGraph:
    if cutoff <= 0:
        return {}
    i_idx, j_idx, shifts, distances = neighbor_list("ijSd", atoms, cutoff)
    graph: NeighborGraph = {}
    for n in range(len(i_idx)):
        s = shifts[n]
        shift = (int(s[0]), int(s[1]), int(s[2]))
        graph.setdefault(int(i_idx[n]), []).append(Neighbor(int(j_idx[n]), shift, float(distances[n])))
    for items in graph.values():  # ASE order depends on float noise; make ids reproducible
        items.sort(key=lambda nb: (nb.index, nb.shift))
    return graph


def add_shifts(a: tuple[int, int, int], b: tuple[int, int, int]) -> tuple[int, int, int]:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def cell_array(atoms: Atoms) -> np.ndarray:
    return np.asarray(atoms.cell.array, dtype=float)


def bond_score(rule: BondRule, a: Site, b: Site) -> int | None:
    """Match score of a bond rule for the pair (best of both orientations), None if no match."""
    best: int | None = None
    for x, y in ((a, b), (b, a)):
        sa = name_score(rule.a, x)
        sb = name_score(rule.b, y)
        if sa is not None and sb is not None and (best is None or sa + sb > best):
            best = sa + sb
    return best


def best_bond_rule(rules: list[BondRule], a: Site, b: Site, distance: float) -> BondRule | None:
    """Highest-scoring visible rule whose window contains `distance`; earlier rules win ties."""
    best: BondRule | None = None
    best_score = 0
    for rule in rules:
        if not rule.visible or not (rule.min_distance <= distance <= rule.max_distance):
            continue
        score = bond_score(rule, a, b)
        if score is not None and score > best_score:
            best, best_score = rule, score
    return best


@dataclass(frozen=True, slots=True)
class BondSpec:
    a: Site
    b: Site  # periodic image next to `a`
    rule: BondRule


def find_bonds(
    shown: list[Site],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    rules: list[BondRule],
    cell: np.ndarray,
    strict: bool = False,
) -> list[BondSpec]:
    """Bonds from every shown site to neighbour images; the first matching rule wins.

    Every shown site (including box copies) starts bonds to all its neighbour images, so a bond
    leaving the box shows its far end (one hop). A bond whose far atom is not in `shown` (by index) is
    skipped. Rules with `complete: none` also skip bonds whose far end is outside the box (closing_bonds draws
    them later if both ends end up shown).
    `strict` (an active selection) acts as `none` for every rule.
    Each geometric bond is returned once.
    """
    shown_indices = {site.index for site in shown}
    shown_keys = {point_key(site) for site in shown}
    seen: set[frozenset[PointKey]] = set()
    out: list[BondSpec] = []
    for a in shown:
        for nb in graph.get(a.index, []):
            if nb.index not in shown_indices:
                continue
            b = by_index[nb.index].image(add_shifts(a.shift, nb.shift), cell)
            key = frozenset((point_key(a), point_key(b)))
            if key in seen:
                continue
            rule = best_bond_rule(rules, a, b, nb.distance)
            if rule is None:
                continue
            if (strict or rule.complete == "none") and point_key(b) not in shown_keys:
                continue
            seen.add(key)
            out.append(BondSpec(a=a, b=b, rule=rule))
    return out


def closing_bonds(
    shown: list[Site],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    rules: list[BondRule],
    cell: np.ndarray,
) -> list[BondSpec]:
    """Every bond between two shown points, whatever its rule's `complete` mode.

    Runs once the shown set is final, so a far end is only looked up among `shown` and no atom is added.
    It finds bonds the earlier stages could not see, such as the bonds inside a polyhedron cage whose
    atoms all lie outside the box. The far end is checked by key before its image is built.
    """
    shown_keys = {point_key(site) for site in shown}
    seen_pairs: set[frozenset[PointKey]] = set()  # each geometric pair is seen from both ends; keep one
    out: list[BondSpec] = []
    for a in shown:
        for nb in graph.get(a.index, []):
            far_key = (nb.index, add_shifts(a.shift, nb.shift))
            if far_key not in shown_keys:
                continue
            pair = frozenset((point_key(a), far_key))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            b = by_index[nb.index].image(far_key[1], cell)
            rule = best_bond_rule(rules, a, b, nb.distance)
            if rule is not None:
                out.append(BondSpec(a=a, b=b, rule=rule))
    return out


@dataclass(frozen=True, slots=True)
class Completion:
    partner: Site  # image of the bonded atom
    rule: BondRule


def completion_rules(rules: list[BondRule]) -> list[BondRule]:
    """Rules with `complete: polyhedra`: an atom pulled in as a polyhedron ligand gets this bond too."""
    return [rule for rule in rules if rule.visible and rule.complete == "polyhedra"]


def complete_ligand(
    ligand: Site,
    by_index: dict[int, Site],
    graph: NeighborGraph,
    rules: list[BondRule],
    cell: np.ndarray,
) -> list[Completion]:
    """Nearest bonded partner per rule (one per ligand per rule), one hop only. Works for any pair of names."""
    out: list[Completion] = []
    for rule in rules:
        best = None
        for nb in graph.get(ligand.index, []):
            partner = by_index[nb.index]
            if bond_score(rule, ligand, partner) is None:
                continue
            if not (rule.min_distance <= nb.distance <= rule.max_distance):
                continue
            if best is None or nb.distance < best[0]:
                best = (nb.distance, partner.image(add_shifts(ligand.shift, nb.shift), cell))
        if best is not None:
            out.append(Completion(partner=best[1], rule=rule))
    return out
