"""compile/lattice.py: fractional/Cartesian round trip, wrap with tolerance, inclusive box, convex hull."""

from __future__ import annotations

import numpy as np
import pytest

from gemmy.compile.lattice import (
    MAX_BOX_SITES,
    box_image_count,
    box_shifts,
    convex_hull_faces,
    offset,
    snap,
    wrap_shift,
)

CELL = np.array([[4.0, 0.0, 0.0], [1.0, 5.0, 0.0], [0.5, 0.25, 6.0]])  # triclinic, rows are vectors


def test_frac_cart_round_trip() -> None:
    frac = (0.2, 0.7, 0.45)
    position = tuple(float(x) for x in np.asarray(frac) @ CELL)
    moved_pos, moved_frac = offset(position, frac, (1, -2, 3), CELL)
    assert moved_frac == pytest.approx((1.2, -1.3, 3.45))
    assert moved_pos == pytest.approx(tuple(np.asarray(moved_frac) @ CELL))
    back = np.linalg.solve(CELL.T, np.asarray(moved_pos))  # Cartesian -> fractional
    assert tuple(back) == pytest.approx(moved_frac)


def test_wrap_with_eps_sends_099999_to_zero() -> None:
    frac = (0.99999, 0.5, -0.00001)
    position = tuple(float(x) for x in np.asarray(frac) @ CELL)
    snapped = snap(frac, position, CELL, eps=1e-4)
    assert snapped is not None
    snapped_frac, snapped_pos = snapped
    assert snapped_frac == (1.0, 0.5, 0.0) or snapped_frac == (1.0, 0.5, -0.0)
    assert snapped_pos == pytest.approx(tuple(np.asarray(snapped_frac) @ CELL))
    assert wrap_shift(snapped_frac, (True, True, True)) == (-1, 0, 0)
    assert tuple(f + s for f, s in zip(snapped_frac, wrap_shift(snapped_frac, (True, True, True)), strict=True)) == (
        0.0,
        0.5,
        0.0,
    )
    assert snap((0.3, 0.5, 0.7), (0.0, 0.0, 0.0), CELL, eps=1e-4) is None  # nothing near an integer
    assert snap(frac, position, CELL, eps=1e-8) is None  # tolerance too small to move 0.99999
    assert wrap_shift((1.3, -0.2, 0.5), (True, False, True)) == (-1, 0, 0)  # non-periodic axis never shifts


def test_box_membership_is_inclusive_with_eps() -> None:
    box = {"x": (0.0, 1.0)}
    periodic = (False, False, False)
    assert box_shifts((1.0, 0.5, 0.5), box, periodic, 1e-6) == [(0, 0, 0)]  # exactly on the upper face
    assert box_shifts((0.0, 0.5, 0.5), box, periodic, 1e-6) == [(0, 0, 0)]
    assert box_shifts((1.0000005, 0.5, 0.5), box, periodic, 1e-6) == [(0, 0, 0)]  # within eps
    assert box_shifts((1.01, 0.5, 0.5), box, periodic, 1e-6) == []  # outside an explicit axis
    # periodic: a site on the boundary appears on both faces
    assert box_shifts((0.0, 0.5, 0.5), box, (True, False, False), 1e-6) == [(0, 0, 0), (1, 0, 0)]
    assert box_shifts((0.99999999, 0.5, 0.5), box, (True, False, False), 1e-6) == [(0, 0, 0), (-1, 0, 0)]


def test_convex_hull_of_an_octahedron() -> None:
    points = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1), (0, 0, 0)]  # centre is interior
    faces = convex_hull_faces([tuple(float(c) for c in p) for p in points])
    assert len(faces) == 8
    assert set().union(*map(set, faces)) == {0, 1, 2, 3, 4, 5}  # the interior point is not on the hull
    arr = np.asarray(points, dtype=float)
    for i, j, k in faces:
        normal = np.cross(arr[j] - arr[i], arr[k] - arr[i])
        assert np.dot(normal, arr[[i, j, k]].mean(axis=0)) > 0  # wound outwards
    assert convex_hull_faces([(0.0, 0.0, 0.0)] * 3) == []


def test_square_is_two_triangles_wound_along_the_normal() -> None:
    square = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.0, 0.0), (0.0, 1.0, 0.0)]
    faces = convex_hull_faces(square)
    assert len(faces) == 2
    assert set().union(*map(set, faces)) == {0, 1, 2, 3}
    for i, j, k in faces:  # counter-clockwise seen from +z: the normal is along +z (largest component positive)
        assert np.cross(np.subtract(square[j], square[i]), np.subtract(square[k], square[i]))[2] > 0


def test_interior_coplanar_point_is_not_a_corner() -> None:
    points = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.0, 0.0), (0.0, 1.0, 0.0), (0.3, 0.2, 0.0)]
    faces = convex_hull_faces(points)
    assert len(faces) == 2
    assert 4 not in set().union(*map(set, faces))


def test_flat_polygon_normal_has_largest_component_positive() -> None:
    # a plane y = 3 whose normal is -y: the largest component of the normal is the y one, so it must come out +y
    ring = [(2.0, 3.0, 0.0), (0.0, 3.0, 2.0), (-2.0, 3.0, 0.0), (0.0, 3.0, -2.0)]
    faces = convex_hull_faces(ring)
    assert len(faces) == 2
    for i, j, k in faces:
        assert np.cross(np.subtract(ring[j], ring[i]), np.subtract(ring[k], ring[i]))[1] > 0


def test_collinear_and_coincident_points_give_no_faces() -> None:
    assert convex_hull_faces([(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (2.0, 0.0, 0.0)]) == []
    assert convex_hull_faces([(1.0, 1.0, 1.0)] * 4) == []
    assert convex_hull_faces([(0.0, 0.0, 0.0), (1.0, 0.0, 0.0)]) == []


def test_three_points_make_one_triangle() -> None:
    assert convex_hull_faces([(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]) == [(0, 1, 2)]


def test_a_box_of_a_thousand_on_each_axis_is_refused_before_any_shift_is_listed() -> None:
    """Each axis gives 1000 images (within MAX_IMAGES_PER_AXIS), but the three together make 1e9: refused by count."""
    box = {"x": (0.0, 1000.0), "y": (0.0, 1000.0), "z": (0.0, 1000.0)}
    assert box_image_count((0.5, 0.5, 0.5), box, (True, True, True), 1e-6) == 1000**3
    with pytest.raises(ValueError, match="MAX_BOX_SITES"):
        box_shifts((0.5, 0.5, 0.5), box, (True, True, True), 1e-6)


@pytest.mark.parametrize("bound", [1e16, 2.0**53])
def test_a_range_past_the_safe_integers_is_refused(bound: float) -> None:
    """Past 2**53 the shift loop stalls (n + 1 == n); the same range is refused on the viewer side."""
    with pytest.raises(ValueError, match="past"):
        box_shifts((0.5, 0.5, 0.5), {"x": (bound, bound)}, (True, False, False), 1e-6)
    with pytest.raises(ValueError, match="past"):
        box_shifts((0.5, 0.5, 0.5), {"x": (0.0, bound)}, (True, False, False), 1e-6)


def test_a_normal_box_still_gives_its_copies() -> None:
    box = {"x": (0.0, 2.0), "y": (0.0, 1.0), "z": (0.0, 1.0)}
    assert box_shifts((0.5, 0.5, 0.5), box, (True, True, True), 1e-6) == [(0, 0, 0), (1, 0, 0)]
    assert MAX_BOX_SITES == 200_000
