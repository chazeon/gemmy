"""compile/lattice.py: fractional/Cartesian round trip, wrap with tolerance, inclusive box, convex hull."""

from __future__ import annotations

import numpy as np
import pytest

from gemmy.compile.lattice import box_shifts, convex_hull_faces, offset, snap, wrap_shift

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
