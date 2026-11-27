"""Full-scene parity of the TypeScript compile (web/src/compile/pipeline.ts) with Python's
(gemmy.compile.pipeline.compile_scene_from_files, then gemmy.config.scene_to_dict), for every fixture and every
committed example. The stage-by-stage tests are test_ts_stages.py, test_ts_bonds.py and test_ts_config.py.

Compared exactly, after golden.normalize (6-decimal floats), except hull topologies: a hull's triangles are grouped by
plane and each facet is compared as its set of point ids (Qhull and quickhull split a square facet differently). A
ring's fan is compared face by face, in order, with its multiplicity: both compilers emit the same fan. The winding is
checked on the TypeScript side: a solid's triangles point away from the centroid of its points; a flat polygon has both
windings, so each of its triangles must be matched by its reverse and its points must lie in one plane. The warnings of
both compilers must be the same. Each scene from TypeScript must also validate in Python
(gemmy.config.validate_scene). Fixtures are discovered from disk (every tests/fixtures/*/scene.golden.json).
"""

from __future__ import annotations

import copy
import functools
import importlib.util
import json
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from golden import normalize
from ts_bundle import available, run

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
EXAMPLES = ROOT / "examples"
# Examples above 5000 atoms run under -m slow. The same list as test_ts_stages.py (LARGE_EXAMPLES).
LARGE_EXAMPLES = frozenset({"apoferritin", "nav17-6j8i", "nucleosome-1kx5"})
# Two unit vectors (or their offsets) closer than this are the same plane. Positions are compared rounded, so the
# plane of a facet is found from the exact positions of each side, not the rounded ones.
PLANE_TOLERANCE = 1e-6

DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("ase", "numpy", "scipy", "pydantic"))
pytestmark = [
    pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)"),
    pytest.mark.skipif(not DEPS_AVAILABLE, reason="ASE, NumPy, SciPy and pydantic are required for the parity tests"),
]


@dataclass(frozen=True)
class Case:
    id: str
    config: Path
    structure: Path
    # Fixtures: the stored scene.golden.json, compared directly as well.
    golden: Path | None = None
    # The source_comment the golden file holds, when this structure's file name differs (wrap's POSCAR.alt).
    golden_comment: str | None = None


def _fixture_cases() -> list[Case]:
    """Every fixture with a stored scene.golden.json. Each POSCAR* file in it is a case: POSCAR.alt (wrap) compiles to
    the same golden, whose source_comment names POSCAR."""
    cases = []
    for golden in sorted(FIXTURES.glob("*/scene.golden.json")):
        folder = golden.parent
        config = folder / "config.json"
        for structure in sorted(folder.glob("POSCAR*")):
            if structure.name == "POSCAR":
                cases.append(Case(folder.name, config, structure, golden))
            else:
                suffix = structure.suffix.removeprefix(".")
                cases.append(Case(f"{folder.name}-{suffix}", config, structure, golden, "POSCAR"))
    return cases


def _example_cases() -> list[Case]:
    cases = []
    for directory in sorted(p for p in EXAMPLES.iterdir() if (p / "config.json").exists()):
        config = directory / "config.json"
        structure = directory / json.loads(config.read_text(encoding="utf-8"))["structure"]
        cases.append(Case(f"example-{directory.name}", config, structure))
    return cases


# LAMMPS files read through the config's `types` map: a dump under its own config (no golden), and the MgO data file
# under a map that renames its types (the map wins over the Masses comments, which say Mg).
LAMMPS_CASES = [
    Case("lammps-types-dump", FIXTURES / "lammps-types" / "config.json", FIXTURES / "lammps-types" / "types.dump"),
    Case(
        "lammps-types-data",
        FIXTURES / "lammps-types" / "config-data.json",
        FIXTURES / "structures" / "lammps-masses" / "mgo-masses.data",
    ),
]
ALL_CASES = _fixture_cases() + LAMMPS_CASES + _example_cases()
SMALL_CASES = [c for c in ALL_CASES if c.id.removeprefix("example-") not in LARGE_EXAMPLES]
LARGE_CASES = [c for c in ALL_CASES if c.id.removeprefix("example-") in LARGE_EXAMPLES]


# ---------------------------------------------------------------------------
# The two sides
# ---------------------------------------------------------------------------


def _ts_job(case: Case) -> dict[str, Any]:
    """The compileFixture call: the structure and config texts, and the files the config names (as written)."""
    from gemmy.config import referenced_files

    raw = json.loads(case.config.read_text(encoding="utf-8"))
    sidecars = {
        name: (case.config.parent / name).read_text(encoding="utf-8") for name in referenced_files(raw, structure=False)
    }
    return {
        "fn": "compileFixture",
        "args": [
            case.structure.name,
            case.structure.read_text(encoding="utf-8"),
            case.config.name,
            case.config.read_text(encoding="utf-8"),
            sidecars,
        ],
    }


@functools.cache
def _ts_small() -> dict[str, dict[str, Any]]:
    """Every small case compiled in one node process: {case id: {"scene": ..., "warnings": [...]}}."""
    results = run([_ts_job(case) for case in SMALL_CASES])
    return _unwrap([c.id for c in SMALL_CASES], results)


@functools.cache
def _ts_one(case: Case) -> dict[str, Any]:
    return _unwrap([case.id], run([_ts_job(case)]))[case.id]


def _unwrap(ids: list[str], results: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for case_id, result in zip(ids, results, strict=True):
        assert "ok" in result, f"{case_id}: TypeScript compile failed: {result.get('type')}: {result.get('error')}"
        out[case_id] = result["ok"]
    return out


def _ts_scene(case: Case) -> dict[str, Any]:
    if case in SMALL_CASES:
        return _ts_small()[case.id]
    return _ts_one(case)


@functools.cache
def _python_compile(case: Case) -> tuple[dict[str, Any], list[str]]:
    """The scene and the warnings (gemmy's UserWarnings) of the Python compile of one case."""
    from gemmy.compile.pipeline import compile_scene_from_files
    from gemmy.config import scene_to_dict

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        scene = compile_scene_from_files(case.config, case.structure)
    messages = [str(w.message) for w in caught if issubclass(w.category, UserWarning)]
    return scene_to_dict(scene), messages


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------


def _sub(a: list[float], b: list[float]) -> list[float]:
    return [a[k] - b[k] for k in range(3)]


def _cross(a: list[float], b: list[float]) -> list[float]:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _dot(a: list[float], b: list[float]) -> float:
    return sum(a[k] * b[k] for k in range(3))


def _positions(scene: dict[str, Any]) -> dict[str, list[float]]:
    return {point["id"]: point["position"] for point in scene["points"]}


def _is_flat(topo: dict[str, Any]) -> bool:
    """A flat polygon: every face's reverse is also a face of the same topology (its fan, drawn from both sides)."""
    faces = {tuple(face) for face in topo["faces"]}
    return bool(faces) and all((f[0], f[2], f[1]) in faces for f in faces)


def _computed_point_ids(scene: dict[str, Any]) -> set[str]:
    """The computed centres: points with no reference that no atom primitive draws (a cluster's centroid). Found from
    the scene's identity, not the element, so a dummy X atom that a polyhedron uses as a ligand is not one of them."""
    from gemmy.compile.pipeline import COMPUTED_ELEMENT

    atom_points = {atom["point_id"] for atom in scene["primitives"]["atoms"]}
    computed = {point["id"] for point in scene["points"] if point["ref"] is None and point["id"] not in atom_points}
    elements = {point["id"]: point["element"] for point in scene["points"]}
    assert all(elements[pid] == COMPUTED_ELEMENT for pid in computed), (
        "a computed centre must have the computed element"
    )
    return computed


def _is_fan(topo: dict[str, Any], computed: set[str]) -> bool:
    """A cluster ring: a fan around a computed centroid, which is the topology's last point (pipeline.add_cluster). The
    fan is drawn from both sides like a flat polygon, but its members need not lie in one plane (a chair ring is not
    flat)."""
    return topo["point_ids"][-1] in computed


def _assert_orientation(scene: dict[str, Any], case_id: str) -> None:
    """Solids: every triangle's normal points away from the centroid of its topology's points (a convex hull's
    interior). Flat polygons: each triangle is matched by its reverse, and all the points lie in one plane. Ring fans:
    see _assert_fan. A topology that has reverses but is not flat fails the planarity check, so it cannot pass as a
    polygon."""
    points = _positions(scene)
    computed = _computed_point_ids(scene)
    for topo in scene["topologies"]:
        ids = topo["point_ids"]
        if _is_fan(topo, computed):
            _assert_fan(points, computed, topo, case_id)
            continue
        if _is_flat(topo):
            _assert_flat(points, topo, case_id)
            continue
        centroid = [sum(points[pid][k] for pid in ids) / len(ids) for k in range(3)]
        for face in topo["faces"]:
            a, b, c = (points[ids[k]] for k in face)
            normal = _cross(_sub(b, a), _sub(c, a))
            centre = [(a[k] + b[k] + c[k]) / 3 for k in range(3)]
            assert _dot(normal, _sub(centre, centroid)) > 0, (
                f"{case_id}: topologies[{topo['id']}].faces {face} points inward"
            )


# A ring's centroid is the mean of its members (computed in both compilers), so it agrees to rounding only.
CENTRE_TOLERANCE = 1e-6


def _assert_fan(points: dict[str, list[float]], computed: set[str], topo: dict[str, Any], case_id: str) -> None:
    """A ring fan: the computed centroid is the mean of the ring's members, the members are atoms, and each triangle has
    its reverse (n triangles from the centroid, twice). No plane check: the ring need not be flat."""
    # A ring's points are its members, then its centroid: pipeline.add_cluster lists the centroid last.
    ids = topo["point_ids"]
    members, centre = ids[:-1], ids[-1]
    assert not any(pid in computed for pid in members), f"{case_id}: topologies[{topo['id']}] has a computed member"
    mean = [sum(points[pid][k] for pid in members) / len(members) for k in range(3)]
    assert all(abs(points[centre][k] - mean[k]) <= CENTRE_TOLERANCE for k in range(3)), (
        f"{case_id}: topologies[{topo['id']}] centroid is not the mean of its members"
    )
    faces = {tuple(face) for face in topo["faces"]}
    assert len(topo["faces"]) == 2 * len(members), f"{case_id}: topologies[{topo['id']}] is not a two-sided fan"
    assert all((f[0], f[2], f[1]) in faces for f in faces), f"{case_id}: topologies[{topo['id']}] is one-sided"


def _assert_flat(points: dict[str, list[float]], topo: dict[str, Any], case_id: str) -> None:
    ids = topo["point_ids"]
    a, b, c = (points[ids[k]] for k in topo["faces"][0])
    normal = _cross(_sub(b, a), _sub(c, a))
    length = _dot(normal, normal) ** 0.5
    assert length > 0, f"{case_id}: topologies[{topo['id']}] starts with a degenerate face"
    unit = [x / length for x in normal]
    size = max(_dot(_sub(points[pid], a), _sub(points[pid], a)) ** 0.5 for pid in ids)
    for pid in ids:
        off_plane = abs(_dot(_sub(points[pid], a), unit))
        assert off_plane <= PLANE_TOLERANCE * size, f"{case_id}: topologies[{topo['id']}] point {pid} is off the plane"


def _facets(scene: dict[str, Any], topo: dict[str, Any]) -> list[list[str]]:
    """The topology's facets: its triangles grouped by plane (exact positions, the same plane up to a sign), each
    facet as the sorted point ids of its corners. The result is sorted, so it is comparable across the two sides."""
    points = _positions(scene)
    ids = topo["point_ids"]
    planes: list[tuple[list[float], float, set[str]]] = []
    for face in topo["faces"]:
        corners = [ids[k] for k in face]
        a, b, c = (points[pid] for pid in corners)
        normal = _cross(_sub(b, a), _sub(c, a))
        length = _dot(normal, normal) ** 0.5
        assert length > 0, f"{topo['id']}: face {face} is degenerate"
        unit = [x / length for x in normal]
        offset = _dot(unit, a)
        for known, known_offset, members in planes:
            same = all(abs(unit[k] - known[k]) <= PLANE_TOLERANCE for k in range(3))
            flipped = all(abs(unit[k] + known[k]) <= PLANE_TOLERANCE for k in range(3))
            if (same and abs(offset - known_offset) <= PLANE_TOLERANCE) or (
                flipped and abs(offset + known_offset) <= PLANE_TOLERANCE
            ):
                members.update(corners)
                break
        else:
            planes.append((unit, offset, set(corners)))
    return sorted(sorted(members) for _, _, members in planes)


def _facet_form(scene: dict[str, Any]) -> dict[str, Any]:
    """The scene with each hull topology's faces replaced by its facets (computed on the scene's own exact positions).
    A ring's fan keeps its faces as they are: it is compared exactly."""
    computed = _computed_point_ids(scene)
    out = copy.deepcopy(scene)
    for topo in out["topologies"]:
        if _is_fan(topo, computed):
            continue
        topo["facets"] = _facets(scene, topo)
        del topo["faces"]
    return out


def first_difference(a: Any, b: Any, path: str = "scene") -> str | None:
    """The path of the first place two JSON-like values differ (a is the TypeScript side), or None if equal."""
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            only_a = sorted(set(a) - set(b))
            only_b = sorted(set(b) - set(a))
            return f"{path}: keys differ (only in ts {only_a}, only in python {only_b})"
        for key in a:
            found = first_difference(a[key], b[key], f"{path}.{key}")
            if found is not None:
                return found
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path}: length {len(a)} (ts) != {len(b)} (python)"
        for index, (x, y) in enumerate(zip(a, b, strict=True)):
            found = first_difference(x, y, f"{path}[{index}]")
            if found is not None:
                return found
        return None
    if isinstance(a, bool) != isinstance(b, bool) or a != b:
        return f"{path}: ts={a!r} python={b!r}"
    return None


def _check_parity(case: Case) -> None:
    from gemmy.config import validate_scene

    result = _ts_scene(case)
    python, python_warnings = _python_compile(case)
    assert result["warnings"] == python_warnings, (
        f"{case.id}: warnings differ: typescript {result['warnings']} python {python_warnings}"
    )
    ts = result["scene"]
    _assert_orientation(ts, case.id)
    try:
        validate_scene(copy.deepcopy(ts))
    except ValueError as error:  # pydantic's ValidationError is a ValueError, and names the key path
        pytest.fail(f"{case.id}: the TypeScript scene does not validate in Python: {error}")
    difference = first_difference(normalize(_facet_form(ts)), normalize(_facet_form(python)))
    assert difference is None, f"{case.id}: first difference from Python at {difference}"


def _check_golden(case: Case) -> None:
    assert case.golden is not None
    golden = json.loads(case.golden.read_text(encoding="utf-8"))
    ts = copy.deepcopy(_ts_scene(case)["scene"])
    if case.golden_comment is not None:
        ts["source_comment"] = case.golden_comment
    _assert_orientation(ts, case.id)
    difference = first_difference(normalize(_facet_form(ts)), normalize(_facet_form(golden)))
    assert difference is None, f"{case.id}: first difference from scene.golden.json at {difference}"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", SMALL_CASES, ids=lambda c: c.id)
def test_ts_scene_matches_python(case: Case) -> None:
    _check_parity(case)


@pytest.mark.slow
@pytest.mark.parametrize("case", LARGE_CASES, ids=lambda c: c.id)
def test_ts_scene_matches_python_on_large_examples(case: Case) -> None:
    _check_parity(case)


@pytest.mark.parametrize("case", [c for c in ALL_CASES if c.golden is not None], ids=lambda c: c.id)
def test_ts_scene_matches_stored_golden(case: Case) -> None:
    _check_golden(case)


# An Al centre with six X ligands, all atoms (a dummy element a polyhedron may use), in a 4 angstrom cell.
X_LIGAND_POSCAR = """Dummy X ligands (test)
1.0
4.0 0.0 0.0
0.0 4.0 0.0
0.0 0.0 4.0
Al X
1 6
Direct
0.5 0.5 0.5
0.25 0.5 0.5
0.75 0.5 0.5
0.5 0.25 0.5
0.5 0.75 0.5
0.5 0.5 0.25
0.5 0.5 0.75
"""


def test_a_dummy_x_ligand_is_an_atom_not_a_computed_centre(tmp_path: Path) -> None:
    """An X atom that a polyhedron uses as a ligand is an atom, so the scene has no computed centre and the ring checks
    (a fan's last point is its centroid) do not apply to its polyhedron."""
    structure = tmp_path / "POSCAR"
    structure.write_text(X_LIGAND_POSCAR, encoding="utf-8")
    config = tmp_path / "config.json"
    config.write_text(
        json.dumps(
            {
                "polyhedra": [
                    {
                        "name": "AlX6",
                        "center": "Al",
                        "ligands": ["X"],
                        "min": 0.5,
                        "max": 1.5,
                        "min_coordination": 6,
                        "max_coordination": 6,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    case = Case("dummy-x-ligand", config, structure)
    _check_parity(case)
    scene = _ts_scene(case)["scene"]
    computed = _computed_point_ids(scene)
    assert computed == set()
    (topo,) = scene["topologies"]
    assert not _is_fan(topo, computed)


def test_a_huge_box_range_is_refused_by_both_compilers(tmp_path: Path) -> None:
    """A finite box range wider than MAX_IMAGES_PER_AXIS is an error on both sides, at once. Without the cap the image
    loop would run for ever (the range is finite, so config accepts it)."""
    from gemmy.compile.pipeline import compile_scene_from_files

    rocksalt = FIXTURES / "rocksalt"
    config = tmp_path / "config.json"
    config.write_text(
        json.dumps({"cells": {"periodic": [True, False, False], "box": {"x": [0, 1e9]}}}), encoding="utf-8"
    )
    structure = tmp_path / "POSCAR"
    structure.write_text((rocksalt / "POSCAR").read_text(encoding="utf-8"), encoding="utf-8")
    with pytest.raises(ValueError, match="MAX_IMAGES_PER_AXIS"):
        compile_scene_from_files(config, structure)
    case = Case("huge-box", config, structure)
    (result,) = run([_ts_job(case)])
    assert result["type"] == "Error", result
    assert "MAX_IMAGES_PER_AXIS" in result["error"]


def test_first_difference_names_the_path() -> None:
    a = {"points": [{"id": "p0", "position": [0.0, 1.0]}]}
    b = {"points": [{"id": "p0", "position": [0.0, 2.0]}]}
    assert first_difference(a, b, "scene") == "scene.points[0].position[1]: ts=1.0 python=2.0"
    assert first_difference(a, a) is None
