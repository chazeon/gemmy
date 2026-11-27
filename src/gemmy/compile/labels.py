"""Site labels: where they come from (sidecar file, labeler hook) and applying them to sites."""

from __future__ import annotations

import importlib.util
from dataclasses import replace
from pathlib import Path
from typing import Any

from ..datafile import DataFileError, read_data
from ..readers.record import Structure
from .sites import Site


class LabelError(ValueError):
    """Label file or labeler hook is missing or invalid; the message names the source."""


def _expand(spec: Any, source: str) -> list[int]:
    if isinstance(spec, int):
        return [spec]
    if isinstance(spec, str) and "-" in spec:
        lo, _, hi = spec.partition("-")
        try:
            return list(range(int(lo), int(hi) + 1))
        except ValueError:
            pass
    raise LabelError(f"{source}: cannot read index {spec!r}; use an int or a 'lo-hi' range")


def load_label_file(path: str | Path) -> dict[int, str]:
    """Read a JSON or TOML sidecar: `{"3": "H1"}` (index -> label) and/or `{"H1": [3, "5-7"]}` (label -> indices).

    An atom given two different labels is an error. The same label twice is fine.
    """
    p = Path(path)
    try:
        data = read_data(p)
    except DataFileError as exc:
        raise LabelError(f"label file: {exc}") from exc
    table = data.get("labels", data) if isinstance(data, dict) else None
    if not isinstance(table, dict):
        raise LabelError(f"label file {p} must contain an object (optionally under 'labels')")
    labels_given: dict[int, set[str]] = {}
    for key, value in table.items():
        if isinstance(value, str):
            if not key.isdigit():
                raise LabelError(f"label file {p}: key {key!r} must be an atom index when its value is a label")
            labels_given.setdefault(int(key), set()).add(value)
        elif isinstance(value, list):
            for item in value:
                for idx in _expand(item, str(p)):
                    labels_given.setdefault(idx, set()).add(key)
        else:
            raise LabelError(f"label file {p}: entry {key!r} must be a label or a list of indices")
    return _single_labels(p, labels_given)


def _single_labels(source: Path, labels_given: dict[int, set[str]]) -> dict[int, str]:
    """One label per atom. An atom given two different labels is an error; the message names the lowest such atom
    and its two labels in sorted order."""
    out: dict[int, str] = {}
    for idx in sorted(labels_given):
        names = sorted(labels_given[idx])
        if len(names) > 1:
            first, second = names[:2]
            raise LabelError(f"label file {source}: atom {idx} is given two labels, {first!r} and {second!r}")
        out[idx] = names[0]
    return out


def run_labeler(spec: str, structure: Structure, base_dir: str | Path | None = None) -> dict[int, str]:
    """Call `path/to/file.py:func(structure)`; it returns dict[int, str] or one label per atom."""
    path_text, _, func_name = spec.rpartition(":")
    if not path_text or not func_name:
        raise LabelError(f"labeler must look like 'path/to/file.py:func', got {spec!r}")
    path = Path(path_text)
    if not path.is_absolute() and base_dir is not None:
        path = Path(base_dir) / path
    module_spec = importlib.util.spec_from_file_location("gemmy_labeler", path)
    if module_spec is None or module_spec.loader is None or not path.is_file():
        raise LabelError(f"cannot load labeler file {path}")
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    func = getattr(module, func_name, None)
    if not callable(func):
        raise LabelError(f"labeler file {path} has no function {func_name!r}")
    result = func(structure)
    if isinstance(result, dict):
        return {int(k): str(v) for k, v in result.items()}
    if isinstance(result, (list, tuple)):
        if len(result) != len(structure.atoms):
            raise LabelError(f"labeler {spec} returned {len(result)} labels for {len(structure.atoms)} atoms")
        return {i: str(v) for i, v in enumerate(result)}
    raise LabelError(f"labeler {spec} must return a dict or a list, got {type(result).__name__}")


def apply_labels(sites: list[Site], labels: dict[int, str], base_count: int) -> list[Site]:
    """Override site labels. Keys are source-structure indices (pre-supercell)."""
    if not labels or base_count <= 0:
        return sites
    return [replace(s, label=labels[s.index % base_count]) if (s.index % base_count) in labels else s for s in sites]
