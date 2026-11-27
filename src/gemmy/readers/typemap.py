"""The atoms of a LAMMPS file: the type map (`types`) and the rule for a file without one, shared by both backends.

With a map, the map decides each atom's element and style key over any element or mass column in the file (R8). With
no map, the file's own labels, then its masses, decide (R13), in the order `_no_map_element` states. Only the readers
read a file; this module never reads one, it only decides what the file's atoms are."""

from __future__ import annotations

import functools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from ..elements import element_of_label
from .record import AtomRecord

DUMMY_ELEMENT = "X"
# A mass within this many unit masses of an element's mass names that element (R13). Wider than the masses of the
# isotopes gemmy does not name, narrower than the gap between neighbouring elements.
MASS_TOLERANCE = 0.1


@dataclass(frozen=True)
class Identity:
    """What a LAMMPS file says about an atom, or about a type, before any map. `label` is a type label or a dump's
    element column, which must name an element. `comment` is a Masses comment, used only when it names an element.
    `mass` is a Masses value or a dump's mass column."""

    label: str | None = None
    comment: str | None = None
    mass: float | None = None


NO_IDENTITY = Identity()


def lammps_records(
    path: Path,
    fractional: Sequence,
    atom_types: Sequence[int] | None,
    identities: Sequence[Identity],
    types: Mapping[int, str],
) -> list[AtomRecord]:
    """The atoms of a LAMMPS file: the map's records when there is a map, else the records of the no-map rule."""
    if types:
        return map_records(path, fractional, atom_types, types)
    return unmapped_records(path, fractional, atom_types, identities)


def map_records(
    path: Path, fractional: Sequence, atom_types: Sequence[int] | None, types: Mapping[int, str]
) -> list[AtomRecord]:
    """Each atom's style key is its type's label, and its element the one that label names (R8, R9)."""
    if atom_types is None:
        raise no_type_column(path, "its `types` map does not apply to it")
    _check_every_type_named(path, atom_types, types)
    elements = {type_number: element_of_label(label) for type_number, label in types.items()}
    return [
        AtomRecord(element=elements[atom_type], fractional=frac, style_key=types[atom_type])
        for frac, atom_type in zip(fractional, atom_types, strict=True)
    ]


def unmapped_records(
    path: Path, fractional: Sequence, atom_types: Sequence[int] | None, identities: Sequence[Identity]
) -> list[AtomRecord]:
    """Each atom's element and style key with no map (R13). Only an atom with no element source needs its type."""
    type_per_atom = atom_types if atom_types is not None else [None] * len(fractional)
    records = []
    for frac, atom_type, identity in zip(fractional, type_per_atom, identities, strict=True):
        element, key = _no_map_element(path, identity, atom_type)
        records.append(AtomRecord(element=element, fractional=frac, style_key=key))
    return records


def _no_map_element(path: Path, identity: Identity, atom_type: int | None) -> tuple[str, str]:
    """The element and style key of an atom with no map: its label; else its Masses comment, when that names an
    element; else the one element its mass names; else the dummy X. The style key is the label, or the type number
    when the element is not named by a label (X, or a mass alone)."""
    if identity.label is not None:
        return element_of_label(identity.label), identity.label
    if identity.comment is not None and names_element(identity.comment):
        return element_of_label(identity.comment), identity.comment
    symbol = element_by_mass(identity.mass) if identity.mass is not None else None
    if symbol is not None:
        return symbol, _style_key_for_mass_only_type(symbol, atom_type)
    if atom_type is None:
        raise no_type_column(path, "its types have no element")
    return DUMMY_ELEMENT, str(atom_type)


def _style_key_for_mass_only_type(symbol: str, atom_type: int | None) -> str:
    """Without a type column the element is the only key there is; otherwise a mass-only type is keyed by its number."""
    return symbol if atom_type is None else str(atom_type)


def identities_of_atoms(identity_by_type: Mapping[int, Identity], atom_types: Sequence[int]) -> list[Identity]:
    """Each atom's identity from its type's, for a data file (whose identities are per type)."""
    return [identity_by_type.get(t, NO_IDENTITY) for t in atom_types]


def names_element(label: str) -> bool:
    try:
        element_of_label(label)
    except ValueError:
        return False
    return True


@functools.cache
def element_by_mass(mass: float) -> str | None:
    """The one element whose mass is within MASS_TOLERANCE of `mass`, or None when no element or several are."""
    from ase.data import atomic_masses, chemical_symbols  # type: ignore

    # Index 0 is the dummy X, which has no mass of its own here.
    names = [
        symbol
        for number, symbol in enumerate(chemical_symbols)
        if number and abs(atomic_masses[number] - mass) <= MASS_TOLERANCE
    ]
    return names[0] if len(names) == 1 else None


def no_type_column(path: Path, reason: str) -> ValueError:
    return ValueError(f"{path.name} has no type column, so {reason}.")


def _check_every_type_named(path: Path, atom_types: Sequence[int], types: Mapping[int, str]) -> None:
    """Every type the file uses must have a label in the map. The message names the types and the `types` key."""
    missing = sorted(set(atom_types) - set(types))
    if missing:
        raise ValueError(
            f"{path.name}: LAMMPS types {missing} have no label. Name each in the config's `types` key, "
            f'e.g. `{missing[0]} = "Fe1"`.'
        )
