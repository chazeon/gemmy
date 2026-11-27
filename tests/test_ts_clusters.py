"""Parity of the TypeScript clusters stage (web/src/compile/clusters.ts findClusters) with Python's (find_clusters).

Both sides read the same POSCAR text (tests/cluster_structures.py builds the synthetic structures; the C60 cages are
read from the c60 example's POSCAR). Each side runs its own display box, neighbour graph and stage; the TypeScript side
through clusterRows in web/test/compile-entry.ts. Compared per cluster, in order: members (point keys, exact),
name, rule index and centroids (1e-9), and the warnings, exactly. Faces are exact for rings and for flat molecules. For
a solid molecule the hull's triangles may split a facet along another diagonal (qhull and quickhull differ), so those
are compared as facets: the same planes, each with the same corner set, and the TypeScript triangles wound outwards.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from cluster_structures import (
    benzene,
    c60_poscar,
    chain,
    chair_cyclohexane,
    collinear_triple,
    honeycomb_sheet,
    k23,
    molecule,
    naphthalene,
    poscar,
    ring,
    split_ring,
    stages,
)
from gemmy.compile import clusters
from gemmy.compile.clusters import find_clusters
from gemmy.compile.sites import point_key
from gemmy.config import MAX_RING_SIZE, ClusterRule
from ts_bundle import available, run

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")
TOLERANCE = 1e-9
PLANE_TOLERANCE = 1e-6
CLUSTERS_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "compile" / "clusters.ts"


def _rule_json(rule: ClusterRule) -> dict[str, Any]:
    """The rule as the TypeScript side reads it: the config's field names, sizes resolved."""
    return rule.model_dump()


def _cells(supercell=(1, 1, 1), periodic=(True, True, True), box=None, eps=1e-4) -> dict[str, Any]:
    return {"supercell": list(supercell), "periodic": list(periodic), "eps": eps, "box": box or {}}


def _python_rows(
    tmp_path: Path, text: str, cells: dict[str, Any], rules: list[ClusterRule]
) -> tuple[list[dict[str, Any]], list[str]]:
    """The Python side: the stages as compile_structure runs them, then find_clusters, as plain rows and warnings."""
    periodic = tuple(cells["periodic"])
    box = cells["box"]
    cutoff = max(r.max_distance for r in rules)
    shown, by_index, graph, cell = stages(
        tmp_path, text, tuple(cells["supercell"]), periodic, box, cells["eps"], cutoff
    )
    warnings: list[str] = []
    specs = find_clusters(shown, by_index, graph, rules, cell, box, periodic, cells["eps"], warnings)
    rows = []
    for spec in specs:
        rows.append(
            {
                "members": [point_key(m) for m in spec.members],
                "centroid": list(spec.centroid),
                "centroidFractional": list(spec.centroid_fractional),
                "faces": [list(f) for f in spec.faces],
                "name": spec.name,
                "rule": next(i for i, r in enumerate(rules) if r is spec.rule),
                "positions": [list(m.position) for m in spec.members],
                "kind": spec.rule.kind,
            }
        )
    return rows, warnings


def _ts_key(text: str) -> tuple[int, tuple[int, int, int]]:
    index, shift = text.split(":")
    return (int(index), tuple(int(v) for v in shift.split(",")))  # type: ignore[return-value]


def _facets(faces: list[list[int]], positions: list[list[float]]) -> set[frozenset[int]]:
    """Triangles grouped by plane (unit normal and offset within PLANE_TOLERANCE): each facet as its corner indices."""
    arr = np.asarray(positions, dtype=float)
    planes: list[tuple[Any, float, set[int]]] = []
    for face in faces:
        i, j, k = face
        normal = np.cross(arr[j] - arr[i], arr[k] - arr[i])
        unit = normal / float(np.linalg.norm(normal))
        offset = float(unit @ arr[i])
        for plane_unit, plane_offset, corners in planes:
            if np.max(np.abs(plane_unit - unit)) <= PLANE_TOLERANCE and abs(plane_offset - offset) <= PLANE_TOLERANCE:
                corners.update(face)
                break
        else:
            planes.append((unit, offset, set(face)))
    return {frozenset(corners) for _, _, corners in planes}


def _assert_outward(faces: list[list[int]], positions: list[list[float]]) -> None:
    arr = np.asarray(positions, dtype=float)
    centroid = arr.mean(axis=0)
    for i, j, k in faces:
        normal = np.cross(arr[j] - arr[i], arr[k] - arr[i])
        centre = (arr[i] + arr[j] + arr[k]) / 3.0
        assert float(normal @ (centre - centroid)) > 0, f"triangle {(i, j, k)} is wound inwards"


def _is_flat(positions: list[list[float]]) -> bool:
    """Every point on one plane (the flat path of the hull): the same test the stage uses, via the plane's facets."""
    arr = np.asarray(positions, dtype=float)
    centred = arr - arr.mean(axis=0)
    return float(np.linalg.svd(centred, compute_uv=False)[-1]) <= 1e-6 * float(np.linalg.norm(centred, axis=1).max())


CASES: list[tuple[str, str, dict[str, Any], list[ClusterRule]]] = [
    ("benzene-ring", benzene(), _cells(supercell=(1, 1, 1), box={}), [ring()]),
    ("naphthalene-ring", naphthalene(), _cells(), [ring()]),
    ("split-ring", split_ring(), _cells(box={}), [ring()]),
    ("split-ring-face", split_ring(centre_x=0.0), _cells(box={}), [ring()]),
    ("split-ring-crop-slab", split_ring(centre_x=0.0), _cells(box={"x": [-0.02, 0.02]}), [ring()]),
    ("chair-ring", chair_cyclohexane(), _cells(), [ring()]),
    ("chair-ring-flat", chair_cyclohexane(), _cells(), [ring(flat=True)]),
    ("benzene-ring-flat", benzene(), _cells(supercell=(1, 1, 1), box={}), [ring(flat=True)]),
    ("k23-squares", k23(), _cells(), [ring(min_size=4, max_size=4, min=0.99, max=1.01)]),
    ("graphene-ring", honeycomb_sheet(cells=1), _cells(), [ring(min=1.35, max=1.5)]),
    (
        "pendant-sheet-rings",
        honeycomb_sheet(cells=6, pendant=True),
        _cells(box={}),
        [ring(max_size=MAX_RING_SIZE, min=1.3, max=1.5)],
    ),
    ("pendant-sheet-molecule", honeycomb_sheet(cells=6, pendant=True), _cells(box={}), [molecule(min_size=4)]),
    ("collinear-ring", collinear_triple(), _cells(), [ring(min=1.0, max=2.01, min_size=3, max_size=3)]),
    ("collinear-molecule", collinear_triple(), _cells(), [molecule(min=1.0, max=2.01, min_size=3)]),
    ("chain-periodic", chain(2000), _cells(), [molecule(), ring()]),
    ("benzene-molecule", benzene(), _cells(), [molecule()]),
    ("benzene-both-rules", benzene(), _cells(), [molecule(min_size=7), ring()]),
    ("c60-molecule-1x1x1", c60_poscar(), _cells(supercell=(1, 1, 1)), [molecule()]),
    ("c60-molecule-2x2x2", c60_poscar(), _cells(supercell=(2, 2, 2)), [molecule()]),
    ("c60-molecule-explicit-box", c60_poscar(), _cells(supercell=(1, 1, 1), box={"x": [0.0, 0.5]}), [molecule()]),
]


@pytest.fixture(scope="module")
def ts_results() -> dict[str, Any]:
    """Every case in one node process; one job per case, each giving the TypeScript rows and warnings (or the error)."""
    jobs = [
        {"fn": "clusterRows", "args": [text, "POSCAR", cells, [_rule_json(r) for r in rules]]}
        for _, text, cells, rules in CASES
    ]
    return dict(zip([c[0] for c in CASES], run(jobs), strict=True))


@pytest.mark.parametrize("case_id", [c[0] for c in CASES])
def test_clusters_match_typescript(case_id, ts_results, tmp_path):
    result = ts_results[case_id]
    assert "ok" in result, f"{case_id}: TypeScript clusters failed: {result.get('type')}: {result.get('error')}"
    ts_rows = result["ok"]["clusters"]
    _, text, cells, rules = next(c for c in CASES if c[0] == case_id)
    py_rows, py_warnings = _python_rows(tmp_path, text, cells, rules)
    assert result["ok"]["warnings"] == py_warnings
    assert len(ts_rows) == len(py_rows)
    for ts, py in zip(ts_rows, py_rows, strict=True):
        assert [_ts_key(k) for k in ts["members"]] == py["members"]
        assert ts["name"] == py["name"]
        assert ts["rule"] == py["rule"]
        assert ts["centroid"] == pytest.approx(py["centroid"], abs=TOLERANCE)
        assert ts["centroidFractional"] == pytest.approx(py["centroidFractional"], abs=TOLERANCE)
        flat = py["kind"] == "ring" or _is_flat(py["positions"])
        if flat:
            assert ts["faces"] == py["faces"]
        else:
            assert _facets(ts["faces"], py["positions"]) == _facets(py["faces"], py["positions"])
            _assert_outward(ts["faces"], py["positions"])


def test_c60_parity_gives_the_63_cages_of_the_example(ts_results):
    """The TypeScript side gives the 63 cages of examples/c60 at 2x2x2 (32 molecules, the copies on the box faces):
    each is 60 members."""
    rows = ts_results["c60-molecule-2x2x2"]["ok"]["clusters"]
    assert len(rows) == 63
    assert all(len(r["members"]) == 60 and r["name"] == "C60" for r in rows)


def test_the_pendant_sheet_has_its_hexagons_on_both_sides(ts_results):
    assert len(ts_results["pendant-sheet-rings"]["ok"]["clusters"]) == 36
    assert (
        ts_results["pendant-sheet-molecule"]["ok"]["warnings"]
        and not ts_results["pendant-sheet-molecule"]["ok"]["clusters"]
    )


def test_the_search_budget_matches_the_viewer():
    """MAX_CLUSTER_SEARCH_STEPS is one value in both languages (the viewer writes it without the separators)."""
    match = re.search(r"MAX_CLUSTER_SEARCH_STEPS = ([\d_]+);", CLUSTERS_TS.read_text(encoding="utf-8"))
    assert match, "MAX_CLUSTER_SEARCH_STEPS is not assigned in clusters.ts"
    assert int(match.group(1).replace("_", "")) == clusters.MAX_CLUSTER_SEARCH_STEPS


# The flat test of a ring on the TypeScript side (isFlatRing), with the same shapes as tests/test_clusters.py: a unit
# square at the origin and moved far away (2**40 is exact in a float, so the square stays a square), and a chair.
_SQUARE = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]]
_CHAIR = [
    [0.0, 0.0, 0.25],
    [1.0, 0.0, -0.25],
    [1.5, 1.0, 0.25],
    [1.0, 2.0, -0.25],
    [0.0, 2.0, 0.25],
    [-0.5, 1.0, -0.25],
]


def test_flat_ring_check_is_translation_safe_and_matches_python():
    far = 2.0**40
    shapes = [
        ("square", _SQUARE, True),
        ("square-far", [[x + far, y + far, z] for x, y, z in _SQUARE], True),
        ("square-far-negative", [[x - far, y, z - far] for x, y, z in _SQUARE], True),
        ("chair", _CHAIR, False),
        ("chair-far", [[x + far, y, z] for x, y, z in _CHAIR], False),
    ]
    results = run([{"fn": "isFlatRing", "args": [points]} for _, points, _ in shapes])
    for (name, points, expected), result in zip(shapes, results, strict=True):
        assert result == {"ok": expected}, name
        assert clusters.is_flat_ring(points) is expected, name


def test_a_molecule_with_the_most_copies_the_box_allows_does_not_throw():
    """A tetrahedron (4 atoms, edge 1.2 A) whose display box holds 35^3 = 42,875 copies: 171,500 sites, under
    MAX_BOX_SITES (200,000). The box cap bounds a 4-atom molecule near 50,000 copies, far below node's argument limit
    (about 125,000 spread arguments), so this guards the path at its largest size, not the overflow itself."""
    a = 0.424  # a regular tetrahedron of edge 2 * a * sqrt(2), about 1.2 A
    centre = 5.0
    corners = [(1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1)]
    text = poscar(10.0, [("C", tuple(centre + a * c for c in corner)) for corner in corners])
    box = {axis: [-17, 18] for axis in ("x", "y", "z")}
    rule = molecule(min=0.5, max=1.5)
    (result,) = run([{"fn": "clusterRows", "args": [text, "POSCAR", _cells(box=box), [_rule_json(rule)]]}])
    assert "ok" in result, f"TypeScript clusters failed: {result.get('type')}: {result.get('error')}"
    assert len(result["ok"]["clusters"]) == 35**3
    assert result["ok"]["warnings"] == []
