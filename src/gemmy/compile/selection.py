"""Stage 3: selection. Restrict the base set by label, index or polyhedron shell."""

from __future__ import annotations

import numpy as np

from ..config import PolyhedronRule, SelectConfig
from .bonds import NeighborGraph
from .polyhedra import find_polyhedra
from .sites import Site, name_score, point_key


class SelectionError(ValueError):
    """The select block refers to an atom that does not exist."""


def parse_site_ref(ref: int | str) -> tuple[int, tuple[int, int, int] | None]:
    """`5` -> (5, None); `"5+1_0_-1"` -> (5, (1, 0, -1)): atom 5's image shifted by whole lattice vectors."""
    if isinstance(ref, int):
        return ref, None
    head, sep, tail = str(ref).partition("+")
    try:
        index = int(head)
        if not sep:
            return index, None
        sx, sy, sz = (int(v) for v in tail.split("_"))
    except ValueError:
        raise SelectionError(f"bad atom reference {ref!r}; use an index like 5 or an image like '5+1_0_0'") from None
    return index, (sx, sy, sz)


def resolve_centre(ref: int | str, shown: list[Site], by_index: dict[int, Site], cell: np.ndarray) -> Site:
    """The atom `ref` names. It is the atom as placed in the cell (wrapped, not a boundary copy); a shift in
    `ref` (parse_site_ref) moves it by whole lattice vectors from there."""
    index, shift = parse_site_ref(ref)
    if index not in by_index:
        raise SelectionError(f"atom {index} does not exist; the structure has {len(by_index)} atoms")
    centre = next((s for s in shown if s.index == index and not s.copy), by_index[index])
    return centre if shift is None else centre.translate(shift, cell)


def polyhedron_shell(
    ref: int | str,
    shown: list[Site],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    rules: list[PolyhedronRule],
    cell: np.ndarray,
) -> tuple[Site, list[Site]]:
    """Centre `ref` (see resolve_centre) and its polyhedron ligands."""
    centre = resolve_centre(ref, shown, by_index, cell)
    ligands: list[Site] = []
    seen: set = set()
    for spec in find_polyhedra([centre], by_index, graph, rules, cell):
        for s in spec.ligands:
            if point_key(s) not in seen:
                seen.add(point_key(s))
                ligands.append(s)
    return centre, ligands


def apply_selection(
    shown: list[Site],
    select: SelectConfig,
    by_index: dict[int, Site],
    graph: NeighborGraph,
    rules: list[PolyhedronRule],
    cell: np.ndarray,
) -> list[Site]:
    """Keep sites matching `labels`/`indices` (all box copies), plus the exact shell of `shell_of`.

    `indices` are supercell atom indices; `shell_of` also accepts an image like "5+1_0_0". A shell is
    the centre and the ligand images of its polyhedra, so only that one polyhedron's atoms are added. Bonds and
    polyhedra later add whatever else they need. Empty selection returns `shown` unchanged.
    """
    if not select.is_active():
        return shown
    for index in select.indices:
        if index not in by_index:
            raise SelectionError(f"select refers to atom {index}, but the structure has {len(by_index)} atoms")
    wanted = set(select.indices)
    kept = [s for s in shown if s.index in wanted or any(name_score(label, s) is not None for label in select.labels)]
    if select.shell_of is not None:
        centre, ligands = polyhedron_shell(select.shell_of, shown, by_index, graph, rules, cell)
        have = {point_key(s) for s in kept}
        kept.extend(s for s in (centre, *ligands) if point_key(s) not in have)
    return kept
