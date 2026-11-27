"""Displacement arrows. File IO lives in the caller; see load_displacement_file."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..datafile import DataFileError, read_data
from ..scene import Vec3
from .sites import Site

# A vector this short (in its own units) is no arrow.
ZERO_VECTOR_NORM = 1e-12


class DisplacementFileError(ValueError):
    """Displacement data file is missing or invalid; the message names the path."""


@dataclass(frozen=True, slots=True)
class ArrowSpec:
    site: Site
    vector: Vec3  # already scaled
    mode: str
    anchor: str = "tail"  # "tip": the arrow ends at the atom


def load_displacement_file(path: str | Path) -> dict[int, Vec3]:
    p = Path(path)
    try:
        payload = read_data(p)
    except DataFileError as exc:
        raise DisplacementFileError(f"displacement file: {exc}") from exc
    vectors = payload.get("vectors") if isinstance(payload, dict) else None
    if not isinstance(vectors, list):
        raise DisplacementFileError(f"displacement file {p} must be an object with a 'vectors' list")
    out: dict[int, Vec3] = {}
    for n, item in enumerate(vectors):
        try:
            out[int(item["index"])] = (float(item["dx"]), float(item["dy"]), float(item["dz"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise DisplacementFileError(f"displacement file {p}: vectors[{n}] needs numeric index, dx, dy, dz") from exc
    return out


def make_displacements(
    shown: list[Site],
    vectors: dict[int, Vec3],
    base_count: int,
    scale: float,
    style: str,
    inward_from: Vec3 | None = None,
) -> list[ArrowSpec]:
    """One arrow per site in `shown` that has a non-zero vector. The caller decides whether hidden atoms count.
    With `inward_from` (a polyhedron centre), arrows pointing towards it get anchor "tip"."""
    mode = str(style).lower()
    if mode not in {"arrow", "line"}:
        mode = "arrow"
    out: list[ArrowSpec] = []
    for site in shown:
        vec = vectors.get(site.index)
        if vec is None and base_count > 0:
            vec = vectors.get(site.index % base_count)
        if vec is None:
            continue
        arr = np.asarray(vec, dtype=float)
        if float(np.linalg.norm(arr)) <= ZERO_VECTOR_NORM:
            continue
        s = (arr * float(scale)).tolist()
        # Points into the polyhedron: draw it outside, head on the corner.
        points_inward = inward_from is not None and float(np.dot(arr, np.subtract(site.position, inward_from))) < 0.0
        anchor = "tip" if points_inward else "tail"
        out.append(ArrowSpec(site=site, vector=(float(s[0]), float(s[1]), float(s[2])), mode=mode, anchor=anchor))
    return out
