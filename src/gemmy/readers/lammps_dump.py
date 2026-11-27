"""LAMMPS dump text, read by both reader backends. The backends give positions, cells and type numbers; this module
gives what they do not: a dump's last complete frame, with the columns it needs and the element column neutral (R3,
R4, R8, R13). Nothing here imports ASE or numpy."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from .typemap import Identity

# The coordinate triplets of a dump (R3), in the order a frame is read with: the first one a frame has is its own.
PLAIN = ("x", "y", "z")
SCALED = ("xs", "ys", "zs")
UNWRAPPED = ("xu", "yu", "zu")
SCALED_UNWRAPPED = ("xsu", "ysu", "zsu")
COORDINATE_TRIPLETS = (PLAIN, SCALED, UNWRAPPED, SCALED_UNWRAPPED)
SCALED_TRIPLETS = (SCALED, SCALED_UNWRAPPED)
# A dump's box has one line per axis; a frame whose box is cut short is not complete.
BOX_LINES = 3
# The element column of a dump is replaced with this before a backend reads it: the backend must not fail on a symbol
# gemmy does not know, since the element is decided by the map or gemmy's rule (R8, R13).
NEUTRAL_ELEMENT = "X"
# Items whose names have spaces; every other ITEM line's name is its first word.
MULTI_WORD_ITEMS = ("NUMBER OF ATOMS", "BOX BOUNDS")

T = TypeVar("T")


@dataclass(frozen=True)
class DumpFrame:
    """The last complete frame of a dump: its header lines (every block before ATOMS), its ATOMS columns, the coordinate
    triplet it is read with, and its rows in id order."""

    header: tuple[str, ...]
    columns: tuple[str, ...]
    triplet: tuple[str, str, str]
    rows: tuple[tuple[str, ...], ...]

    @property
    def scaled(self) -> bool:
        """Whether the triplet holds fractions of the cell (already measured from the box origin)."""
        return self.triplet in SCALED_TRIPLETS

    def types(self) -> list[int] | None:
        """Each atom's type number, or None when the frame has no type column."""
        type_column = self._column("type")
        if type_column is None:
            return None
        return [int(row[type_column]) for row in self.rows]

    def identities(self) -> list[Identity]:
        """Each atom's element label (the element column) and mass (the mass column), for the no-map rule."""
        label_column = self._column("element")
        mass_column = self._column("mass")
        return [Identity(label=_cell(row, label_column), mass=_cell(row, mass_column, float)) for row in self.rows]

    def neutralised_element_column(self) -> str:
        """The frame as a backend reads it: its header, then only its chosen coordinate triplet, and the element column
        neutral. The map or gemmy's rule decides the elements, so a backend's own element reading is not used."""
        other_triplets = {name for triplet in COORDINATE_TRIPLETS if triplet != self.triplet for name in triplet}
        kept = [i for i, name in enumerate(self.columns) if name not in other_triplets]
        item_line = "ITEM: ATOMS " + " ".join(self.columns[i] for i in kept)
        lines = [*self.header, item_line]
        lines += [" ".join(self._neutral_value(row, i) for i in kept) for row in self.rows]
        return "\n".join(lines) + "\n"

    def _column(self, name: str) -> int | None:
        return self.columns.index(name) if name in self.columns else None

    def _neutral_value(self, row: tuple[str, ...], column: int) -> str:
        return NEUTRAL_ELEMENT if self.columns[column] == "element" else row[column]


def last_complete_frame(text: str, name: str) -> DumpFrame:
    """The last frame whose atom rows are all there (R4). A frame cut short at the end of a growing dump is not read."""
    complete = [frame for frame in _split_into_frames(_blocks(text)) if _is_complete(frame)]
    if not complete:
        raise ValueError(f"{name} has no complete frame: its atom rows stop short, or it has no frame")
    return _dump_frame(complete[-1], name)


def _cell(row: tuple[str, ...], column: int | None, convert: Callable[[str], T] = str) -> T | None:
    return None if column is None else convert(row[column])


@dataclass
class _Block:
    """One ITEM block of a dump: its key and arguments, its raw lines (the ITEM line first), and its non-blank body."""

    key: str
    args: list[str]
    raw_lines: list[str]
    body: list[str]


def _blocks(text: str) -> list[_Block]:
    """The ITEM blocks of a dump in order. A block runs from its ITEM line to the next one, so ITEM: TIME and
    ITEM: UNITS are blocks like any other."""
    blocks: list[_Block] = []
    for line in text.splitlines():
        if line.startswith("ITEM:"):
            key, args = _item(line)
            blocks.append(_Block(key=key, args=args, raw_lines=[line], body=[]))
        elif blocks:
            current = blocks[-1]
            current.raw_lines.append(line)
            if line.strip():
                current.body.append(line.strip())
    return blocks


def _item(line: str) -> tuple[str, list[str]]:
    body = line.removeprefix("ITEM:").strip()
    for name in MULTI_WORD_ITEMS:
        if body.startswith(name):
            return name, body[len(name) :].split()
    key, *args = body.split() or [""]
    return key, args


def _split_into_frames(blocks: list[_Block]) -> list[list[_Block]]:
    """The blocks of each frame: a frame starts at its TIMESTEP block."""
    frames: list[list[_Block]] = []
    for block in blocks:
        if block.key == "TIMESTEP":
            frames.append([block])
        elif frames:
            frames[-1].append(block)
    return frames


def _is_complete(frame: list[_Block]) -> bool:
    """A frame is complete when its box, its atom count and its atom rows are all there. A frame cut short at the end
    of a growing dump, or with a row cut mid-line, is not."""
    count = _first(frame, "NUMBER OF ATOMS")
    atoms = _first(frame, "ATOMS")
    box = _first(frame, "BOX BOUNDS")
    if count is None or atoms is None or box is None or len(box.body) != BOX_LINES:
        return False
    expected = _declared_count(count)
    return expected is not None and len(atoms.body) == expected and _rows_are_whole(atoms)


def _declared_count(count_block: _Block) -> int | None:
    try:
        return int(count_block.body[0])
    except (IndexError, ValueError):
        return None


def _rows_are_whole(atoms: _Block) -> bool:
    """Every row has one field per ATOMS column."""
    return all(len(row.split()) == len(atoms.args) for row in atoms.body)


def _dump_frame(blocks: list[_Block], name: str) -> DumpFrame:
    atoms = _first(blocks, "ATOMS")
    columns = tuple(atoms.args)
    triplet = _coordinate_triplet(columns, name)
    rows = [tuple(row.split()) for row in atoms.body]
    if "id" in columns:
        # Rows come in id order, so an atom has the same index in the backend's read as in the file's frame.
        id_column = columns.index("id")
        rows.sort(key=lambda row: int(row[id_column]))
    return DumpFrame(header=_header_lines(blocks, atoms), columns=columns, triplet=triplet, rows=tuple(rows))


def _coordinate_triplet(columns: tuple[str, ...], name: str) -> tuple[str, str, str]:
    """The first coordinate triplet the columns hold (R3)."""
    for triplet in COORDINATE_TRIPLETS:
        if set(triplet) <= set(columns):
            return triplet
    raise ValueError(f"{name}: the dump's columns have no coordinates (x y z, xs ys zs, xu yu zu or xsu ysu zsu)")


def _header_lines(blocks: list[_Block], atoms: _Block) -> tuple[str, ...]:
    """The raw lines of every block but ATOMS, in order, without blank lines."""
    return tuple(line for block in blocks if block is not atoms for line in block.raw_lines if line.strip())


def _first(blocks: list[_Block], key: str) -> _Block | None:
    return next((block for block in blocks if block.key == key), None)
