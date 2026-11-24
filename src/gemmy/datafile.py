"""Read a user-written data file: TOML (`.toml`) or JSON (anything else). Stdlib only."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path
from typing import Any


class DataFileError(ValueError):
    """The file is missing or does not parse; the message names the path."""


def read_data(path: str | Path) -> Any:
    p = Path(path)
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as exc:
        raise DataFileError(f"cannot read {p}: {exc.strerror or exc}") from exc
    if p.suffix.lower() == ".toml":
        try:
            return tomllib.loads(text)
        except tomllib.TOMLDecodeError as exc:
            raise DataFileError(f"{p} is not valid TOML: {exc}") from exc
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise DataFileError(f"{p} is not valid JSON: {exc}") from exc
