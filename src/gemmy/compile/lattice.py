"""Lattice geometry on numpy arrays: fractional/Cartesian offsets, snapping and wrapping with a tolerance,
display-box shifts and limits, and convex hulls. `cell` rows are lattice vectors. No Site type here."""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass
from typing import NamedTuple

import numpy as np
from scipy.spatial import ConvexHull

from ..scene import Vec3

Box = tuple[tuple[float, float], tuple[float, float], tuple[float, float]]
AXES = ("x", "y", "z")


class Offset(NamedTuple):
    """A position and fractional coordinates moved together (lattice.offset)."""

    position: Vec3
    fractional: Vec3


class Snapped(NamedTuple):
    """The snapped fractional coordinates and the Cartesian position they stand for (lattice.snap)."""

    fractional: Vec3
    position: Vec3


class CellBox(NamedTuple):
    """The display box's origin and its three edge vectors, all Cartesian (lattice.cell_box)."""

    origin: Vec3
    vectors: tuple[Vec3, Vec3, Vec3]


def _vec(v: np.ndarray) -> Vec3:
    return (float(v[0]), float(v[1]), float(v[2]))


def offset(position: Vec3, fractional: Vec3, shift: tuple[int, int, int], cell: np.ndarray) -> Offset:
    """Position and fractional coordinates translated by an integer lattice shift."""
    s = np.asarray(shift, dtype=float)
    return Offset(_vec(np.asarray(position, dtype=float) + s @ cell), _vec(np.asarray(fractional, dtype=float) + s))


def snap(fractional: Vec3, position: Vec3, cell: np.ndarray, eps: float) -> Snapped | None:
    """Pull coordinates within `eps` of an integer onto it (0.99999 -> 1.0). None when nothing moves."""
    frac = np.asarray(fractional, dtype=float)
    snapped = np.where(np.abs(frac - np.round(frac)) <= eps, np.round(frac), frac)
    if np.array_equal(snapped, frac):
        return None
    return Snapped(_vec(snapped), _vec(np.asarray(position, dtype=float) + (snapped - frac) @ cell))


def wrap_shift(fractional: Vec3, periodic: tuple[bool, bool, bool]) -> tuple[int, int, int]:
    """Integer shift that brings a site into [0, 1) on periodic axes."""
    shift = np.where(np.asarray(periodic, dtype=bool), -np.floor(np.asarray(fractional, dtype=float)), 0.0).astype(int)
    return (int(shift[0]), int(shift[1]), int(shift[2]))


def resolve_box(box: dict[str, tuple[float, float]]) -> Box:
    x, y, z = ((box[a] if a in box else (0.0, 1.0)) for a in AXES)
    return (tuple(x), tuple(y), tuple(z))  # type: ignore[return-value]


def cell_box(cell: np.ndarray, box: dict[str, tuple[float, float]]) -> CellBox:
    """Display box as origin + edge vectors (Cartesian) of the supercell `cell`."""
    ranges = resolve_box(box)
    origin = sum(ranges[k][0] * cell[k] for k in range(3))
    edges = [(ranges[k][1] - ranges[k][0]) * cell[k] for k in range(3)]
    return CellBox(_vec(origin), (_vec(edges[0]), _vec(edges[1]), _vec(edges[2])))


# The most images box_shifts makes along one axis for one site: a backstop, since config only checks that a range is
# finite. A box that wide is not a picture anyone reads, and the shifts of three such axes multiply out. The same value
# as MAX_IMAGES_PER_AXIS in web/src/compile/lattice.ts (tests/test_shared_constants.py checks they match).
MAX_IMAGES_PER_AXIS = 1000
# The most sites a display box makes in all, copies included. The same value as MAX_BOX_SITES in
# web/src/compile/lattice.ts (tests/test_shared_constants.py checks they match).
MAX_BOX_SITES = 200_000
# The largest whole number a shift may be (the safe integers of a float): past it, n + 1 == n and a shift loop never
# ends. The same bound as the TypeScript side's Number.MAX_SAFE_INTEGER.
MAX_SHIFT = 2**53 - 1


def _axis_range(
    axis: str, frac: float, lo: float, hi: float, eps: float, periodic: bool, explicit: bool
) -> tuple[int, int]:
    """The inclusive range [first, last] of shifts along one axis (empty when first > last)."""
    if not periodic:
        inside = lo - eps <= frac <= hi + eps
        return (0, 0) if (inside or not explicit) else (1, 0)
    first = math.ceil(lo - eps - frac)
    last = math.floor(hi + eps - frac)
    if abs(first) > MAX_SHIFT or abs(last) > MAX_SHIFT:
        raise ValueError(
            f"box range {axis} reaches past {MAX_SHIFT} images (the largest whole number the page counts); "
            f"narrow the box range {axis}."
        )
    return first, last


def _count(first_last: tuple[int, int]) -> int:
    first, last = first_last
    return max(last - first + 1, 0)


def _checked_ranges(
    fractional: Vec3, box: dict[str, tuple[float, float]], periodic: tuple[bool, bool, bool], eps: float
) -> list[tuple[int, int]]:
    """The shift range of each axis of one site. Refused, before any shift is listed, when an axis gives too many."""
    ranges = resolve_box(box)
    explicit = tuple(a in box for a in AXES)
    out = []
    for k in range(3):
        found = _axis_range(AXES[k], fractional[k], ranges[k][0], ranges[k][1], eps, periodic[k], explicit[k])
        count = _count(found)
        if periodic[k] and count > MAX_IMAGES_PER_AXIS:
            raise ValueError(
                f"box range {AXES[k]} gives {count} images along {AXES[k]} for one site (more than "
                f"MAX_IMAGES_PER_AXIS = {MAX_IMAGES_PER_AXIS}); narrow the box range {AXES[k]}."
            )
        out.append(found)
    return out


def box_image_count(
    fractional: Vec3, box: dict[str, tuple[float, float]], periodic: tuple[bool, bool, bool], eps: float
) -> int:
    """How many images the display box makes of one site, counted without listing any of them."""
    return math.prod(_count(found) for found in _checked_ranges(fractional, box, periodic, eps))


def check_box_sites(copies: int, atoms: int) -> None:
    """Refuse a display box that would make more sites than MAX_BOX_SITES, before any is made."""
    if copies > MAX_BOX_SITES:
        raise ValueError(
            f"the display box makes {copies} sites from {atoms} atoms (more than MAX_BOX_SITES = {MAX_BOX_SITES}); "
            "narrow the box range."
        )


def box_shifts(
    fractional: Vec3,
    box: dict[str, tuple[float, float]],
    periodic: tuple[bool, bool, bool],
    eps: float,
) -> list[tuple[int, ...]]:
    """Lattice shifts that place this site inside the display box (one per boundary copy), origin first."""
    found = _checked_ranges(fractional, box, periodic, eps)
    check_box_sites(math.prod(_count(r) for r in found), 1)
    per_axis = [range(first, last + 1) for first, last in found]
    return sorted(itertools.product(*per_axis), key=lambda n: (any(n), n))


def within_limits(point: Vec3, limits: dict[str, tuple[float, float]] | None) -> bool:
    """Is `point` inside the cartesian limits (all axes given; True when `limits` is empty)?"""
    if not limits:
        return True
    return all(not (lim := limits.get(axis)) or lim[0] <= point[k] <= lim[1] for k, axis in enumerate(AXES))


# A cloud is flat when every point lies within this fraction of its diameter of one line or one plane. Real POSCARs
# carry about 1e-8 relative rounding, so 1e-6 is far above that and far below any real non-planarity. The same value as
# FLAT_TOLERANCE in web/src/geom/flatness.ts (tests/test_shared_constants.py checks they match).
FLAT_TOLERANCE = 1e-6
# The fewest corners of a polygon: fewer points have no face. The same value as MIN_POLYGON_CORNERS in
# web/src/compile/hull.ts.
MIN_POLYGON_CORNERS = 3


@dataclass(frozen=True, slots=True)
class Line:
    """The points lie on one line: no polygon, no solid."""


@dataclass(frozen=True, slots=True)
class Space:
    """The points are not flat: they span a solid."""


@dataclass(frozen=True, slots=True)
class Plane:
    """The points lie in one plane. `normal` is its unit normal (largest component positive), `axis` a unit direction
    in the plane that fixes the frame of the polygon's corners, and `scale` the cloud's diameter."""

    normal: Vec3
    axis: Vec3
    scale: float


Shape = Line | Space | Plane


def convex_hull_faces(points: list[Vec3]) -> list[tuple[int, int, int]]:
    """Triangles of the convex hull, wound outwards. For points in one plane, the triangles of their polygon, wound
    along the plane normal (see `shape_of`). Empty for fewer than 3 points, or for points on a line (the caller
    warns)."""
    if len(points) < MIN_POLYGON_CORNERS:
        return []
    shape = shape_of(points)
    if isinstance(shape, Line):
        return []
    if isinstance(shape, Plane):
        return _planar_faces(points, shape)
    return _solid_hull_faces(points)


def is_planar(points: list[Vec3]) -> bool:
    """Do the points (three or more, not on a line) lie in one plane? Such a hull is a polygon, not a solid."""
    return len(points) >= MIN_POLYGON_CORNERS and isinstance(shape_of(points), Plane)


def shape_of(points: list[Vec3]) -> Shape:
    """Line, plane or space for a cloud of two or more points, in O(n^2). The scale is the diameter (the farthest pair;
    the first such pair in order on a tie). The cloud is a line when every point lies within the tolerance of the
    diameter's line. Otherwise the plane goes through the diameter and the point farthest from its line (the first such
    point on a tie), and the cloud is flat when every point lies within the tolerance of that plane. Same order of float
    operations as web/src/geom/flatness.ts, so both sides agree bit for bit. The answer does not depend on the order of
    the points: the plane's normal has a fixed sign (_plane_normal), and ties only change which equal point is used."""
    near, far = _diameter(points)
    line_axis = _sub(far, near)
    scale = _norm(line_axis)
    if scale == 0.0:
        return Line()
    apex = _farthest_from_line(points, near, line_axis, scale)
    if _distance_from_axis(apex, near, line_axis, scale) <= FLAT_TOLERANCE * scale:
        return Line()
    normal = _cross(line_axis, _sub(apex, near))
    length = _norm(normal)
    off_plane = max(abs(_dot(_sub(p, near), normal)) / length for p in points)
    if off_plane > FLAT_TOLERANCE * scale:
        return Space()
    return Plane(normal=_plane_normal(normal, length), axis=_frame_axis(points), scale=scale)


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a: Vec3) -> float:
    """math.sqrt of the dot product, not math.hypot, so the rounding matches web/src/geom/flatness.ts (Math.sqrt)."""
    return math.sqrt(_dot(a, a))


def _diameter(points: list[Vec3]) -> tuple[Vec3, Vec3]:
    """The two points farthest apart (the first such pair in order, on a tie)."""
    best = (points[0], points[1])
    best_length = _norm(_sub(points[1], points[0]))
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            length = _norm(_sub(points[j], points[i]))
            if length > best_length:
                best = (points[i], points[j])
                best_length = length
    return best


def _distance_from_axis(p: Vec3, origin: Vec3, axis: Vec3, scale: float) -> float:
    """The perpendicular distance of p from the line through origin along axis (whose length is scale)."""
    return _norm(_cross(_sub(p, origin), axis)) / scale


def _farthest_from_line(points: list[Vec3], origin: Vec3, axis: Vec3, scale: float) -> Vec3:
    """The point farthest from the line through origin along axis (the first such point on a tie)."""
    apex = points[0]
    apex_distance = _distance_from_axis(apex, origin, axis, scale)
    for p in points[1:]:
        distance = _distance_from_axis(p, origin, axis, scale)
        if distance > apex_distance:
            apex, apex_distance = p, distance
    return apex


def _frame_axis(points: list[Vec3]) -> Vec3:
    """The unit direction, in the plane, from points[0] towards the point farthest from it. Only the corners' frame
    depends on it, never whether the cloud is flat."""
    origin = points[0]
    far = origin
    for p in points:
        if _norm(_sub(p, origin)) > _norm(_sub(far, origin)):
            far = p
    offset = _sub(far, origin)
    length = _norm(offset)
    return (offset[0] / length, offset[1] / length, offset[2] / length)


def _plane_normal(normal: Vec3, length: float) -> Vec3:
    """The unit normal, flipped if needed so its largest component is positive: the same side whatever the order."""
    unit = (normal[0] / length, normal[1] / length, normal[2] / length)
    if unit[_largest_component(unit)] < 0:
        return (-unit[0], -unit[1], -unit[2])
    return unit


def _largest_component(v: Vec3) -> int:
    """The index of the component with the largest absolute value (the first of equal ones)."""
    largest = 0
    for k in (1, 2):
        if abs(v[k]) > abs(v[largest]):
            largest = k
    return largest


class _Row(NamedTuple):
    """A point of the cloud in the plane's frame: its coordinate along the axis (x), across it (y), and its index."""

    x: float
    y: float
    index: int


def _zero_area_limit(scale: float) -> float:
    """Twice-area below which three points count as collinear: the tolerance on the scale squared."""
    return FLAT_TOLERANCE * scale * scale


def _cross2(o: _Row, a: _Row, b: _Row) -> float:
    """Twice the signed area of the triangle o, a, b: positive when the turn a to b is counter-clockwise."""
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)


def _half_hull(rows: list[_Row], scale: float) -> list[_Row]:
    """One monotone chain: the rows whose turns all go one way. The lower chain takes the rows sorted by x, the upper
    chain the same rows reversed. A turn that is not clearly counter-clockwise (near-collinear points) drops its middle
    row, so such points are not corners."""
    chain: list[_Row] = []
    for row in rows:
        while len(chain) >= 2 and _cross2(chain[-2], chain[-1], row) <= _zero_area_limit(scale):
            chain.pop()
        chain.append(row)
    return chain


def _without_repeats(rows: list[_Row]) -> list[_Row]:
    """Rows at the same place keep one: the first in the sort, which has the lowest index."""
    return [row for n, row in enumerate(rows) if n == 0 or (row.x, row.y) != (rows[n - 1].x, rows[n - 1].y)]


def _planar_faces(points: list[Vec3], shape: Plane) -> list[tuple[int, int, int]]:
    """Fan triangles of the convex polygon of the points in their plane: a monotone chain on the rows, counter-clockwise
    seen from the normal, fanned from the lowest corner. Points on the boundary collinearly and interior points are not
    corners. A triangle of zero area is never emitted."""
    across = _cross(shape.normal, shape.axis)
    origin = points[0]
    rows = []
    for index, p in enumerate(points):
        offset = _sub(p, origin)
        rows.append(_Row(_dot(offset, shape.axis), _dot(offset, across), index))
    rows.sort()
    distinct = _without_repeats(rows)
    lower = _half_hull(distinct, shape.scale)
    upper = _half_hull(list(reversed(distinct)), shape.scale)
    corners = lower[:-1] + upper[:-1]
    if len(corners) < MIN_POLYGON_CORNERS:
        return []
    fan = [(corners[0], corners[k], corners[k + 1]) for k in range(1, len(corners) - 1)]
    return [(a.index, b.index, c.index) for a, b, c in fan if abs(_cross2(a, b, c)) > _zero_area_limit(shape.scale)]


def _solid_hull_faces(points: list[Vec3]) -> list[tuple[int, int, int]]:
    """Faces of a solid's hull (scipy), each wound so its normal points away from the centroid of the cloud."""
    arr = np.asarray(points, dtype=float)
    hull = ConvexHull(arr)
    centroid = arr.mean(axis=0)
    faces: list[tuple[int, int, int]] = []
    for simplex in hull.simplices:
        i, j, k = (int(simplex[0]), int(simplex[1]), int(simplex[2]))
        normal_3d = np.cross(arr[j] - arr[i], arr[k] - arr[i])
        face_centre = (arr[i] + arr[j] + arr[k]) / 3.0
        if np.dot(normal_3d, face_centre - centroid) < 0:
            faces.append((i, k, j))
        else:
            faces.append((i, j, k))
    return faces
