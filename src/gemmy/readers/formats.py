"""Which format a structure file is, and its text. Both reader backends use this module (the contract's R5 and R6).

The text decides first: a dump's first block, a data file's header, a POSCAR's layout, an extended XYZ's Lattice line,
a CIF's data_ line. Only when the text has none of those does the file name decide. Gzip is found by its magic bytes,
never by the name, and a `.gz` suffix (any case) is dropped before the name is matched."""

from __future__ import annotations

import gzip
from pathlib import Path

GZIP_MAGIC = b"\x1f\x8b"
# The head of a file: every signature is in its first lines.
HEAD_LINES = 40
# The bytes looked at to tell a binary file from a text one (a NUL byte in them makes it binary).
BINARY_PROBE_BYTES = 1024
# The LAMMPS formats: a `types` map applies to these only.
LAMMPS_FORMATS = ("lammps-data", "lammps-dump")
# The formats the fastatoms binding must read (its names) for the fastatoms backend to be usable.
FASTATOMS_FORMATS = ("vasp", "xyz", "extxyz", "cif", "lammps-data", "lammps-dump")
# The three tilt labels of a restricted box's header line (xy xz yz), in the order the data reader puts them.
TILT_LABELS = ("xy", "xz", "yz")
# The suffixes that name their format, so a file with one is never LAMMPS, whatever its name starts with.
_OTHER_FORMAT_BY_SUFFIX = {".xyz": "extxyz", ".extxyz": "extxyz", ".cif": "cif"}
_LAMMPS_DATA_SUFFIXES = (".data", ".lmp")
_LAMMPS_DUMP_SUFFIXES = (".dump", ".lammpstrj")


def read_text(path: Path) -> str:
    """The file's text, gunzipped when its first bytes are the gzip magic (whatever its name says)."""
    return _gunzipped(path.read_bytes()).decode("utf-8")


def _gunzipped(raw: bytes) -> bytes:
    """The bytes, gunzipped when they start with the gzip magic."""
    return gzip.decompress(raw) if raw.startswith(GZIP_MAGIC) else raw


def format_of(path: Path) -> str | None:
    """The format of a file in fastatoms' names: lammps-data, lammps-dump, vasp, extxyz or cif. The text decides
    before the name does (format_by_content, then format_by_name). A binary file (ASE's trajectory, for one) has no
    text to decide by, so its name does. None when neither says; the reader then refuses or hands it to ASE."""
    text = _text_if_text(path)
    return (format_by_content(text) if text is not None else None) or format_by_name(path)


def _text_if_text(path: Path) -> str | None:
    """The file's text, or None when it is binary: a NUL byte in its first kilobytes, or bytes that are not UTF-8."""
    raw = _gunzipped(path.read_bytes())
    if b"\x00" in raw[:BINARY_PROBE_BYTES]:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def format_by_content(text: str) -> str | None:
    """The format a file's text announces with a strong signature, or None when it announces none."""
    lines = text.splitlines()
    head = lines[:HEAD_LINES]
    if _first_nonblank(head) == "ITEM: TIMESTEP":
        return "lammps-dump"
    if any(_is_data_header(line) for line in head):
        return "lammps-data"
    if len(lines) >= 2 and "Lattice=" in lines[1]:
        return "extxyz"
    if _first_nonblank([line for line in head if not line.lstrip().startswith("#")]).startswith("data_"):
        return "cif"
    if _is_poscar(lines):
        return "vasp"
    return None


def format_by_name(path: Path) -> str | None:
    """The format a file name gives, when the text gave none. A `.gz` suffix is dropped in any case."""
    name = _unzipped_name(path)
    suffix = Path(name).suffix
    if suffix in _OTHER_FORMAT_BY_SUFFIX:
        return _OTHER_FORMAT_BY_SUFFIX[suffix]
    if suffix in _LAMMPS_DATA_SUFFIXES or name.startswith("data."):
        return "lammps-data"
    if suffix in _LAMMPS_DUMP_SUFFIXES or name.startswith("dump."):
        return "lammps-dump"
    if _is_vasp_name(path):
        return "vasp"
    return None


def is_number(token: str) -> bool:
    """Whether a token reads as a number in Python's float syntax."""
    try:
        float(token)
    except ValueError:
        return False
    return True


def _unzipped_name(path: Path) -> str:
    """The lower-case file name without a `.gz` suffix (any case): the name that gives the format."""
    return path.name.lower().removesuffix(".gz")


def _is_vasp_name(path: Path) -> bool:
    """POSCAR, CONTCAR or *.vasp by name (the text rule is _is_poscar)."""
    upper = path.name.upper()
    return Path(_unzipped_name(path)).suffix == ".vasp" or "POSCAR" in upper or "CONTCAR" in upper


def _first_nonblank(lines: list[str]) -> str:
    return next((line.strip() for line in lines if line.strip()), "")


def _is_data_header(line: str) -> bool:
    """A LAMMPS data file's header line: `N atoms`, `N atom types`, a box bound (`lo hi xlo xhi`) or a tilt or origin
    line. The keywords come last, so the words are checked from the end."""
    words = line.split("#", 1)[0].split()
    if len(words) == 2 and words[0].isdigit() and words[1] == "atoms":
        return True
    if len(words) == 3 and words[0].isdigit() and words[1:] == ["atom", "types"]:
        return True
    if words[-2:] in (["xlo", "xhi"], ["ylo", "yhi"], ["zlo", "zhi"], ["abc", "origin"]):
        return True
    return len(words) >= 3 and set(TILT_LABELS) <= set(words[-3:])


def _is_poscar(lines: list[str]) -> bool:
    """A POSCAR's layout: a scale factor on line 2, then three cell vectors of three numbers each (lines 3 to 5)."""
    if len(lines) < 7:
        return False
    scale = lines[1].split()
    if len(scale) != 1 or not is_number(scale[0]):
        return False
    return all(len(row) == 3 and all(is_number(x) for x in row) for row in (line.split() for line in lines[2:5]))
