"""LAMMPS data files, read by both reader backends. The backends give positions, cells and type numbers; this module
gives what they do not: the normalised text they read, a data file's type labels and Masses, and the lower bounds of a
restricted box (R1, R7, R13). Nothing here imports ASE or numpy."""

from __future__ import annotations

from dataclasses import dataclass, field

from .formats import TILT_LABELS, is_number
from .typemap import Identity

# The section names a data file has, besides the `... Coeffs` and `... Labels` ones (see _is_section_header).
NAMED_SECTIONS = frozenset(
    {"Atoms", "Velocities", "Masses", "Charges", "Ellipsoids", "Lines", "Triangles", "Bodies", "Bonds", "Angles"}
    | {"Dihedrals", "Impropers"}
)
SECTION_SUFFIXES = ("Coeffs", "Labels")
AXES = "xyz"
# The column of an Atoms row that holds its type, by atom_style: after the id, or after the id and the molecule id.
TYPE_AFTER_ID = 1
TYPE_AFTER_MOLECULE_ID = 2
TYPE_COLUMN_BY_STYLE = {
    "atomic": TYPE_AFTER_ID,
    "charge": TYPE_AFTER_ID,
    "full": TYPE_AFTER_MOLECULE_ID,
    "molecular": TYPE_AFTER_MOLECULE_ID,
    "bond": TYPE_AFTER_MOLECULE_ID,
    "angle": TYPE_AFTER_MOLECULE_ID,
}
# The field counts ASE guesses an unnamed style from: an optional trailing field (image flags) adds 3 to each.
ATOMIC_FIELD_COUNTS = (5, 8)
FULL_FIELD_COUNTS = (7, 10)


@dataclass
class _Section:
    name: str
    style: str
    rows: list[tuple[list[str], str]] = field(default_factory=list)


def normalised_data(text: str) -> str:
    """The data file text both backends read. Each type label of the `Atom Type Labels` section is written as its number
    in the Atoms and Masses sections (R7), and a restricted box's tilt values are put in xy xz yz order, each read by
    its label (R1), since the backends read the tilts by position."""
    numbers = {label: number for number, label in _type_labels(_sections(text)).items()}
    out: list[str] = []
    section_name, section_style = "", ""
    for line in text.splitlines():
        words, comment = _words(line)
        if not words:
            out.append(line)
        elif _is_section_header(words):
            section_name, section_style = " ".join(words), comment
            out.append(line)
        else:
            new_words = _normalised_row(section_name, section_style, words, numbers)
            out.append(line if new_words == words else _line(new_words, comment))
    return "\n".join(out) + "\n"


def data_identities(numeric_text: str) -> dict[int, Identity]:
    """Each type's identity from a data file (read with `normalised_data`): its type label, and its Masses value and
    comment (R13)."""
    sections = _sections(numeric_text)
    labels = _type_labels(sections)
    masses = {
        _type_number(words[0]): (float(words[1]), comment or None) for words, comment in _rows(sections, "Masses")
    }
    identities: dict[int, Identity] = {}
    for number in sorted(set(labels) | set(masses)):
        mass, comment = masses.get(number, (None, None))
        identities[number] = Identity(label=labels.get(number), comment=comment, mass=mass)
    return identities


def restricted_lower_bounds(text: str) -> tuple[float, float, float]:
    """The lower bounds (xlo, ylo, zlo) of a restricted box, the origin positions are measured from. A general triclinic
    box has no `lo hi` lines: its origin is its `abc origin`, which ASE gives as the cell's displacement."""
    bounds: dict[str, float] = {}
    for words, _ in _sections(text)[0].rows:
        for axis in AXES:
            if words[2:] == [f"{axis}lo", f"{axis}hi"]:
                bounds[axis] = float(words[0])
    return tuple(bounds.get(axis, 0.0) for axis in AXES)


def _normalised_row(section: str, style: str, words: list[str], numbers: dict[str, int]) -> list[str]:
    """One row of a data file, with its type label (if it has one) written as its number."""
    if section == "" and _is_tilt_line(words):
        return _tilts_in_order(words)
    if section == "Atoms" and numbers:
        return _with_type_number(words, _atom_type_column(style, len(words)), numbers)
    if section == "Masses" and numbers:
        return _with_type_number(words, 0, numbers)
    return words


def _with_type_number(words: list[str], column: int, numbers: dict[str, int]) -> list[str]:
    if column < len(words) and words[column] in numbers:
        return words[:column] + [str(numbers[words[column]])] + words[column + 1 :]
    return words


def _sections(text: str) -> list[_Section]:
    """The sections of a data file: the header (named ""), then each section by name. Line 1 is the title."""
    sections = [_Section(name="", style="")]
    for line in text.splitlines()[1:]:
        words, comment = _words(line)
        if not words:
            continue
        if _is_section_header(words):
            sections.append(_Section(name=" ".join(words), style=comment))
        else:
            sections[-1].rows.append((words, comment))
    return sections


def _is_tilt_line(words: list[str]) -> bool:
    """A header tilt line: three values, then the three tilt labels in any order."""
    return len(words) == 6 and sorted(words[3:]) == sorted(TILT_LABELS)


def _tilts_in_order(words: list[str]) -> list[str]:
    value_of = dict(zip(words[3:], words[:3], strict=True))
    return [value_of[label] for label in TILT_LABELS] + list(TILT_LABELS)


def _is_section_header(words: list[str]) -> bool:
    """A section line names its section: a known name, or a `... Coeffs` or `... Labels` name. Its first word is no
    number, so a data row (which starts with its id or type) is never a header."""
    if is_number(words[0]):
        return False
    return " ".join(words) in NAMED_SECTIONS or words[-1] in SECTION_SUFFIXES


def _type_labels(sections: list[_Section]) -> dict[int, str]:
    """The type number of each label in the `Atom Type Labels` section."""
    return {int(words[0]): words[1] for words, _ in _rows(sections, "Atom Type Labels") if len(words) >= 2}


def _type_number(token: str) -> int:
    if not token.isdigit():
        raise ValueError(f"the Masses section names type {token!r}, which is neither a type number nor a type label")
    return int(token)


def _rows(sections: list[_Section], name: str) -> list[tuple[list[str], str]]:
    return [row for section in sections if section.name == name for row in section.rows]


def _atom_type_column(style: str, field_count: int) -> int:
    """The column of an Atoms row that holds its type: from the atom_style named after `Atoms`, else from the field
    count, as ASE guesses the layout."""
    if style in TYPE_COLUMN_BY_STYLE:
        return TYPE_COLUMN_BY_STYLE[style]
    if field_count in ATOMIC_FIELD_COUNTS:
        return TYPE_AFTER_ID
    if field_count in FULL_FIELD_COUNTS:
        return TYPE_AFTER_MOLECULE_ID
    raise ValueError(
        f"cannot tell the Atoms layout of a row with {field_count} fields; name its atom_style after `Atoms`"
    )


def _words(line: str) -> tuple[list[str], str]:
    body, _, comment = line.partition("#")
    return body.split(), comment.strip()


def _line(words: list[str], comment: str) -> str:
    return " ".join(words) + (f"  # {comment}" if comment else "")
