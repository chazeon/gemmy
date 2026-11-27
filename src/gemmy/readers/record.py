"""The structure a reader gives: plain records, the same shape for every reader backend and for the compile stages."""

from __future__ import annotations

from dataclasses import dataclass

from ..scene import Vec3

# A cell with less volume has no cell: gemmy works in fractional coordinates, so the read is an error.
NO_VOLUME = 1e-9


@dataclass(slots=True)
class AtomRecord:
    element: str
    fractional: Vec3
    style_key: str | None = None


@dataclass(slots=True)
class Structure:
    comment: str
    lattice: tuple[Vec3, Vec3, Vec3]
    atoms: list[AtomRecord]


def no_cell_error(name: str) -> ValueError:
    return ValueError(f"{name} has no cell; give it a lattice (non-periodic axes can be a box around the atoms).")


def float_triple(values) -> Vec3:
    """Three numbers (an array row or a tuple) as a float triple."""
    x, y, z = values
    return (float(x), float(y), float(z))


def lattice_rows(cell) -> tuple[Vec3, Vec3, Vec3]:
    """The three lattice rows of a cell (an array or nested sequence) as float triples."""
    return tuple(float_triple(row) for row in cell)
