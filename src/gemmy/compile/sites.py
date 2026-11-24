"""Sites: one atom position each. Expansion from the structure, then the fixed steps that decide which sites
exist (README, "Which atoms are shown"): snap and wrap (stage 1), the display box with boundary copies
(stage 2), the cartesian limits, and name matching. The arithmetic is in `lattice`."""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
from ase import Atoms

from ..scene import Vec3
from ..structure import Structure
from . import lattice


@dataclass(frozen=True, slots=True)
class Site:
    """One atom position. `index` is the supercell atom index; images keep it and set `shift`."""

    index: int
    element: str
    label: str  # POSCAR species label, sidecar or labeler; defaults to the element
    fractional: Vec3
    position: Vec3
    shift: tuple[int, int, int] = (0, 0, 0)
    copy: bool = False  # extra boundary copy made by the display box

    def image(self, shift: tuple[int, int, int], cell: np.ndarray) -> Site:
        """This atom translated by an integer lattice shift (relative to the unshifted atom)."""
        pos, frac = lattice.offset(self.position, self.fractional, shift, cell)
        return replace(self, position=pos, fractional=frac, shift=(int(shift[0]), int(shift[1]), int(shift[2])))

    def translate(self, shift: tuple[int, int, int], cell: np.ndarray) -> Site:
        """This site moved by an additional integer lattice shift (shifts accumulate)."""
        pos, frac = lattice.offset(self.position, self.fractional, shift, cell)
        total = (self.shift[0] + shift[0], self.shift[1] + shift[1], self.shift[2] + shift[2])
        return replace(self, position=pos, fractional=frac, shift=total)


PointKey = tuple[int, tuple[int, int, int]]


def point_key(site: Site) -> PointKey:
    """Identity of a point: (base atom index, integer image shift). The single place identity is defined."""
    return (site.index, site.shift)


def site_ref(site: Site, wrap_shift: tuple[int, int, int]) -> str:
    """The atom reference of a site, as `parse_site_ref` reads it. `wrap_shift` is the shift that put the atom
    in the cell (stage 1); references are relative to that wrapped position, not the raw one."""
    rel = (site.shift[0] - wrap_shift[0], site.shift[1] - wrap_shift[1], site.shift[2] - wrap_shift[2])
    return f"{site.index}+{rel[0]}_{rel[1]}_{rel[2]}" if any(rel) else str(site.index)


def name_score(name: str, site: Site) -> int | None:
    """Exact label first, then element: 2 for a label match, 1 for an element match, None for no match.
    A rule written with the element still matches every label of that element."""
    if name == site.label:
        return 2
    if name == site.element:
        return 1
    return None


def repeat_structure(
    structure: Structure,
    supercell: tuple[int, int, int],
    periodic: tuple[bool, bool, bool],
) -> Atoms:
    base = Atoms(
        symbols=[atom.element for atom in structure.atoms],
        scaled_positions=[atom.fractional for atom in structure.atoms],
        cell=np.asarray(structure.lattice, dtype=float),
        pbc=periodic,
    )
    repeated = base.repeat(supercell)
    repeated.set_pbc(periodic)
    return repeated


def build_sites(structure: Structure, atoms: Atoms) -> list[Site]:
    positions = np.asarray(atoms.get_positions(), dtype=float)
    scaled = np.asarray(atoms.get_scaled_positions(wrap=False), dtype=float)
    symbols = atoms.get_chemical_symbols()
    keys = [atom.style_key or atom.element for atom in structure.atoms]
    sites: list[Site] = []
    for i, (element, pos, frac) in enumerate(zip(symbols, positions, scaled, strict=True)):
        sites.append(
            Site(
                index=i,
                element=element,
                label=keys[i % len(keys)] if keys else element,
                fractional=(float(frac[0]), float(frac[1]), float(frac[2])),
                position=(float(pos[0]), float(pos[1]), float(pos[2])),
            )
        )
    return sites


def snap_sites(sites: list[Site], cell: np.ndarray, eps: float) -> list[Site]:
    """Pull coordinates within eps of an integer onto it, so a structure written either way is the same site."""
    out: list[Site] = []
    for site in sites:
        snapped = lattice.snap(site.fractional, site.position, cell, eps)
        out.append(site if snapped is None else replace(site, fractional=snapped[0], position=snapped[1]))
    return out


def wrap_sites(sites: list[Site], cell: np.ndarray, periodic: tuple[bool, bool, bool]) -> list[Site]:
    """Translate each (already snapped) site into [0, 1) on periodic axes. Identity stays (index, shift)."""
    out: list[Site] = []
    for site in sites:
        shift = lattice.wrap_shift(site.fractional, periodic)
        out.append(site.image(shift, cell) if any(shift) else site)
    return out


def base_box(
    sites: list[Site],
    cell: np.ndarray,
    box: dict[str, tuple[float, float]],
    periodic: tuple[bool, bool, bool],
    eps: float,
) -> list[Site]:
    """Sites in the display box (fractional range per axis, default [0, 1], inclusive with eps).

    A periodic atom on a box face is shown on both faces, on an edge 4 times, at a corner 8 times.
    Copies keep the atom's index and differ by an integer shift.
    """
    out: list[Site] = []
    for site in sites:
        for n in lattice.box_shifts(site.fractional, box, periodic, eps):
            out.append(replace(site.translate(n, cell), copy=True) if any(n) else site)  # type: ignore[arg-type]
    return out


def select_sites(sites: list[Site], limits: dict[str, tuple[float, float]] | None) -> list[Site]:
    """Keep sites inside the cartesian limits box (all sites when limits is empty)."""
    return [site for site in sites if lattice.within_limits(site.position, limits)]
