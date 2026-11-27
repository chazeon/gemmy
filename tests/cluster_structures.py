"""Shared builders for the cluster tests (tests/test_clusters.py and tests/test_ts_clusters.py): synthetic structures
written as POSCAR text, the rules the tests name, and the stages compile_structure runs before the clusters stage.
The structures are synthetic (no fixture directory); the C60 cages are read from the c60 example.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from gemmy.compile.bonds import build_neighbor_graph, cell_array
from gemmy.compile.sites import base_box, build_sites, repeat_structure, snap_sites, wrap_sites
from gemmy.config import ClusterRule
from gemmy.readers import load_structure

ROOT = Path(__file__).resolve().parents[1]
C60 = ROOT / "examples" / "c60"
PERIODIC = (True, True, True)
C6 = "C"
# Nearest-neighbour distance of graphene (Angstrom): the honeycomb's bond.
CC_BOND = 1.42


def molecule(**kw) -> ClusterRule:
    """A molecule rule as the config resolves it (the kind's sizes, the window under min/max)."""
    return ClusterRule.model_validate({"kind": "molecule", "atoms": [C6], "min": 1.3, "max": 1.5, **kw})


def ring(**kw) -> ClusterRule:
    """A ring rule as the config resolves it (the kind's sizes, the window under min/max)."""
    return ClusterRule.model_validate({"kind": "ring", "atoms": [C6], "min": 1.3, "max": 1.5, **kw})


# ---- POSCAR builders ------------------------------------------------------------------------------------------------


def poscar_cell(vectors: list[tuple[float, float, float]], atoms: list[tuple[str, tuple[float, float, float]]]) -> str:
    """A POSCAR (Direct coordinates) for the cell rows `vectors` and Cartesian `atoms` in Angstrom. Species are grouped
    in first-seen order."""
    lattice = np.asarray(vectors, dtype=float)
    species = list(dict.fromkeys(symbol for symbol, _ in atoms))
    counts = [sum(1 for symbol, _ in atoms if symbol == s) for s in species]
    lines = [
        "synthetic cluster test",
        "1.0",
        *(f"{v[0]:.12f} {v[1]:.12f} {v[2]:.12f}" for v in vectors),
        " ".join(species),
        " ".join(str(c) for c in counts),
        "Direct",
    ]
    for s in species:
        for symbol, position in atoms:
            if symbol == s:
                frac = np.asarray(position, dtype=float) @ np.linalg.inv(lattice)
                lines.append(f"{frac[0]:.12f} {frac[1]:.12f} {frac[2]:.12f}")
    return "\n".join(lines) + "\n"


def poscar(lattice: float, atoms: list[tuple[str, tuple[float, float, float]]]) -> str:
    """A cubic POSCAR of side `lattice` (see poscar_cell)."""
    return poscar_cell([(lattice, 0.0, 0.0), (0.0, lattice, 0.0), (0.0, 0.0, lattice)], atoms)


def molecule_extxyz(text: str) -> str:
    """The atoms of a POSCAR (Direct or Cartesian coordinates) as a non-periodic extxyz (pbc "F F F"): a molecule in the
    same cell. Its name is MOLECULE_NAME."""
    lines = text.strip().splitlines()
    scale = float(lines[1])
    vectors = np.asarray([[float(v) for v in lines[i].split()[:3]] for i in (2, 3, 4)]) * scale
    species = lines[5].split()
    counts = [int(c) for c in lines[6].split()]
    positions = np.asarray([[float(v) for v in line.split()[:3]] for line in lines[8 : 8 + sum(counts)]])
    if lines[7].strip()[:1].lower() == "d":
        cartesian = positions @ vectors
    else:
        cartesian = positions * scale
    symbols = [s for s, n in zip(species, counts, strict=True) for _ in range(n)]
    lattice = " ".join(f"{v:.10f}" for v in vectors.flatten())
    rows = [str(len(symbols)), f'Lattice="{lattice}" Properties=species:S:1:pos:R:3 pbc="F F F"']
    rows += [f"{symbol} {x:.10f} {y:.10f} {z:.10f}" for symbol, (x, y, z) in zip(symbols, cartesian, strict=True)]
    return "\n".join(rows) + "\n"


MOLECULE_NAME = "molecule.extxyz"


def ring_atoms(centre: tuple[float, float, float], radius: float, z_of=lambda k: 0.0, symbol: str = C6):
    """Six atoms on a circle of `radius` about `centre`, angle 60 k degrees, height z_of(k) above the centre."""
    cx, cy, cz = centre
    return [
        (
            symbol,
            (cx + radius * math.cos(math.radians(60 * k)), cy + radius * math.sin(math.radians(60 * k)), cz + z_of(k)),
        )
        for k in range(6)
    ]


# ---- molecules and rings --------------------------------------------------------------------------------------------


def benzene(cell: float = 20.0) -> str:
    """C6H6 in a big cell, flat: C ring of radius 1.39 and H on radius 2.48, both in the plane z = cell / 2."""
    c = (cell / 2, cell / 2, cell / 2)
    return poscar(cell, ring_atoms(c, 1.39) + ring_atoms(c, 2.48, symbol="H"))


def naphthalene(cell: float = 20.0) -> str:
    """C10H8 as two fused hexagons (edge 1.40 A) sharing the bond at x = 1.212 (the shared vertices coincide)."""
    centre = cell / 2
    points: list[tuple[float, float, float]] = []
    for cx in (0.0, math.sqrt(3) * 1.40):  # hexagon centres, across flats = sqrt(3) * 1.40
        for k in range(6):
            a = math.radians(30 + 60 * k)
            p = (round(centre + cx + 1.40 * math.cos(a), 6), round(centre + 1.40 * math.sin(a), 6), centre)
            if p not in points:
                points.append(p)
    assert len(points) == 10
    return poscar(cell, [(C6, p) for p in points])


def chair_cyclohexane(cell: float = 20.0) -> str:
    """Cyclohexane in the chair form: ring radius 1.25 A, alternate atoms 0.25 A above and below the mean plane."""
    centre = (cell / 2, cell / 2, cell / 2)
    return poscar(cell, ring_atoms(centre, 1.25, z_of=lambda k: 0.25 if k % 2 == 0 else -0.25))


def split_ring(cell: float = 10.0, centre_x: float = 0.2) -> str:
    """A C6 ring whose centroid sits near the cell's x = 0 face, so atoms on the far side have negative fractional x
    (the ring is split by the periodic boundary, as wrapped POSCARs often are)."""
    return poscar(cell, ring_atoms((centre_x, cell / 2, cell / 2), 1.39))


def k23(cell: float = 10.0) -> str:
    """K2,3: two atoms above and below a plane (z = +-0.6) and three on a circle of radius 0.8 in it. Every apex-to-ring
    bond is 1.00 A and the rest are out of the 0.99-1.01 window, so its cycles are the three squares of K2,3."""
    c = cell / 2
    apexes = [(C6, (c, c, c + 0.6)), (C6, (c, c, c - 0.6))]
    ring_atoms_ = [
        (C6, (c + 0.8 * math.cos(math.radians(a)), c + 0.8 * math.sin(math.radians(a)), c)) for a in (0, 120, 240)
    ]
    return poscar(cell, apexes + ring_atoms_)


def collinear_triple(cell: float = 20.0) -> str:
    """Three C on one line, 1.0 A apart: each pair is in a 1.0-2.01 window, so the three form a 3-cycle with no area."""
    return poscar(cell, [(C6, (9.0, 10.0, 10.0)), (C6, (10.0, 10.0, 10.0)), (C6, (11.0, 10.0, 10.0))])


def honeycomb_sheet(cells: int = 1, vacuum: float = 20.0, pendant: bool = False) -> str:
    """A graphene sheet of cells x cells primitive cells (two C each), in the plane, with `vacuum` along z. With
    `pendant`, one C sits 1.45 A above the first atom: bonded to the sheet at one atom only."""
    a = CC_BOND * math.sqrt(3)
    a1 = (a, 0.0)
    a2 = (a / 2, a * math.sqrt(3) / 2)
    atoms: list[tuple[str, tuple[float, float, float]]] = []
    z = vacuum / 2
    for i in range(cells):
        for j in range(cells):
            x = i * a1[0] + j * a2[0]
            y = i * a1[1] + j * a2[1]
            atoms.append((C6, (x, y, z)))
            atoms.append((C6, (x, y + CC_BOND, z)))
    if pendant:
        x, y, _ = atoms[0][1]
        atoms.append((C6, (x, y, z + 1.45)))
    vectors = [
        (cells * a1[0], cells * a1[1], 0.0),
        (cells * a2[0], cells * a2[1], 0.0),
        (0.0, 0.0, vacuum),
    ]
    return poscar_cell(vectors, atoms)


def chain(atoms: int = 2000, spacing: float = CC_BOND) -> str:
    """A straight chain of `atoms` C, `spacing` apart, closed by the periodic boundary (a periodic network). The cell is
    thin across the chain, so the neighbour search bins only the chain's length."""
    length = atoms * spacing
    vectors = [(length, 0.0, 0.0), (0.0, 20.0, 0.0), (0.0, 0.0, 20.0)]
    return poscar_cell(vectors, [(C6, (k * spacing, 10.0, 10.0)) for k in range(atoms)])


# ---- the c60 example ------------------------------------------------------------------------------------------------


def c60_poscar() -> str:
    """examples/c60/POSCAR as text: the 240 carbons of 4 molecules per conventional cell, no marker atoms."""
    text = (C60 / "POSCAR").read_text(encoding="utf-8")
    assert len(load_structure(C60 / "POSCAR").atoms) == 240
    return text


# ---- stages ---------------------------------------------------------------------------------------------------------


def stages(tmp_path: Path, text: str, supercell=(1, 1, 1), periodic=PERIODIC, box=None, eps=1e-4, cutoff=1.5):
    """Sites in the display box, sites by index, the neighbour graph and the cell, as compile_structure builds them."""
    path = tmp_path / "POSCAR"
    path.write_text(text, encoding="utf-8")
    structure = load_structure(path)
    atoms = repeat_structure(structure, supercell, periodic)
    cell = cell_array(atoms)
    base = snap_sites(build_sites(structure, atoms), cell, eps)
    by_index = {s.index: s for s in base}
    wrapped = wrap_sites(base, cell, periodic)
    in_box = base_box(wrapped, cell, box or {}, periodic, eps)
    graph = build_neighbor_graph(atoms, cutoff)
    return in_box, by_index, graph, cell
