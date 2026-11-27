"""Flat clouds: whether a cloud is a line, a plane or a solid does not depend on the order of its points. The polygon
drawn from a flat cloud has no zero-area triangle, no duplicate corner and no near-collinear corner. Checked in Python,
and in the TypeScript that the compiler (web/src/compile/hull.ts) and the viewer (web/src/render/instancing.ts) run."""

from __future__ import annotations

import itertools
import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from gemmy.compile.lattice import Plane, Space, convex_hull_faces, is_planar, shape_of
from ts_bundle import available as node_available
from ts_bundle import run
from viewer_bundle import available as viewer_available
from viewer_bundle import header

# A quad within d of z = 0, with d = 2e-7: its plane (through the triangle of largest area) is 0.36 of the tolerance
# (1e-6 times the diameter, about 2.2) from every point, so it is flat in every order of its points.
D = 2e-7
TILTED_QUAD = [(0.0, 0.0, D), (2.0, 0.0, -D), (0.0, 1.0, -D), (2.0, 1.0, D)]
# The same quad with d = 7.5e-7: the triangle's plane is 1.34 tolerances from a point, so it is solid in every order.
TILTED_QUAD_SOLID = [(0.0, 0.0, 7.5e-7), (2.0, 0.0, -7.5e-7), (0.0, 1.0, -7.5e-7), (2.0, 1.0, 7.5e-7)]
# A planar rectangle, tilted, whose point 2 lies on the segment from 1 to 3: it is not a corner. Projection roundoff
# used to make it one, and the face (3, 2, 1) came out with no area.
TILTED_RECTANGLE = [(2.0, 5.0, 5.0), (0.0, 0.0, 0.0), (1.0, 2.0, 3.0), (2.0, 4.0, 6.0), (0.0, 1.0, -1.0)]
# A square whose corner is repeated at index 4: the representative is the lowest index, 0.
DUPLICATE_CORNER = [(0.0, 0.0, 0.0), (2.0, 0.0, 0.0), (2.0, 1.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 0.0)]
# A convex pentagon: its fan has three triangles, and five boundary edges.
PENTAGON = [(0.0, 0.0, 0.0), (2.0, 0.0, 0.0), (2.5, 1.0, 0.0), (1.0, 2.0, 0.0), (-0.5, 1.0, 0.0)]
# The Codex example of a two-sided polygon: the point at y = -1e-8 lies on the bottom edge to within tolerance.
ROUNDED = [(0.0, 0.0, 0.0), (2.0, 0.0, 0.0), (0.0, 1.0, 0.0), (2.0, 1.0, 0.0), (1.0, -1e-8, 1e-6)]
# Points on a line, one of them 1e-7 off it: within 1e-6 of the diameter, so a line.
NEARLY_LINE = [(0.0, 0.0, 0.0), (2.0, 0.0, 0.0), (1.0, 1e-7, 0.0)]

CLOUDS = {
    "tilted-quad": TILTED_QUAD,
    "tilted-quad-solid": TILTED_QUAD_SOLID,
    "tilted-rectangle": TILTED_RECTANGLE,
    "duplicate-corner": DUPLICATE_CORNER,
    "pentagon": PENTAGON,
    "rounded": ROUNDED,
    "nearly-line": NEARLY_LINE,
}


def _shuffled(points: list[tuple[float, float, float]], order: tuple[int, ...]) -> list[tuple[float, float, float]]:
    return [points[i] for i in order]


def _orders(n: int) -> list[tuple[int, ...]]:
    """Every order of the points when there are few, else the identity, the reverse and two rotations."""
    if n <= 5:
        return list(itertools.permutations(range(n)))
    return [tuple(range(n)), tuple(reversed(range(n))), tuple(range(1, n)) + (0,), tuple(range(2, n)) + (0, 1)]


def _area(a: tuple[float, ...], b: tuple[float, ...], c: tuple[float, ...]) -> float:
    u = [b[k] - a[k] for k in range(3)]
    v = [c[k] - a[k] for k in range(3)]
    return (u[1] * v[2] - u[2] * v[1]) ** 2 + (u[2] * v[0] - u[0] * v[2]) ** 2 + (u[0] * v[1] - u[1] * v[0]) ** 2


def test_the_tilted_quad_is_a_plane_in_every_order() -> None:
    for order in _orders(4):
        points = _shuffled(TILTED_QUAD, order)
        assert isinstance(shape_of(points), Plane), order
        assert is_planar(points), order
        assert len(convex_hull_faces(points)) == 2, order


def test_a_quad_past_the_tolerance_is_solid_in_every_order() -> None:
    for order in _orders(4):
        points = _shuffled(TILTED_QUAD_SOLID, order)
        assert shape_of(points) == Space(), order
        assert not is_planar(points), order


def test_a_collinear_point_on_the_boundary_is_not_a_corner() -> None:
    faces = convex_hull_faces(TILTED_RECTANGLE)
    assert len(faces) == 2
    assert 2 not in {i for face in faces for i in face}
    assert all(_area(*(TILTED_RECTANGLE[i] for i in face)) > 0 for face in faces)


def test_an_exact_duplicate_keeps_the_lowest_index() -> None:
    faces = convex_hull_faces(DUPLICATE_CORNER)
    assert len(faces) == 2
    assert 4 not in {i for face in faces for i in face}
    assert 0 in {i for face in faces for i in face}


def test_a_convex_pentagon_gives_three_triangles() -> None:
    assert len(convex_hull_faces(PENTAGON)) == 3


def test_a_nearly_straight_cloud_is_a_line() -> None:
    assert convex_hull_faces(NEARLY_LINE) == []
    assert not is_planar(NEARLY_LINE)


def test_no_face_has_zero_area_in_any_order() -> None:
    for name, points in CLOUDS.items():
        for order in _orders(len(points)):
            cloud = _shuffled(points, order)
            for face in convex_hull_faces(cloud):
                assert _area(*(cloud[i] for i in face)) > 0, (name, order, face)


def _parity_jobs() -> list[dict[str, Any]]:
    jobs = []
    for name, points in CLOUDS.items():
        for order in _orders(len(points)):
            cloud = [list(map(float, p)) for p in _shuffled(points, order)]
            if (
                name != "tilted-quad-solid"
            ):  # a solid's hull is triangulated by Qhull and scipy, so only its verdict is compared
                jobs.append({"fn": "convexHullFaces", "args": [cloud], "name": name, "order": order})
            jobs.append({"fn": "isPlanar", "args": [cloud], "name": name, "order": order})
    return jobs


@pytest.mark.skipif(not node_available(), reason="node or web/node_modules is missing (cd web && npm ci)")
def test_hull_and_planarity_match_python_in_every_order() -> None:
    jobs = _parity_jobs()
    results = run([{"fn": job["fn"], "args": job["args"]} for job in jobs])
    for job, result in zip(jobs, results, strict=True):
        points = _shuffled(CLOUDS[job["name"]], job["order"])
        assert "ok" in result, (job["name"], result)
        if job["fn"] == "isPlanar":
            assert result["ok"] == is_planar(points), (job["name"], job["order"])
        else:
            assert [tuple(f) for f in result["ok"]] == convex_hull_faces(points), (job["name"], job["order"])


def _two_sided_scene(points: list[tuple[float, float, float]]) -> dict[str, Any]:
    """The compiled topology of a flat polygon: its fan, and each triangle again reversed (compile/polyhedra.py)."""
    faces = convex_hull_faces(points)
    two_sided = faces + [(i, k, j) for i, j, k in faces]
    ids = [f"p{n}" for n in range(len(points))]
    return {
        "points": [{"id": pid, "position": list(map(float, p))} for pid, p in zip(ids, points, strict=True)],
        "topologies": [{"id": "t", "point_ids": ids, "faces": [list(f) for f in two_sided]}],
        "primitives": {"polyhedra": [{"id": "poly", "topology_id": "t", "material_id": "m"}]},
    }


def _viewer_polygon(points: list[tuple[float, float, float]], tmp_path: Path) -> dict[str, Any]:
    script = tmp_path / "polygon.mjs"
    body = (
        f"const data = {json.dumps(_two_sided_scene(points))};\n"
        "const groups = polyhedronGroups(data);\n"
        "const points = new Map(data.points.map((p) => [p.id, p.position]));\n"
        "const edges = hardEdges(data.topologies[0], points);\n"
        "console.log(JSON.stringify({ positions: groups[0].positions, edges }));\n"
    )
    script.write_text(header() + "\n" + body, encoding="utf-8")
    result = subprocess.run(["node", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _normal_signs(positions: list[float]) -> list[int]:
    """The sign of the z component of each drawn triangle's normal (its vertices come nine numbers at a time)."""
    signs = []
    for t in range(0, len(positions), 9):
        a, b, c = (positions[t + 3 * v : t + 3 * v + 3] for v in range(3))
        cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        signs.append(1 if cz > 0 else -1)
    return signs


@pytest.mark.skipif(not viewer_available(), reason="node or web/node_modules is missing (cd web && npm ci)")
@pytest.mark.parametrize(
    ("points", "boundary_edges"),
    [(PENTAGON, 5), (ROUNDED, 4)],
    ids=["pentagon", "rounded"],
)
def test_viewer_keeps_both_sides_of_a_two_sided_polygon(
    points: list[tuple[float, float, float]], boundary_edges: int, tmp_path: Path
) -> None:
    out = _viewer_polygon(points, tmp_path)
    faces = len(convex_hull_faces(points))
    signs = _normal_signs(out["positions"])
    assert len(signs) == 2 * faces
    assert signs.count(1) == signs.count(-1) == faces, (
        "both sides of the polygon are drawn, each as the compiler wound it"
    )
    assert len(out["edges"]) == boundary_edges, "the fan's diagonals are not hard edges"
