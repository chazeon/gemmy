"""The structure a reader gives: plain records, the same shape for every reader backend and for the compile stages."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from ..scene import Vec3

# A cell with less volume has no cell: gemmy works in fractional coordinates, so the read is an error.
NO_VOLUME = 1e-9
# An occupancy within this of 1 is whole (a CIF's rounding is not a vacancy).
WHOLE_TOLERANCE = 1e-6


@dataclass(slots=True)
class AtomRecord:
    element: str
    fractional: Vec3
    style_key: str | None = None


@dataclass(slots=True)
class PartialSite:
    """A kept site whose occupants are not one species at occupancy 1 (R12): the index of its atom, and each occupant's
    symbol with its occupancy, the largest share first."""

    index: int
    occupants: dict[str, float]


@dataclass(slots=True)
class Structure:
    comment: str
    lattice: tuple[Vec3, Vec3, Vec3]
    atoms: list[AtomRecord]
    # The kept sites that are partly occupied (R12); empty unless the file has an occupancy table.
    partial: list[PartialSite] = field(default_factory=list)


def no_cell_error(name: str) -> ValueError:
    return ValueError(f"{name} has no cell; give it a lattice (non-periodic axes can be a box around the atoms).")


def float_triple(values) -> Vec3:
    """Three numbers (an array row or a tuple) as a float triple."""
    x, y, z = values
    return (float(x), float(y), float(z))


def lattice_rows(cell) -> tuple[Vec3, Vec3, Vec3]:
    """The three lattice rows of a cell (an array or nested sequence) as float triples."""
    return tuple(float_triple(row) for row in cell)


def partial_sites(
    occupancy: Mapping[str, Mapping[str, float]] | None, kinds: Sequence[int] | None
) -> list[PartialSite]:
    """The partly occupied sites of a CIF (R12). `occupancy` is the binding's or ASE's table (a row of the asymmetric
    unit -> {symbol: occupancy}) and `kinds` gives each atom's row. An atom is partial when its row is not one species
    at occupancy 1. No table (a CIF with no occupancy column) gives none."""
    if not occupancy or kinds is None:
        return []
    sites = []
    for index, kind in enumerate(kinds):
        row = occupancy.get(str(int(kind)))
        if row is None or _is_whole(row):
            continue
        ranked = sorted(((symbol, float(share)) for symbol, share in row.items()), key=lambda item: (-item[1], item[0]))
        sites.append(PartialSite(index=index, occupants=dict(ranked)))
    return sites


def _is_whole(row: Mapping[str, float]) -> bool:
    return len(row) == 1 and abs(float(next(iter(row.values()))) - 1.0) <= WHOLE_TOLERANCE


def partial_note(sites: Sequence[PartialSite]) -> str | None:
    """The one line that says a read's partly occupied sites (R12): the page's message line and `gemmy compile`'s
    warning both show it. None when there are none. The wording is web/src/structure/partial.ts's partialNote, and the
    contract test holds both to the same text."""
    if not sites:
        return None
    count = len(sites)
    kind = "mixed" if all(len(site.occupants) > 1 for site in sites) else "partly occupied"
    first = " over ".join(f"{symbol} {_share_text(share)}" for symbol, share in sites[0].occupants.items())
    kept = f"kept the larger share ({first})" if count == 1 else f"kept the larger share at each (first: {first})"
    noun = "site" if count == 1 else "sites"
    return f"{count} {kind} {noun}: {kept}. Partial occupancy isn't drawn."


def _share_text(share: float) -> str:
    return f"{round(share, 6):g}"
