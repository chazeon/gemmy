"""The species of a POSCAR and of an extended XYZ file, read from their text and shared by both reader backends.
A VASP 5 POSCAR names its species on a line of its own; a VASP 4 POSCAR names them in its comment line (R10), so
the comment is the species line. An extended XYZ atom's species column is its element and label (R11), over any Z
column."""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..elements import element_of_label

# The POSCAR line that names the species in VASP 5 (line 6, index 5). A VASP 4 file gets one inserted here, so a backend
# reads its species the same way.
SPECIES_LINE = 5


@dataclass(frozen=True)
class Poscar:
    """A POSCAR's lines, with the species line in place for a backend; its species labels as written, and each species'
    count. The species are empty for a file that names none (a VASP 4 file with no species in its comment)."""

    lines: list[str]
    species: list[str]
    counts: list[int]


def read_poscar(text: str, name: str) -> Poscar:
    """The POSCAR with its species named. Every label must name an element (R9, R10), and the error names it."""
    lines = text.splitlines()
    named = vasp5_species(lines)
    if named is not None:
        species, counts = named
    else:
        species, counts = _vasp4_species(lines, name)
        if species:
            lines = lines[:SPECIES_LINE] + [" ".join(species)] + lines[SPECIES_LINE:]
    for label in species:
        element_of_label(label)
    return Poscar(lines=lines, species=species, counts=counts)


def vasp5_species(lines: list[str]) -> tuple[list[str], list[int]] | None:
    """The species labels and counts of a VASP 5 POSCAR (lines 6 and 7), or None for a VASP 4 file."""
    if len(lines) < 7:
        return None
    species_tokens = _poscar_words(lines[5])
    count_tokens = _poscar_words(lines[6])
    if not species_tokens or not _is_int_tokens(count_tokens):
        return None
    if _is_int_tokens(species_tokens):
        return None
    counts = [int(x) for x in count_tokens]
    if len(species_tokens) != len(counts):
        return None
    return species_tokens, counts


def _vasp4_species(lines: list[str], name: str) -> tuple[list[str], list[int]]:
    """A VASP 4 file's labels, from its comment line, and its counts. Its counts line is where a VASP 5 file names its
    species, so the counts are read from SPECIES_LINE."""
    if len(lines) <= SPECIES_LINE:
        return [], []
    counts = _leading_ints(lines[SPECIES_LINE])
    labels = lines[0].split()
    if not counts or not labels:
        return [], []
    if len(labels) != len(counts):
        raise ValueError(f"{name}: its comment names {len(labels)} species, but its counts line has {len(counts)}")
    return labels, counts


def _leading_ints(line: str) -> list[int]:
    """The integers at the start of a line; a `!` comment or any other word ends them."""
    counts: list[int] = []
    for token in line.split():
        if not token.isdigit():
            break
        counts.append(int(token))
    return counts


def _poscar_words(line: str) -> list[str]:
    """The words of a POSCAR line, without a `!` comment (the counts line may carry one)."""
    return line.split("!", 1)[0].split()


def _is_int_tokens(tokens: list[str]) -> bool:
    if not tokens:
        return False
    try:
        [int(x) for x in tokens]
    except ValueError:
        return False
    return True


def extxyz_species(text: str) -> list[str] | None:
    """Each atom's species (its element label) from the `species` column of an extended XYZ, or None when the file's
    Properties name no species column."""
    lines = text.splitlines()
    if len(lines) < 2:
        return None
    properties = re.search(r"Properties=(\S+)", lines[1])
    if properties is None:
        return None
    column_at = _species_column(properties.group(1).split(":"))
    if column_at is None:
        return None
    count = int(lines[0])
    return [lines[2 + atom].split()[column_at] for atom in range(count)]


def _species_column(fields: list[str]) -> int | None:
    """The first column of the `species` property, from the Properties' name:type:width triplets."""
    first_column = 0
    for index in range(0, len(fields), 3):
        if fields[index] == "species":
            return first_column
        first_column += int(fields[index + 2])
    return None
