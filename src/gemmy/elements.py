"""The element a species label names: POSCAR species labels and the labels of a LAMMPS type map. Compile side (ASE)."""

from __future__ import annotations

import re

# `D` and `T` are hydrogen isotopes, so a label that starts with them names hydrogen.
ISOTOPE_ELEMENTS = {"D": "H", "T": "H"}


def element_of_label(label: str) -> str:
    """The element of a label, from its leading letters: `Fe1`, `Fe_pv`, `Fe/hash` and `O2-` all name their element.
    Two letters match an element first (`fe` -> Fe), else the first letter does (`Hx` -> H, `Xc` -> the X dummy).
    Raises ValueError when the label names no element."""
    from ase.data import chemical_symbols  # type: ignore

    head = re.match(r"[A-Za-z]*", label).group(0)
    if not 1 <= len(head) <= 2:
        raise ValueError(f"Cannot tell which element the label {label!r} names")
    if len(head) == 2 and head.capitalize() in chemical_symbols:
        return head.capitalize()
    first = head[0].upper()
    if first in ISOTOPE_ELEMENTS:
        return ISOTOPE_ELEMENTS[first]
    if first not in chemical_symbols:
        raise ValueError(f"Cannot tell which element the label {label!r} names")
    return first
