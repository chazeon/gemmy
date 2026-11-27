"""The LAMMPS type map of a compile config (`types`): a key is a LAMMPS type number, written as a plain number from 1,
and its label names the element of that type. Compile side (pydantic)."""

from __future__ import annotations

import re
from typing import Annotated

from pydantic import Field

from .elements import element_of_label

# The largest type number: fastatoms keys its types as int32, so the reader cannot take a larger one. The TypeScript
# schema (web/src/compile/config-types.ts) uses the same bound.
MAX_TYPE = 2147483647


def names_an_element(label: str) -> str:
    """The label itself, when it names an element. element_of_label raises ValueError when it names none."""
    element_of_label(label)
    return label


# A LAMMPS type number (1, 2, ...). The keys are written as strings in TOML and JSON (`[types] 1 = "Fe1"`), and pydantic
# reads them as integers.
LammpsType = Annotated[int, Field(ge=1, le=MAX_TYPE)]
# A type key as written: a plain number from 1. pydantic would also read "+1", "01", "1.0" and "1_0" as integers, so
# the text is checked first.
TYPE_KEY = re.compile(r"[1-9][0-9]*")


def check_type_key(key: str) -> None:
    """Refuse a key of the `types` map that is not a plain number from 1 to MAX_TYPE, at the key."""
    if not TYPE_KEY.fullmatch(key):
        raise ValueError(
            f"types.{key}: a LAMMPS type is a plain number from 1 (`1`, `2`, ...): no sign, spaces, "
            "leading zero, decimal point or underscore."
        )
    if int(key) > MAX_TYPE:
        raise ValueError(f"types.{key}: a LAMMPS type is at most {MAX_TYPE}.")
