"""The ASE reader backend. ASE parses each file; gemmy then corrects what ASE gives to the reader contract
(docs/plans/reader-contract.md). LAMMPS text is handled in lammps_data and lammps_dump, element and label decisions
in typemap, so this module reads as the reader: parse, measure from the box origin, then records. ASE is imported
lazily."""

from __future__ import annotations

import io
from collections.abc import Mapping, Sequence
from pathlib import Path

from ..elements import element_of_label
from . import lammps_data, lammps_dump, typemap
from .formats import format_of, read_text
from .record import NO_VOLUME, AtomRecord, Structure, float_triple, lattice_rows, no_cell_error
from .species_text import SPECIES_LINE, extxyz_species, read_poscar

# gemmy's format names as ASE's: ASE reads a dump with the lammps-dump-text reader.
ASE_FORMAT = {
    "lammps-data": "lammps-data",
    "lammps-dump": "lammps-dump-text",
    "vasp": "vasp",
    "extxyz": "extxyz",
    "cif": "cif",
}


class _NoElements(dict):
    """ASE's `Z_of_type` for a data file: every type is atomic number 0, the dummy X. ASE would otherwise guess elements
    from masses or the type numbers and index its table with them, which fails for a type above 118. ASE tests the
    mapping's truth before it reads it, so the mapping is true even though it is empty."""

    def __bool__(self) -> bool:
        return True

    def __missing__(self, type_number: int) -> int:
        return 0


class AseReader:
    def read(self, path: Path, types: Mapping[int, str]) -> Structure:
        # A missing ASE is reported before the file is opened.
        _ase_read_function()
        fmt = format_of(path)
        if fmt is None:
            return _from_atoms(_ase_guessed(path), path.name)
        text = read_text(path)
        if fmt == "lammps-data":
            return _read_data(path, text, types)
        if fmt == "lammps-dump":
            return _read_dump(path, text, types)
        if fmt == "vasp":
            return _read_vasp(path, text)
        if fmt == "extxyz":
            return _read_extxyz(path, text)
        return _from_atoms(_ase_read(text, fmt), path.name)


def _ase_read_function():
    """ASE's read function, imported here: a missing ASE is a RuntimeError, raised before any file is read."""
    try:
        from ase.io import read  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "ASE is required to load structure input. Install compile deps with: pip install gemmy"
        ) from exc
    return read


def _ase_guessed(path: Path):
    """A format outside gemmy's five, read by ASE's own guess from the name (its trajectory, for one, is binary)."""
    with path.open("rb") as handle:
        return _ase_read_function()(handle, index=-1)


def _ase_read(text: str, fmt: str, **options):
    return _ase_read_function()(io.StringIO(text), format=ASE_FORMAT[fmt], **options)


def _read_vasp(path: Path, text: str) -> Structure:
    """A POSCAR. Its species are its labels as written (Fe_pv, or Fe2 from a VASP 4 comment), each keyed by its label;
    ASE reads the element each label names, so the species line it reads is the elements."""
    poscar = read_poscar(text, path.name)
    lines = poscar.lines
    style_keys = None
    if poscar.species:
        # Writing the species line again when the labels are already elements changes nothing ASE reads.
        elements = [element_of_label(label) for label in poscar.species]
        lines[SPECIES_LINE] = " ".join(elements)
        style_keys = [label for label, count in zip(poscar.species, poscar.counts, strict=True) for _ in range(count)]
    return _from_atoms(_ase_read("\n".join(lines) + "\n", "vasp"), path.name, style_keys)


def _read_extxyz(path: Path, text: str) -> Structure:
    """An extended XYZ. Its species column decides each atom's element and label over any Z column (R11)."""
    atoms = _ase_read(text, "extxyz")
    species = extxyz_species(text)
    if species is None:
        return _from_atoms(atoms, path.name)
    return _from_atoms(atoms, path.name, style_keys=species, elements=[element_of_label(s) for s in species])


def _read_data(path: Path, text: str, types: Mapping[int, str]) -> Structure:
    """A LAMMPS data file, measured from its box origin: a restricted box's lower bounds (read from its header), plus
    the displacement ASE gives a general triclinic box (`abc origin`)."""
    numeric = lammps_data.normalised_data(text)
    atoms = _ase_read(numeric, "lammps-data", Z_of_type=_NoElements(), read_image_flags=False)
    _move_to_origin(atoms, _displacement(atoms) + _lower_bounds(numeric))
    lattice, fractional = _cell_and_fractional(atoms, path.name)
    atom_types = [int(t) for t in atoms.arrays["type"]]
    identities = typemap.identities_of_atoms(lammps_data.data_identities(numeric), atom_types)
    records = typemap.lammps_records(path, fractional, atom_types, identities, types)
    return Structure(comment=path.name, lattice=lattice, atoms=records)


def _read_dump(path: Path, text: str, types: Mapping[int, str]) -> Structure:
    """A LAMMPS dump's last complete frame. Its positions are measured from the box origin unless its coordinates are
    scaled, which are fractions already. ASE's species for the types are neutral (see
    DumpFrame.neutralised_element_column)."""
    frame = lammps_dump.last_complete_frame(text, path.name)
    atom_types = frame.types()
    type_count = max(atom_types or [], default=0)
    neutral_species = [typemap.DUMMY_ELEMENT] * type_count
    atoms = _ase_read(frame.neutralised_element_column(), "lammps-dump", specorder=neutral_species)
    if not frame.scaled:
        _move_to_origin(atoms, _displacement(atoms))
    lattice, fractional = _cell_and_fractional(atoms, path.name)
    records = typemap.lammps_records(path, fractional, atom_types, frame.identities(), types)
    return Structure(comment=path.name, lattice=lattice, atoms=records)


def _displacement(atoms):
    """ASE's cell displacement: the box origin of a LAMMPS box (a dump's absolute coordinates, a general data box)."""
    import numpy as np  # type: ignore

    return np.asarray(atoms.get_celldisp(), dtype=float).reshape(3)


def _lower_bounds(numeric_text: str):
    import numpy as np  # type: ignore

    return np.asarray(lammps_data.restricted_lower_bounds(numeric_text), dtype=float)


def _move_to_origin(atoms, origin) -> None:
    """Positions measured from the box origin, as LAMMPS writes them absolute."""
    atoms.positions = atoms.positions - origin


def _cell_and_fractional(atoms, name: str):
    """The lattice rows and each atom's fractional position. The cell must have volume: gemmy works in fractions."""
    if abs(atoms.cell.volume) < NO_VOLUME:
        raise no_cell_error(name)
    fractional = [float_triple(p) for p in atoms.get_scaled_positions(wrap=False)]
    return lattice_rows(atoms.get_cell().array), fractional


def _from_atoms(
    atoms, name: str, style_keys: Sequence[str] | None = None, elements: Sequence[str] | None = None
) -> Structure:
    """A structure whose atoms are keyed by their symbols, or by `style_keys` when they are given (one per atom). Their
    elements are the symbols, or `elements` when given."""
    lattice, fractional = _cell_and_fractional(atoms, name)
    symbols = atoms.get_chemical_symbols()
    if style_keys is not None and len(style_keys) != len(symbols):
        raise ValueError(f"{name}: {len(style_keys)} style keys for {len(symbols)} atoms")
    keys = symbols if style_keys is None else style_keys
    atom_elements = symbols if elements is None else elements
    records = [
        AtomRecord(element=element, fractional=frac, style_key=key)
        for element, frac, key in zip(atom_elements, fractional, keys, strict=True)
    ]
    return Structure(comment=name, lattice=lattice, atoms=records)
