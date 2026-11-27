"""Parity of the TypeScript bond, polyhedron and selection stages (web/src/compile) with the Python ones
(src/gemmy/compile): the convex hull, the neighbour graph, then each stage on the inputs the Python pipeline really
passes it (recorded while it compiles every fixture), plus the select and reference errors. Everything runs in one node
process (tests/ts_bundle.py); the JSON wrappers are the bond, polyhedron and selection helpers in
web/test/compile-entry.ts.
"""

from __future__ import annotations

import functools
import importlib.util
import itertools
import warnings
from collections.abc import Callable
from contextlib import ExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest import mock

import pytest

from ts_bundle import available, run

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
C60_POSCAR = ROOT / "examples" / "c60" / "POSCAR"
CASES = sorted(path.parent.name for path in FIXTURES.glob("*/scene.golden.json"))
DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("ase", "numpy", "scipy"))
TOLERANCE = 1e-9
# Selection and parse errors do not depend on a fixture. Shifts with signs, underscores and spaces are on purpose.
REFS = [
    5,
    "5",
    "5+1_0_0",
    "5+1_0_-1",
    "5+-1_0_0",
    " 5+ 1_0_0 ",
    "x",
    "5+1_0",
    "5+1_0_0_0",
    "+1_0_0",
    "5+a_0_0",
    "5-1_0_0",
]

pytestmark = [
    pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)"),
    pytest.mark.skipif(not DEPS_AVAILABLE, reason="ASE, NumPy and SciPy are required for the parity tests"),
]


# ---- JSON for the TypeScript side, and the identities both sides compare --------------------------------------------


def _sites_json(sites: Any) -> list[dict[str, Any]]:
    return [_site_json(site) for site in sites]


def _site_json(site: Any) -> dict[str, Any]:
    return {
        "index": site.index,
        "element": site.element,
        "label": site.label,
        "fractional": list(site.fractional),
        "position": list(site.position),
        "shift": list(site.shift),
        "copy": site.copy,
    }


def _rule_json(rule: Any) -> dict[str, Any]:
    data = rule.model_dump(mode="json")
    if "ligands" in data:  # a frozenset in Python; sorted, as config.ts holds it
        data["ligands"] = sorted(rule.ligands)
    return data


def _graph_rows(graph: dict[int, list[Any]]) -> list[Any]:
    return [
        [index, [{"index": nb.index, "shift": list(nb.shift), "distance": nb.distance} for nb in items]]
        for index, items in graph.items()
    ]


def _cell_json(cell: Any) -> list[list[float]]:
    return [[float(value) for value in row] for row in cell]


def _structure_json(structure: Any) -> dict[str, Any]:
    return {
        "comment": structure.comment,
        "lattice": [list(row) for row in structure.lattice],
        "atoms": [
            {"element": a.element, "fractional": list(a.fractional), "styleKey": a.style_key or a.element}
            for a in structure.atoms
        ],
    }


def _key(site: Any) -> tuple[int, tuple[int, int, int]]:
    """A point's identity in Python: (index, shift), the pipeline's point_key."""
    return (site.index, tuple(site.shift))


def _ts_key(text: str) -> tuple[int, tuple[int, int, int]]:
    """The TypeScript pointKey string ("index:a,b,c") read back into the same tuple."""
    index, shift = text.split(":")
    return (int(index), tuple(int(v) for v in shift.split(",")))  # type: ignore[return-value]


def _index_of(rules: list[Any], rule: Any) -> int:
    """Position of this very rule object in the config's list (identity, not equality)."""
    for position, candidate in enumerate(rules):
        if candidate is rule:
            return position
    raise AssertionError("rule is not in the config's list")


def _close(a: list[float], b: list[float]) -> bool:
    return len(a) == len(b) and all(abs(x - y) <= TOLERANCE for x, y in zip(a, b, strict=True))


# ---- Geometry checks shared by the hull tests ------------------------------------------------------------------------


def _facets(faces: list[Any], points: list[Any], tolerance: float = TOLERANCE) -> set[frozenset[int]]:
    """Triangles grouped by plane (unit normal and offset within `tolerance`): each facet as its corner indices."""
    import numpy as np

    arr = np.asarray(points, dtype=float)
    planes: list[tuple[Any, float, set[int]]] = []
    for face in faces:
        i, j, k = (int(v) for v in face)
        normal = np.cross(arr[j] - arr[i], arr[k] - arr[i])
        length = float(np.linalg.norm(normal))
        assert length > 1e-12, f"degenerate triangle {face}"
        unit = normal / length
        offset = float(unit @ arr[i])
        for plane_unit, plane_offset, corners in planes:
            if np.max(np.abs(plane_unit - unit)) <= tolerance and abs(plane_offset - offset) <= tolerance:
                corners.update((i, j, k))
                break
        else:
            planes.append((unit, offset, {i, j, k}))
    return {frozenset(corners) for _, _, corners in planes}


def _assert_outward(faces: list[Any], points: list[Any]) -> None:
    """Every triangle's normal points away from the centroid of the points."""
    import numpy as np

    if not faces:
        return
    arr = np.asarray(points, dtype=float)
    centroid = arr.mean(axis=0)
    for face in faces:
        i, j, k = (int(v) for v in face)
        normal = np.cross(arr[j] - arr[i], arr[k] - arr[i])
        centre = (arr[i] + arr[j] + arr[k]) / 3.0
        assert float(normal @ (centre - centroid)) > 0, f"triangle {face} is wound inwards"


# ---- Hull inputs ---------------------------------------------------------------------------------------------------


def _c60_points() -> list[list[float]]:
    """The 60 carbons of one molecule of examples/c60, found by its bonds: a walk from the first carbon over the bond
    window (1.3-1.5 A, minimum image). Centred on their centroid, they are one truncated icosahedron."""
    import numpy as np

    from gemmy.readers import load_structure

    structure = load_structure(C60_POSCAR)
    lattice = np.asarray(structure.lattice, dtype=float)
    frac = {i: np.asarray(a.fractional, dtype=float) for i, a in enumerate(structure.atoms) if a.element == "C"}
    start = min(frac)
    unwrapped = {start: frac[start]}
    frontier = [start]
    while frontier:
        i = frontier.pop()
        for j in frac:
            if j in unwrapped:
                continue
            delta = frac[j] - frac[i]
            delta -= np.round(delta)  # minimum image
            if 1.3 <= np.linalg.norm(delta @ lattice) <= 1.5:
                unwrapped[j] = unwrapped[i] + delta
                frontier.append(j)
    assert len(unwrapped) == 60
    cart = np.asarray([f @ lattice for f in unwrapped.values()])
    cart -= cart.mean(axis=0)
    assert float(np.ptp(np.linalg.norm(cart, axis=1))) < 0.05  # one shell, every carbon at the same distance
    return cart.tolist()


def _truncated_icosahedron() -> list[list[float]]:
    """The 60 vertices of the truncated icosahedron with exact coordinates: even permutations of the three classes."""
    phi = (1 + 5**0.5) / 2
    vertices = set()
    for base in ((0, 1, 3 * phi), (1, 2 + phi, 2 * phi), (phi, 2, 2 * phi + 1)):
        for shift in range(3):
            w = base[shift:] + base[:shift]  # cyclic permutations keep the parity (even)
            for signs in itertools.product((1, -1), repeat=3):
                vertices.add(tuple(round(s * c, 12) for s, c in zip(signs, w, strict=True)))
    assert len(vertices) == 60
    return [list(v) for v in sorted(vertices)]


# Known facet counts: the solids are exact, so Qhull's triangles group into these facets at the strict tolerance. The
# POSCAR cage is only nearly regular (its radii differ by 0.008 A), so its facets are grouped at a looser tolerance.
FACETS = {"octahedron": 8, "cube": 6, "cuboctahedron": 14, "truncated-icosahedron": 32, "c60": 32}
FACET_TOLERANCE = {"c60": 0.02}


def _hull_cases() -> dict[str, list[list[float]]]:
    import numpy as np

    cases: dict[str, list[list[float]]] = {
        "octahedron": [[1.0, 0, 0], [-1.0, 0, 0], [0, 1.0, 0], [0, -1.0, 0], [0, 0, 1.0], [0, 0, -1.0]],
        "cube": [[float(x), float(y), float(z)] for x, y, z in itertools.product((-1, 1), repeat=3)],
        "c60": _c60_points(),
        "truncated-icosahedron": _truncated_icosahedron(),
        "tetrahedron": [[0, 0, 0], [1.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0]],
        "three-points": [[0, 0, 0], [1.0, 0, 0], [0, 1.0, 0]],
        "empty": [],
        # Flat clouds: scipy raises QhullError; the TypeScript side must raise too.
        "square": [[0, 0, 0], [1.0, 0, 0], [1.0, 1.0, 0], [0, 1.0, 0]],
        "square-duplicate-corner": [[0, 0, 0], [1.0, 0, 0], [1.0, 0, 0], [1.0, 1.0, 0], [0, 1.0, 0]],
        "collinear": [[0, 0, 0], [1.0, 0, 0], [2.0, 0, 0], [3.0, 0, 0]],
        "coplanar-with-interior": [[0, 0, 0], [1.0, 0, 0], [1.0, 1.0, 0], [0, 1.0, 0], [0.3, 0.2, 0]],
        # The square-planar CN4 of CuO4 and a flat hexagon in a tilted plane (not on an axis).
        "square-planar": [[2.0, 0, 0], [-2.0, 0, 0], [0, 2.0, 0], [0, -2.0, 0]],
        "hexagon-tilted": [[float(v) for v in row] for row in _tilted_hexagon()],
    }
    # Near-flat: the 4th point is lifted off the plane z=0 by e. Relative to the extent (2) that is e/2: 5e-13 and 5e-9
    # are flat (polygon); 5e-4 is a solid. Each with a copy scaled by 1000 (the test is relative, so the same answer).
    for e, tag in ((1e-12, "1e-12"), (1e-8, "1e-8"), (1e-3, "1e-3")):
        base = [[1.0, 0, 0], [0, 1.0, 0], [-1.0, 0, 0], [0, -1.0, e]]
        cases[f"near-flat-{tag}"] = base
        cases[f"near-flat-{tag}-x1000"] = [[1000.0 * c for c in p] for p in base]
    cuboctahedron = []  # permutations of (+-1, +-1, 0): 12 points, 8 triangles and 6 square facets
    for axes in itertools.combinations(range(3), 2):
        for a, b in itertools.product((-1.0, 1.0), repeat=2):
            point = [0.0, 0.0, 0.0]
            point[axes[0]], point[axes[1]] = a, b
            cuboctahedron.append(point)
    cases["cuboctahedron"] = cuboctahedron
    for seed in range(3):
        rng = np.random.default_rng(seed)
        for n in (5, 12, 40):
            cases[f"random-{seed}-{n}"] = rng.normal(size=(n, 3)).tolist()
    rng = np.random.default_rng(7)
    flat = rng.normal(size=(10, 2))
    cases["plane-z0"] = [[float(x), float(y), 0.0] for x, y in flat]
    for seed in range(3):  # random clouds in random planes: no exact coordinates, so only the arithmetic decides
        rng = np.random.default_rng(100 + seed)
        basis = np.linalg.qr(rng.normal(size=(3, 3)))[0][:, :2]
        origin = rng.normal(size=3)
        for n in (4, 9, 30):
            planar = origin + rng.normal(size=(n, 2)) @ basis.T
            cases[f"coplanar-random-{seed}-{n}"] = planar.tolist()
    return cases


def _tilted_hexagon() -> list[list[float]]:
    """Six points at 1.39 A round a centre, in a plane tilted off the axes (a flat C6 ring)."""
    import numpy as np

    rng = np.random.default_rng(3)
    basis = np.linalg.qr(rng.normal(size=(3, 3)))[0][:, :2]
    ring = [[1.39 * np.cos(np.pi * k / 3), 1.39 * np.sin(np.pi * k / 3)] for k in range(6)]
    return (np.asarray(ring) @ basis.T + np.array([5.0, 5.0, 2.0])).tolist()


# Flat clouds and what their polygon is: the corners' count (the triangles are 2 less), or no triangles at all.
PLANAR_CORNERS = {"square": 4, "square-duplicate-corner": 4, "coplanar-with-interior": 4, "square-planar": 4}
PLANAR_CORNERS["hexagon-tilted"] = 6
for _tag in ("1e-12", "1e-8"):  # near-flat polygons: 4 corners, with and without the 1000x scale
    PLANAR_CORNERS[f"near-flat-{_tag}"] = 4
    PLANAR_CORNERS[f"near-flat-{_tag}-x1000"] = 4


# ---- Checks: one job per stage call, with the Python result it must match ------------------------------------------


@dataclass
class Check:
    group: str
    case: str
    label: str
    job: dict[str, Any]
    expected: dict[str, Any]  # {"ok": python value} or {"error": message, "type": class name}
    verify: Callable[[Any, Any], None] | None = None
    same_message: bool = True
    ts: dict[str, Any] = field(default_factory=dict)


def _outcome(call: Callable[[], Any]) -> dict[str, Any]:
    try:
        return {"ok": call()}
    except Exception as error:  # noqa: BLE001 - the outcome is the point: both sides must fail alike
        return {"error": str(error), "type": type(error).__name__}


def _verify_hull(ts: list[Any], py: list[Any], *, points: list[list[float]], tolerance: float) -> None:
    if len(points) < 4 or _is_planar(points):
        # Flat clouds: the polygon's triangles are the same triangles in the same order, not only the same facets.
        assert [tuple(t) for t in ts] == [tuple(t) for t in py]
        return
    assert _facets(ts, points, tolerance) == _facets(py, points, tolerance)
    _assert_outward(ts, points)


def _is_planar(points: list[Any]) -> bool:
    from gemmy.compile.lattice import is_planar

    return is_planar([tuple(p) for p in points])


def _hull_checks() -> list[Check]:
    from gemmy.compile.lattice import convex_hull_faces

    checks = []
    for name, points in _hull_cases().items():
        expected = _outcome(lambda pts=points: convex_hull_faces(pts))
        checks.append(
            Check(
                group="hull",
                case=name,
                label=name,
                job={"fn": "convexHullFaces", "args": [points]},
                expected=expected,
                verify=functools.partial(_verify_hull, points=points, tolerance=FACET_TOLERANCE.get(name, TOLERANCE)),
                same_message=True,
            )
        )
    return checks


def _graph_checks() -> list[Check]:
    from gemmy.compile.bonds import build_neighbor_graph
    from gemmy.compile.sites import repeat_structure
    from gemmy.config import load_scene_config
    from gemmy.readers import load_structure

    checks = []
    for name in CASES:
        directory = FIXTURES / name
        config = load_scene_config(directory / "config.json")
        structure = load_structure(directory / "POSCAR")
        cutoff = max(
            max((r.max_distance for r in config.bonds if r.visible), default=0.0),
            max((r.max_distance for r in config.polyhedra if r.visible), default=0.0),
        )
        graph = build_neighbor_graph(repeat_structure(structure, config.cell.supercell, config.cell.periodic), cutoff)
        job = {
            "fn": "neighborGraphRows",
            "args": [
                _structure_json(structure),
                list(config.cell.supercell),
                list(config.cell.periodic),
                cutoff,
            ],
        }
        checks.append(
            Check(
                group="graph",
                case=name,
                label=name,
                job=job,
                expected={"ok": graph},
                verify=_verify_graph,
            )
        )
    return checks


def _verify_graph(ts_rows: list[Any], py_graph: dict[int, list[Any]]) -> None:
    ts = {index: items for index, items in ts_rows}
    assert sorted(ts) == sorted(py_graph)
    for index, items in py_graph.items():
        got = ts[index]
        assert len(got) == len(items), f"atom {index}: {len(got)} neighbours, Python has {len(items)}"
        for row, nb in zip(got, items, strict=True):
            assert row["index"] == nb.index and tuple(row["shift"]) == nb.shift, f"atom {index}: order differs"
            assert abs(row["distance"] - nb.distance) <= TOLERANCE, f"atom {index}: distance differs"


def _verify_bonds(rules: list[Any], ts: list[Any], py: list[Any]) -> None:
    got = [(_ts_key(a), _ts_key(b), rule) for a, b, rule in ts]
    want = [(_key(spec.a), _key(spec.b), _index_of(rules, spec.rule)) for spec in py]
    assert got == want


def _verify_completion(bond_rules: list[Any], ts: list[Any], py: list[Any]) -> None:
    got = [(_ts_key(key), rule) for key, rule in ts]
    want = [(_key(done.partner), _index_of(bond_rules, done.rule)) for done in py]
    assert got == want


def _verify_warnings(ts: list[Any], py: list[str]) -> None:
    assert ts == py  # the same texts, in the same order


def _verify_polyhedra(ts: list[Any], py: list[Any]) -> None:
    assert len(ts) == len(py)
    for got, spec in zip(ts, py, strict=True):
        assert _ts_key(got["centre"]) == _key(spec.center)
        assert [_ts_key(k) for k in got["ligands"]] == [_key(s) for s in spec.ligands]
        for position, ligand in zip(got["ligandPositions"], spec.ligands, strict=True):
            assert _close(position, list(ligand.position)), f"ligand position differs at {got['name']}"
        assert got["name"] == spec.name
        points = got["ligandPositions"]
        if _is_planar(points):  # a polygon, drawn from both sides: the same triangles in the same order
            assert [tuple(t) for t in got["faces"]] == [tuple(t) for t in spec.faces], got["name"]
            continue
        assert _facets(got["faces"], points) == _facets(spec.faces, points), f"facets differ at {got['name']}"
        _assert_outward(got["faces"], points)


def _verify_selection(ts: list[Any], py: list[Any]) -> None:
    assert [_ts_key(k) for k in ts] == [_key(s) for s in py]


def _verify_shell(ts: list[Any], py: tuple[Any, list[Any]]) -> None:
    centre, ligands = py
    assert _ts_key(ts[0]) == _key(centre)
    assert [_ts_key(k) for k in ts[1]] == [_key(s) for s in ligands]


def _stage_checks() -> list[Check]:
    """The stages on the inputs the pipeline passes them, recorded by compile_scene on every fixture."""
    from gemmy.compile import pipeline
    from gemmy.compile.polyhedra import find_polyhedra
    from gemmy.compile.selection import apply_selection, polyhedron_shell, resolve_centre
    from gemmy.config import SelectConfig, load_scene_config
    from gemmy.readers import load_structure

    checks: list[Check] = []
    for name in CASES:
        directory = FIXTURES / name
        config = load_scene_config(directory / "config.json")
        structure = load_structure(directory / "POSCAR")
        recorded: dict[str, list[tuple[tuple[Any, ...], dict[str, Any], Any]]] = {
            stage: []
            for stage in ("find_bonds", "closing_bonds", "find_polyhedra", "complete_ligand", "apply_selection")
        }
        with ExitStack() as stack:
            for stage, sink in recorded.items():
                stack.enter_context(mock.patch.object(pipeline, stage, _recording(getattr(pipeline, stage), sink)))
            # flat_poly has a centre that warns on purpose (tests/test_golden.py); the parity checks read the list.
            stack.enter_context(warnings.catch_warnings())
            warnings.simplefilter("ignore", UserWarning)
            pipeline.compile_scene(structure, config, base_dir=directory)
        bond_rules, poly_rules = config.bonds, config.polyhedra

        for args, kwargs, result in recorded["find_bonds"]:
            shown, by_index, graph, rules, cell = args[0], args[1], args[2], args[3], args[4]
            checks.append(
                Check(
                    group="bonds",
                    case=name,
                    label=f"{name}: find_bonds strict={kwargs.get('strict', False)}",
                    job={
                        "fn": "findBondRows",
                        "args": [
                            _sites_json(shown),
                            _sites_json(by_index.values()),
                            _graph_rows(graph),
                            [_rule_json(r) for r in rules],
                            _cell_json(cell),
                            kwargs.get("strict", False),
                        ],
                    },
                    expected={"ok": result},
                    verify=functools.partial(_verify_bonds, rules),
                )
            )
        for args, _, result in recorded["closing_bonds"]:
            shown, by_index, graph, rules, cell = args
            checks.append(
                Check(
                    group="closing",
                    case=name,
                    label=f"{name}: closing_bonds",
                    job={
                        "fn": "closingBondRows",
                        "args": [
                            _sites_json(shown),
                            _sites_json(by_index.values()),
                            _graph_rows(graph),
                            [_rule_json(r) for r in rules],
                            _cell_json(cell),
                        ],
                    },
                    expected={"ok": result},
                    verify=functools.partial(_verify_bonds, rules),
                )
            )
        for args, _, result in recorded["complete_ligand"]:
            ligand, by_index, graph, _secondary, cell = args
            checks.append(
                Check(
                    group="completion",
                    case=name,
                    label=f"{name}: complete_ligand {ligand.index}",
                    job={
                        "fn": "completionRows",
                        "args": [
                            [_rule_json(r) for r in bond_rules],
                            _site_json(ligand),
                            _sites_json(by_index.values()),
                            _graph_rows(graph),
                            _cell_json(cell),
                        ],
                    },
                    expected={"ok": result},
                    verify=functools.partial(_verify_completion, bond_rules),
                )
            )
        for args, _, result in recorded["find_polyhedra"]:
            centers, by_index, graph, rules, cell = args[:5]
            polyhedra_args = [
                _sites_json(centers),
                _sites_json(by_index.values()),
                _graph_rows(graph),
                [_rule_json(r) for r in rules],
                _cell_json(cell),
            ]
            checks.append(
                Check(
                    group="polyhedra",
                    case=name,
                    label=f"{name}: find_polyhedra {len(centers)} centres",
                    job={"fn": "findPolyhedraRows", "args": polyhedra_args},
                    expected={"ok": result},
                    verify=_verify_polyhedra,
                )
            )
            warned: list[str] = []  # the warnings of the same call, on a fresh list
            find_polyhedra(centers, by_index, graph, rules, cell, warned)
            checks.append(
                Check(
                    group="polywarn",
                    case=name,
                    label=f"{name}: find_polyhedra warnings",
                    job={"fn": "findPolyhedraWarnings", "args": polyhedra_args},
                    expected={"ok": warned},
                    verify=_verify_warnings,
                )
            )

        # applySelection: the fixture's own select as the pipeline ran it, then synthetic selects on the same inputs.
        shown, select, by_index, graph, rules, cell = recorded["apply_selection"][0][0]
        base = sorted(by_index.values(), key=lambda s: s.index)
        count = len(base)
        selects = [select] + [
            SelectConfig(**kwargs)
            for kwargs in (
                {"labels": [base[0].label]},
                {"indices": [0, count - 1]},
                {"shell_of": 0},
                {"shell_of": "0+1_0_0"},
                {"shell_of": "0+-1_0_1"},
                {"labels": [base[-1].label], "indices": [0], "shell_of": 0},
                {"indices": [count + 5]},
                {"shell_of": count + 5},
            )
        ]
        for chosen in selects:
            checks.append(
                Check(
                    group="selection",
                    case=name,
                    label=f"{name}: apply_selection {chosen.model_dump(mode='json')}",
                    job={
                        "fn": "applySelectionKeys",
                        "args": [
                            _sites_json(shown),
                            chosen.model_dump(mode="json"),
                            _sites_json(by_index.values()),
                            _graph_rows(graph),
                            [_rule_json(r) for r in poly_rules],
                            _cell_json(cell),
                        ],
                    },
                    expected=_outcome(functools.partial(apply_selection, shown, chosen, by_index, graph, rules, cell)),
                    verify=_verify_selection,
                )
            )

        # polyhedron_shell: centres by plain index, by image, and an index beyond the structure (an error).
        shown_for_shell = recorded["find_bonds"][0][0][0]
        for ref in (0, "0", "0+1_0_0", "0+-1_0_1", count - 1):
            checks.append(
                Check(
                    group="shell",
                    case=name,
                    label=f"{name}: polyhedron_shell {ref!r}",
                    job={
                        "fn": "polyhedronShellKeys",
                        "args": [
                            ref,
                            _sites_json(shown_for_shell),
                            _sites_json(by_index.values()),
                            _graph_rows(graph),
                            [_rule_json(r) for r in poly_rules],
                            _cell_json(cell),
                        ],
                    },
                    expected=_outcome(
                        functools.partial(polyhedron_shell, ref, shown_for_shell, by_index, graph, poly_rules, cell)
                    ),
                    verify=_verify_shell,
                )
            )
        bad_ref = count + 3
        checks.append(
            Check(
                group="shell",
                case=name,
                label=f"{name}: resolve_centre {bad_ref} (error)",
                job={
                    "fn": "resolveCentreKey",
                    "args": [bad_ref, _sites_json(shown_for_shell), _sites_json(by_index.values()), _cell_json(cell)],
                },
                expected=_outcome(functools.partial(resolve_centre, bad_ref, shown_for_shell, by_index, cell)),
                verify=None,  # an error on both sides; _verify compares the messages
            )
        )
    return checks


def _recording(original: Callable[..., Any], sink: list[Any]) -> Callable[..., Any]:
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        result = original(*args, **kwargs)
        sink.append((args, kwargs, result))
        return result

    return wrapped


def _parse_checks() -> list[Check]:
    from gemmy.compile.selection import parse_site_ref

    checks = []
    for ref in REFS:
        expected = _outcome(lambda ref=ref: parse_site_ref(ref))
        checks.append(
            Check(
                group="parse",
                case="",
                label=f"parse {ref!r}",
                job={"fn": "parseSiteRefRows", "args": [ref]},
                expected=expected,
                verify=_verify_parse,
            )
        )
    return checks


def _verify_parse(ts: list[Any], py: tuple[int, tuple[int, int, int] | None]) -> None:
    index, shift = ts[0], ts[1] or None  # no shift comes back as [] (JSON cannot carry null here)
    assert index == py[0]
    assert (tuple(shift) if shift else None) == py[1]


@functools.cache
def _suite() -> list[Check]:
    """Every check, with the TypeScript result filled in from one node process."""
    checks = _hull_checks() + _graph_checks() + _stage_checks() + _parse_checks()
    results = run([check.job for check in checks])
    for check, result in zip(checks, results, strict=True):
        check.ts = result
    return checks


def _verify(check: Check) -> None:
    ts, expected = check.ts, check.expected
    if "error" in expected:
        assert "error" in ts, f"{check.label}: TypeScript returned a value, Python raised {expected['type']}"
        assert ts["type"] == expected["type"], f"{check.label}: {ts['type']} vs {expected['type']}"
        if check.same_message:
            assert ts["error"] == expected["error"], f"{check.label}: messages differ"
        return
    assert "ok" in ts, f"{check.label}: TypeScript raised {ts.get('type')}: {ts.get('error')}"
    if check.verify is not None:
        check.verify(ts["ok"], expected["ok"])


def _select(group: str, case: str = "") -> list[Check]:
    return [check for check in _suite() if check.group == group and check.case == case]


@pytest.mark.parametrize("name", sorted(_hull_cases()) if DEPS_AVAILABLE else [])
def test_hull_faces_match_python(name: str) -> None:
    """Solids: the facets Qhull gives (the triangulation may differ) and outward winding. Flat clouds: the same
    triangles in the same order as Python; a collinear cloud gives none."""
    [check] = [c for c in _select("hull", name)]
    _verify(check)
    if name == "collinear":
        assert check.ts["ok"] == []
    if name in PLANAR_CORNERS:
        assert len(check.ts["ok"]) == PLANAR_CORNERS[name] - 2
    if name in FACETS:
        tolerance = FACET_TOLERANCE.get(name, TOLERANCE)
        assert len(_facets(check.ts["ok"], check.job["args"][0], tolerance)) == FACETS[name]


@pytest.mark.parametrize("name", CASES)
def test_neighbor_graph_matches_python(name: str) -> None:
    [check] = _select("graph", name)
    _verify(check)


@pytest.mark.parametrize("name", CASES)
def test_find_bonds_matches_python(name: str) -> None:
    checks = _select("bonds", name)
    assert checks
    for check in checks:
        _verify(check)


@pytest.mark.parametrize("name", CASES)
def test_closing_bonds_matches_python(name: str) -> None:
    for check in _select("closing", name):
        _verify(check)


@pytest.mark.parametrize("name", CASES)
def test_completion_matches_python(name: str) -> None:
    for check in _select("completion", name):
        _verify(check)


@pytest.mark.parametrize("name", CASES)
def test_polyhedra_match_python(name: str) -> None:
    checks = _select("polyhedra", name)
    for check in checks:
        _verify(check)


@pytest.mark.parametrize("name", CASES)
def test_selection_matches_python(name: str) -> None:
    checks = _select("selection", name)
    assert len(checks) >= 2
    for check in checks:
        _verify(check)


@pytest.mark.parametrize("name", CASES)
def test_polyhedron_shell_and_centre_match_python(name: str) -> None:
    for check in _select("shell", name):
        _verify(check)


@pytest.mark.parametrize("ref", REFS, ids=repr)
def test_parse_site_ref_matches_python(ref: int | str) -> None:
    [check] = [c for c in _suite() if c.group == "parse" and c.label == f"parse {ref!r}"]
    _verify(check)
