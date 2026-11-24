"""Lattice geometry on numpy arrays: fractional/Cartesian offsets, snapping and wrapping with a tolerance,
display-box shifts and limits, and convex hulls. `cell` rows are lattice vectors. No Site type here."""

from __future__ import annotations

import itertools
import math

import numpy as np
from scipy.spatial import ConvexHull

from ..scene import Vec3

Box = tuple[tuple[float, float], tuple[float, float], tuple[float, float]]
AXES = ("x", "y", "z")


def _vec(v: np.ndarray) -> Vec3:
    return (float(v[0]), float(v[1]), float(v[2]))


def offset(position: Vec3, fractional: Vec3, shift: tuple[int, int, int], cell: np.ndarray) -> tuple[Vec3, Vec3]:
    """Position and fractional coordinates translated by an integer lattice shift."""
    s = np.asarray(shift, dtype=float)
    return _vec(np.asarray(position, dtype=float) + s @ cell), _vec(np.asarray(fractional, dtype=float) + s)


def snap(fractional: Vec3, position: Vec3, cell: np.ndarray, eps: float) -> tuple[Vec3, Vec3] | None:
    """Pull coordinates within `eps` of an integer onto it (0.99999 -> 1.0). None when nothing moves."""
    frac = np.asarray(fractional, dtype=float)
    snapped = np.where(np.abs(frac - np.round(frac)) <= eps, np.round(frac), frac)
    if np.array_equal(snapped, frac):
        return None
    return _vec(snapped), _vec(np.asarray(position, dtype=float) + (snapped - frac) @ cell)


def wrap_shift(fractional: Vec3, periodic: tuple[bool, bool, bool]) -> tuple[int, int, int]:
    """Integer shift that brings a site into [0, 1) on periodic axes."""
    shift = np.where(np.asarray(periodic, dtype=bool), -np.floor(np.asarray(fractional, dtype=float)), 0.0).astype(int)
    return (int(shift[0]), int(shift[1]), int(shift[2]))


def resolve_box(box: dict[str, tuple[float, float]]) -> Box:
    x, y, z = ((box[a] if a in box else (0.0, 1.0)) for a in AXES)
    return (tuple(x), tuple(y), tuple(z))  # type: ignore[return-value]


def cell_box(cell: np.ndarray, box: dict[str, tuple[float, float]]) -> tuple[Vec3, tuple[Vec3, Vec3, Vec3]]:
    """Display box as origin + edge vectors (Cartesian) of the supercell `cell`."""
    ranges = resolve_box(box)
    origin = sum(ranges[k][0] * cell[k] for k in range(3))
    edges = [(ranges[k][1] - ranges[k][0]) * cell[k] for k in range(3)]
    return _vec(origin), (_vec(edges[0]), _vec(edges[1]), _vec(edges[2]))


def _axis_shifts(frac: float, lo: float, hi: float, eps: float, periodic: bool, explicit: bool) -> list[int]:
    if not periodic:
        inside = lo - eps <= frac <= hi + eps
        return [0] if (inside or not explicit) else []
    first = math.ceil(lo - eps - frac)
    last = math.floor(hi + eps - frac)
    return list(range(first, last + 1))


def box_shifts(
    fractional: Vec3,
    box: dict[str, tuple[float, float]],
    periodic: tuple[bool, bool, bool],
    eps: float,
) -> list[tuple[int, ...]]:
    """Lattice shifts that place this site inside the display box (one per boundary copy), origin first."""
    ranges = resolve_box(box)
    explicit = tuple(a in box for a in AXES)
    per_axis = [
        _axis_shifts(fractional[k], ranges[k][0], ranges[k][1], eps, periodic[k], explicit[k]) for k in range(3)
    ]
    return sorted(itertools.product(*per_axis), key=lambda n: (any(n), n))


def within_limits(point: Vec3, limits: dict[str, tuple[float, float]] | None) -> bool:
    """Is `point` inside the cartesian limits (all axes given; True when `limits` is empty)?"""
    if not limits:
        return True
    return all(not (lim := limits.get(axis)) or lim[0] <= point[k] <= lim[1] for k, axis in enumerate(AXES))


def convex_hull_faces(points: list[Vec3]) -> list[tuple[int, int, int]]:
    """Triangles of the convex hull, wound outwards. Empty for fewer than 4 points."""
    if len(points) < 4:
        return []
    arr = np.asarray(points, dtype=float)
    hull = ConvexHull(arr)
    centroid = arr.mean(axis=0)
    faces: list[tuple[int, int, int]] = []
    for simplex in hull.simplices:
        i, j, k = (int(simplex[0]), int(simplex[1]), int(simplex[2]))
        normal = np.cross(arr[j] - arr[i], arr[k] - arr[i])
        if np.dot(normal, (arr[i] + arr[j] + arr[k]) / 3.0 - centroid) < 0:
            faces.append((i, k, j))
        else:
            faces.append((i, j, k))
    return faces
