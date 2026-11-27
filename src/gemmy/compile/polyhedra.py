"""Coordination polyhedra: which centres get one, their ligand images and hull faces."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..config import PolyhedronRule
from .bonds import NeighborGraph
from .lattice import MIN_POLYGON_CORNERS, convex_hull_faces, is_planar
from .sites import PointKey, Site, point_key


@dataclass(frozen=True, slots=True)
class PolyhedronSpec:
    center: Site
    ligands: list[Site]  # periodic images
    faces: list[tuple[int, int, int]]
    rule: PolyhedronRule
    name: str


def rules_for_center(rules: list[PolyhedronRule], center: Site) -> list[PolyhedronRule]:
    """Visible rules whose centre is this site's species label."""
    return [r for r in rules if r.visible and r.center == center.label]


def is_ligand(rule: PolyhedronRule, site: Site) -> bool:
    return site.label in rule.ligands


def polyhedron_name(rule: PolyhedronRule, cn: int) -> str:
    """The rule's name, or the default `<center><ligands><count>` when it has none (an empty name takes the default)."""
    return rule.name or f"{rule.center}{''.join(sorted(rule.ligands))}{cn}"


def skipped_message(center: Site, rule: PolyhedronRule, cn: int) -> str:
    """Why a centre has no polyhedron: its ligands have no hull. Same text as web/src/compile/polyhedra.ts."""
    name = polyhedron_name(rule, cn)
    shift_text = "(" + ", ".join(str(v) for v in center.shift) + ")"
    # Two or more ligands without a hull must lie on one line; fewer than two cannot make one.
    reason = "its ligands are collinear" if cn >= 2 else f"it has only {cn} ligand(s)"
    return (
        f"polyhedron {name} skipped for centre {center.label} (atom {center.index}, image {shift_text}): {reason}, "
        f"so there is no polygon to draw (a polygon needs {MIN_POLYGON_CORNERS} ligands that are not on one line)"
    )


def with_back_faces(faces: list[tuple[int, int, int]]) -> list[tuple[int, int, int]]:
    """A flat polygon has no inside: each triangle is drawn once from each side (the opposite winding), so the
    renderers, which cull back faces, show it from either side."""
    return faces + [(i, k, j) for i, j, k in faces]


def find_polyhedra(
    centers: list[Site],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    rules: list[PolyhedronRule],
    cell: np.ndarray,
    warnings: list[str] | None = None,
) -> list[PolyhedronSpec]:
    """Polyhedra for the centres that meet their rule's coordination. A centre whose ligands have no hull (on a line,
    or fewer than 3) is skipped, and a message naming it is appended to `warnings` when given."""
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
            name = polyhedron_name(rule, cn)
            positions = [lig.position for lig in ligands]
            faces = convex_hull_faces(positions)
            if not faces:
                if warnings is not None:
                    warnings.append(skipped_message(center, rule, cn))
                continue
            if is_planar(positions):
                faces = with_back_faces(faces)
            out.append(PolyhedronSpec(center=center, ligands=ligands, faces=faces, rule=rule, name=name))
    return out
