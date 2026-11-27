"""The fastatoms reader backend: the fastatoms Python binding (the same C++ as the page's reader). Its geometry is the
binding's; the elements and style keys of a LAMMPS file are gemmy's (lammps_data, lammps_dump and typemap), since the
binding names an element by its own rule. fastatoms is imported lazily."""

from __future__ import annotations

import io
from collections.abc import Mapping, Sequence
from pathlib import Path

from ..elements import element_of_label
from . import lammps_data, lammps_dump, typemap
from .formats import LAMMPS_FORMATS, format_of, read_text
from .record import NO_VOLUME, AtomRecord, Structure, float_triple, lattice_rows, no_cell_error
from .species_text import extxyz_species, read_poscar


class FastatomsReader:
    def read(self, path: Path, types: Mapping[int, str]) -> Structure:
        fmt = format_of(path)
        if fmt is None:
            raise ValueError(f"{path.name}: cannot tell its format from its name")
        if fmt in LAMMPS_FORMATS:
            return _read_lammps(path, fmt, types)
        if fmt == "vasp":
            poscar = read_poscar(read_text(path), path.name)
            atoms = _core_read(io.StringIO("\n".join(poscar.lines) + "\n"), fmt)
            # The binding's labels are the species line read_poscar inserted (a VASP 4 comment's labels included).
            return _structure(atoms, path, atom_labels=atoms.labels if poscar.species else None)
        if fmt == "extxyz":
            text = read_text(path)
            atoms = _core_read(io.StringIO(text), fmt)
            return _structure(atoms, path, atom_labels=extxyz_species(text))
        # A CIF, or any other format the binding reads from a file: its own options (a CIF's disorder rule) apply.
        with path.open("rb") as handle:
            atoms = _core_read(handle, fmt, **_core_options(fmt))
        return _structure(atoms, path)


def _core_options(fmt: str) -> dict[str, str]:
    """The binding's options for a format. A CIF file keeps the site of max occupancy where sites are disordered (R12);
    the binding's own default keeps every site."""
    return {"disorder": "max_occupancy"} if fmt == "cif" else {}


def _core_read(source, fmt: str, **options):
    """The binding's read of a file object or of text; its format error is a ValueError."""
    import fastatoms  # type: ignore

    try:
        return fastatoms.io.read(source, format=fmt, **options)
    except fastatoms.FormatError as exc:
        raise ValueError(f"cannot read the structure: {exc}") from exc


def _read_lammps(path: Path, fmt: str, types: Mapping[int, str]) -> Structure:
    """A LAMMPS file. The binding reads the text that gemmy has already made neutral: a data file with its labels as
    numbers, a dump's last frame with a neutral element column. The elements come from typemap, over the binding's."""
    text = read_text(path)
    if fmt == "lammps-data":
        numeric = lammps_data.normalised_data(text)
        atoms = _core_read(io.StringIO(numeric), fmt)
        atom_types = [int(t) for t in atoms.arrays["type"]]
        identities = typemap.identities_of_atoms(lammps_data.data_identities(numeric), atom_types)
    else:
        frame = lammps_dump.last_complete_frame(text, path.name)
        atoms = _core_read(io.StringIO(frame.neutralised_element_column()), fmt)
        atom_types = frame.types()
        identities = frame.identities()
    lattice, fractional = _lattice_and_fractional(atoms, path.name)
    records = typemap.lammps_records(path, fractional, atom_types, identities, types)
    return Structure(comment=path.name, lattice=lattice, atoms=records)


def _structure(atoms, path: Path, atom_labels: Sequence[str] | None = None) -> Structure:
    """A VASP, extended XYZ or CIF structure. An atom with a species label (R10, R11) is keyed by it, and its element is
    the label's element; otherwise the binding's symbol is the element and the key."""
    lattice, fractional = _lattice_and_fractional(atoms, path.name)
    if atom_labels is not None:
        records = [
            AtomRecord(element=element_of_label(label), fractional=frac, style_key=label)
            for label, frac in zip(atom_labels, fractional, strict=True)
        ]
    else:
        records = [
            AtomRecord(element=symbol, fractional=frac, style_key=symbol)
            for symbol, frac in zip(atoms.symbols, fractional, strict=True)
        ]
    return Structure(comment=path.name, lattice=lattice, atoms=records)


def _lattice_and_fractional(atoms, name: str):
    """The lattice rows and each atom's fractional position. The cell must have volume: gemmy works in fractions."""
    import numpy as np  # type: ignore

    if abs(float(np.linalg.det(np.asarray(atoms.cell, dtype=float)))) < NO_VOLUME:
        raise no_cell_error(name)
    fractional = [float_triple(p) for p in atoms.scaled_positions(wrap=False)]
    return lattice_rows(atoms.cell), fractional
