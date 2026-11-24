"""Coordination polyhedra: which centres get one, their ligand images and hull faces."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..config import PolyhedronRule
from .bonds import NeighborGraph
from .lattice import convex_hull_faces
from .sites import PointKey, Site, point_key


@dataclass(frozen=True, slots=True)
class PolyhedronSpec:
    center: Site
    ligands: list[Site]  # periodic images
    faces: list[tuple[int, int, int]]
    rule: PolyhedronRule
    name: str


def rules_for_center(rules: list[PolyhedronRule], center: Site) -> list[PolyhedronRule]:
    """Visible rules for this centre: those naming its exact label if any, else by element."""
    visible = [r for r in rules if r.visible]
    by_label = [r for r in visible if r.center == center.label]
    return by_label or [r for r in visible if r.center == center.element]


def is_ligand(rule: PolyhedronRule, site: Site) -> bool:
    return site.label in rule.ligands or site.element in rule.ligands


def find_polyhedra(
    centers: list[Site],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    rules: list[PolyhedronRule],
    cell: np.ndarray,
) -> list[PolyhedronSpec]:
    out: list[PolyhedronSpec] = []
    for center in centers:
        for rule in rules_for_center(rules, center):
            if center.copy and not rule.image_centers:
                continue
            ligands: list[Site] = []
            seen: set[PointKey] = set()
            for nb in graph.get(center.index, []):
                if not (rule.min_distance <= nb.distance <= rule.max_distance):
                    continue
                base = by_index[nb.index]
                if not is_ligand(rule, base):
                    continue
                image = base.image(
                    (center.shift[0] + nb.shift[0], center.shift[1] + nb.shift[1], center.shift[2] + nb.shift[2]), cell
                )
                key = point_key(image)
                if key in seen:
                    continue
                seen.add(key)
                ligands.append(image)
            cn = len(ligands)
            if cn < rule.min_coordination or (rule.max_coordination is not None and cn > rule.max_coordination):
                continue
            if cn < 4:
                continue
            faces = convex_hull_faces([lig.position for lig in ligands])
            if not faces:
                continue
            name = rule.name or f"{rule.center}{''.join(sorted(rule.ligands))}{cn}"
            out.append(PolyhedronSpec(center=center, ligands=ligands, faces=faces, rule=rule, name=name))
    return out
