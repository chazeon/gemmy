"""The viewer draws from instance matrices and merged triangle lists built by pure JS; run that block in node.

The block between the `==== Instancing` markers (with the constants and the SVG helpers it uses) turns a scene into
matrix lists per (shape, material) and a triangle soup per polyhedron material; here the matrices are checked to put
the unit shapes where the bond, dash and arrow geometry says, and the face -> polyhedron map to be exact.
"""

from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from gemmy.view import render_viewer

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")

TOPOLOGY = {
    "id": "t",
    "point_ids": ["c", "x", "y", "z", "w"],
    "faces": [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [1, 2, 3], [1, 3, 4]],
}
SCENE = {
    "source_comment": "instancing fixture",
    "materials": {"m": {"base_color": [1, 0, 0, 1]}, "n": {"base_color": [0, 0, 1, 0.4]}},
    "points": [
        {"id": "a", "element": "O", "position": [0, 0, 0]},
        {"id": "b", "element": "H", "position": [0, 0, 1.0]},
        {"id": "far", "element": "H", "position": [0, 3.0, 0]},
        {"id": "c", "element": "Si", "position": [0, 0, 0]},
        {"id": "x", "element": "O", "position": [1, 0, 0]},
        {"id": "y", "element": "O", "position": [0, 1, 0]},
        {"id": "z", "element": "O", "position": [-1, 0, 0]},
        {"id": "w", "element": "O", "position": [0, 0, 1]},
        {"id": "d", "element": "Si", "position": [5, 0, 0]},
        {"id": "dx", "element": "O", "position": [6, 0, 0]},
        {"id": "dy", "element": "O", "position": [5, 1, 0]},
        {"id": "dz", "element": "O", "position": [4, 0, 0]},
        {"id": "dw", "element": "O", "position": [5, 0, 1]},
    ],
    "topologies": [TOPOLOGY, {**TOPOLOGY, "id": "u", "point_ids": ["d", "dx", "dy", "dz", "dw"]}],
    "primitives": {
        "atoms": [
            {"id": "a0", "point_id": "a", "radius": 0.5, "material_id": "m", "element": "O"},
            {"id": "a1", "point_id": "b", "radius": 0.2, "material_id": "m", "element": "H"},
        ],
        "bonds": [
            {"id": "b0", "a_point_id": "a", "b_point_id": "b", "radius": 0.1, "material_id": "m"},
            {"id": "b1", "a_point_id": "a", "b_point_id": "far", "radius": 0.05, "material_id": "m", "style": "dashed"},
            {"id": "b2", "a_point_id": "a", "b_point_id": "far", "radius": 0.05, "material_id": "m", "style": "dotted"},
        ],
        "displacements": [{"id": "d0", "start_point_id": "a", "vector": [0, -1, 0], "anchor": "tail"}],
        "polyhedra": [
            {"id": "p0", "topology_id": "t", "center_point_id": "c", "ligand_point_ids": ["x"], "material_id": "m"},
            {"id": "p1", "topology_id": "u", "center_point_id": "d", "ligand_point_ids": ["dx"], "material_id": "n"},
            {"id": "p2", "topology_id": "t", "center_point_id": "c", "ligand_point_ids": ["x"], "material_id": "m"},
        ],
    },
}


MINIMAL = {  # any valid scene gives the page; the block under test is run on SCENE
    "source_comment": "tiny",
    "materials": {"m": {"base_color": [1, 0, 0, 1]}},
    "points": [{"id": "p0", "element": "O", "position": [0, 0, 0]}],
    "primitives": {"atoms": [{"id": "a0", "point_id": "p0", "radius": 1.0, "material_id": "m", "element": "O"}]},
}


def _run(body: str, tmp_path: Path) -> dict:
    page = render_viewer(MINIMAL, "t")
    block = re.search(r"// Same as gemmy's 3to2d look.*?// ==== end of instancing ====", page, re.S)
    assert block
    script = tmp_path / "instancing.mjs"
    script.write_text(block.group(0) + f"\nconst data = {json.dumps(SCENE)};\n" + body, encoding="utf-8")
    result = subprocess.run(["node", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _apply(m: list[float], p: tuple[float, float, float]) -> list[float]:  # column-major 4x4 times a point
    return [m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i] for i in range(3)]


def test_along_matrix_puts_the_unit_cylinder_between_the_ends(tmp_path: Path) -> None:
    dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, -1], [0.6, 0.0, 0.8], [-0.3, -0.5, math.sqrt(1 - 0.34)]]
    out = _run(
        f"console.log(JSON.stringify({json.dumps(dirs)}.map((d) => alongMatrix([1, 2, 3], d, 0.5, 4))));",
        tmp_path,
    )
    for d, m in zip(dirs, out, strict=True):
        top, bottom = _apply(m, (0, 0.5, 0)), _apply(m, (0, -0.5, 0))
        assert [t - b for t, b in zip(top, bottom, strict=True)] == pytest.approx([4 * x for x in d], abs=1e-9)
        assert [(t + b) / 2 for t, b in zip(top, bottom, strict=True)] == pytest.approx([1, 2, 3], abs=1e-9)
        for column in (m[0:3], m[8:11]):  # the radial axes are perpendicular to the axis and 0.5 long
            assert math.hypot(*column) == pytest.approx(0.5, abs=1e-9)
            assert sum(c * x for c, x in zip(column, d, strict=True)) == pytest.approx(0, abs=1e-9)


def test_instances_are_grouped_by_shape_and_material(tmp_path: Path) -> None:
    out = _run(
        "console.log(JSON.stringify(instanceGroups(data).map((g) => ({...g, count: g.refs.length}))));", tmp_path
    )
    got = {(g["shape"], g["material"], g["outlined"]): g for g in out}
    assert set(got) == {
        ("sphere", "m", True),
        ("cylinder", "m", True),  # the solid bond ...
        ("cylinder", "m", False),  # ... and the dashes, which have no outline
        ("dot", "m", False),
        ("cylinder", None, True),  # arrow shaft
        ("cone", None, True),  # arrow head
    }
    atoms = got["sphere", "m", True]
    assert [a["id"] for a in atoms["refs"]] == ["a0", "a1"]
    assert _apply(atoms["matrices"][16:32], (0, 0, 1)) == pytest.approx([0, 0, 1.2])  # H atom: radius 0.2 at z = 1
    solid = got["cylinder", "m", True]
    assert solid["count"] == 1
    assert _apply(solid["matrices"], (0, 0.5, 0)) == pytest.approx([0, 0, 1.0])  # a bond from the origin to the H
    assert got["cylinder", "m", False]["count"] > 1
    assert got["dot", "m", False]["count"] > 1


def test_polyhedron_groups_map_triangles_back_to_polyhedra(tmp_path: Path) -> None:
    out = _run("console.log(JSON.stringify(polyhedronGroups(data)));", tmp_path)
    by_material = {g["material"]: g for g in out}
    assert set(by_material) == {"m", "n"}
    solid = by_material["m"]
    assert solid["ranges"] == [[0, 0, 6], [2, 6, 6]]
    assert solid["owner"] == [0] * 6 + [2] * 6
    assert len(solid["positions"]) == 12 * 9
    assert by_material["n"]["owner"] == [1] * 6 and by_material["n"]["ranges"] == [[1, 0, 6]]
    assert len(solid["edges"]) % 6 == 0 and len(solid["edges"]) > 0
