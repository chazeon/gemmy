"""Crystal structure input: the one entry point, `load_structure`. It reads with the backend `selection` chooses (one
per process): `fastatoms` when it is usable, else `ase`, or the one GEMMY_READER names. Each backend must give what
docs/plans/reader-contract.md says a read gives (the rules R1 to R14); tests/test_reader_contract.py holds each backend
to them. Backends import their packages lazily, so importing this module needs neither ASE nor fastatoms."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING

from .formats import LAMMPS_FORMATS, format_of
from .selection import READERS, active_reader_name

if TYPE_CHECKING:
    from .record import Structure


def load_structure(path: str | Path, types: Mapping[int, str] | None = None) -> Structure:
    """A structure file. `types` maps LAMMPS type numbers to species labels. It applies to LAMMPS data and dump files
    only (by their content or name), so a non-empty map for any other file is an error. An empty map is no map."""
    path = Path(path)
    if types and format_of(path) not in LAMMPS_FORMATS:
        raise ValueError(
            f"{path.name}: `types` names LAMMPS types, but {path.name} is not a LAMMPS data or dump file. Its name "
            "needs a data or dump part, such as mgo.data, dump.step or a .lammpstrj suffix."
        )
    return READERS[active_reader_name()].read(path, dict(types or {}))
