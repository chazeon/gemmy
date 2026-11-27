"""Parity of the TypeScript site stages (web/src/compile: lattice, sites, labels, displacements) with gemmy.compile.
Lattice functions on edge cases; the site pipeline (build, labels, snap, wrap, display box, limits) on every fixture,
a few variants and the small examples; label and displacement files, read and applied. Each group runs its jobs in
one node process (tests/ts_bundle.py)."""

from __future__ import annotations

import atexit
import functools
import importlib.util
import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from ts_bundle import available, run

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
STRUCTURES = FIXTURES / "structures"
EXAMPLES = ROOT / "examples"
TOLERANCE = 1e-9
# Examples above 5000 atoms: their reads take seconds, so they run under -m slow (as in test_ts_stages.py).
LARGE_EXAMPLES = frozenset({"apoferritin", "nav17-6j8i", "nucleosome-1kx5"})
CELL = [[2.0, 0.0, 0.0], [0.5, 3.0, 0.0], [0.1, 0.2, 4.0]]

DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("ase", "numpy"))
pytestmark = [
    pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)"),
    pytest.mark.skipif(not DEPS_AVAILABLE, reason="ASE and NumPy are required for the parity tests"),
]

# Scratch files for the Python side, which reads label and displacement files by path.
_SCRATCH = Path(tempfile.mkdtemp(prefix="gemmy-ts-sites-"))
atexit.register(shutil.rmtree, _SCRATCH, ignore_errors=True)


def _job(fn: str, *args: Any) -> dict[str, Any]:
    return {"fn": fn, "args": list(args)}


def _file(name: str, text: str) -> Path:
    path = _SCRATCH / name
    path.write_text(text, encoding="utf-8")
    return path


def _match(ts: Any, py: Any, path: str = "value") -> None:
    """The TypeScript JSON result equals the Python value: floats within TOLERANCE, everything else exactly."""
    if py is None or isinstance(py, (bool, str)):
        assert ts == py, f"{path}: {ts!r} != {py!r}"
    elif isinstance(py, (int, float)):
        assert isinstance(ts, (int, float)) and not isinstance(ts, bool), f"{path}: {ts!r} is not a number"
        assert abs(ts - py) <= TOLERANCE, f"{path}: {ts!r} != {py!r}"
    elif isinstance(py, (list, tuple)):
        assert isinstance(ts, list) and len(ts) == len(py), f"{path}: {ts!r} != {py!r}"
        for k, (a, b) in enumerate(zip(ts, py, strict=True)):
            _match(a, b, f"{path}[{k}]")
    elif isinstance(py, dict):
        assert isinstance(ts, dict) and sorted(ts) == sorted(py), f"{path}: keys {sorted(ts)} != {sorted(py)}"
        for key in py:
            _match(ts[key], py[key], f"{path}.{key}")
    else:
        raise TypeError(f"cannot compare {type(py).__name__}")


def _site_dict(site: Any) -> dict[str, Any]:
    return {
        "index": site.index,
        "element": site.element,
        "label": site.label,
        "fractional": list(site.fractional),
        "position": list(site.position),
        "shift": list(site.shift),
        "copy": site.copy,
    }


# ---------------------------------------------------------------------------
# lattice.py
# ---------------------------------------------------------------------------

SNAP_CASES = [
    # 0.99999 and -1e-6 snap; 0.5 does not (its nearest integer, 0, is 0.5 away, beyond eps).
    ([0.99999, 0.5, -1e-6], [1.0, 2.0, 3.0], 1e-4),
    # Round half to even: 2.5 -> 2, 3.5 -> 4, -2.5 -> -2 (eps wide enough to reach a half).
    ([2.5, 3.5, -2.5], [0.0, 0.0, 0.0], 0.6),
    # Exactly eps away snaps; just beyond does not.
    ([0.0001, 0.0, 0.0], [0.0, 0.0, 0.0], 1e-4),
    ([0.00011, 0.0, 0.0], [0.0, 0.0, 0.0], 1e-4),
    # Nothing moves: null in Python, {moved: false} from the TS test wrapper.
    ([0.5, 0.25, 0.1], [0.0, 0.0, 0.0], 1e-4),
    ([1.0, 2.0, 3.0], [0.0, 0.0, 0.0], 1e-4),
]

WRAP_CASES = [
    ([-0.5, 1.0, 2.7], [True, False, True]),
    ([-1e-6, 0.99999, 0.0], [True, True, True]),
    ([0.0, 0.0, 0.0], [True, True, True]),
    ([-2.0, 3.5, -0.25], [False, False, False]),
]

# (fractional, box, periodic, eps): the shifts of each boundary copy.
BOX_SHIFT_CASES = [
    ([0.0, 0.0, 0.0], {}, [True, True, True], 1e-4),  # a corner: 8 copies
    ([0.5, 0.0, 0.3], {}, [True, True, False], 1e-4),  # a face: 2 copies
    ([1.0, 0.5, 0.0], {}, [True, True, True], 1e-4),  # ordering: origin first, then lexicographic
    ([0.5, 0.0, 0.0], {}, [True, True, True], 1e-4),
    ([0.7, 0.2, 0.2], {"x": [0.0, 0.5]}, [False, False, False], 1e-4),  # outside an explicit non-periodic axis
    ([0.0, 0.0, 0.0], {"x": [0.2, 0.6]}, [True, True, True], 1e-4),  # the periodic image lands outside the box
    ([0.3, 0.3, 0.3], {"x": [0.0, 1.0], "y": [0.25, 0.5]}, [True, False, True], 1e-4),
    ([0.3, 0.6, 0.3], {"y": [0.25, 0.5]}, [True, False, True], 1e-4),  # outside, non-periodic and explicit
    ([0.3, 0.6, 0.3], {"y": [0.25, 0.5]}, [True, True, True], 1e-4),  # outside, periodic: no image in the box
    ([1.0 - 1e-5, 0.0, 0.0], {}, [True, True, True], 1e-4),  # within eps of the far face
]

AXIS_CASES = [
    (0.0, 0.0, 1.0, 1e-4, True, True),
    (0.5, 0.0, 1.0, 1e-4, False, True),
    (1.5, 0.0, 1.0, 1e-4, False, True),
    (1.5, 0.0, 1.0, 1e-4, False, False),
    (1.5, 0.0, 1.0, 1e-4, True, True),
]

LIMIT_CASES = [
    ([0.5, 0.0, 0.0], {"x": [0.0, 1.0]}),
    ([1.5, 0.0, 0.0], {"x": [0.0, 1.0]}),
    ([1.0, 0.0, 0.0], {"x": [0.0, 1.0]}),  # inclusive
    ([0.0, 5.0, 0.0], None),
    ([0.0, 5.0, 0.0], {}),
    ([0.0, 5.0, 0.0], {"y": [0.0, 1.0]}),
]

BOX_CASES = [{}, {"y": [0.2, 0.4]}, {"x": [0.1, 0.6], "z": [0.0, 0.5]}]


@functools.cache
def _lattice_results() -> list[dict[str, Any]]:
    """Every lattice job in one node process, each with the Python value it must match (None is kept as None)."""
    import numpy as np

    from gemmy.compile import lattice

    cell = np.asarray(CELL, dtype=float)
    jobs: list[dict[str, Any]] = []
    expected: list[Any] = []
    for fractional, position, eps in SNAP_CASES:
        jobs.append(_job("snapOutcome", fractional, position, CELL, eps))
        moved = lattice.snap(tuple(fractional), tuple(position), cell, eps)
        expected.append(
            {"moved": False} if moved is None else {"moved": True, "fractional": moved[0], "position": moved[1]}
        )
    for fractional, periodic in WRAP_CASES:
        jobs.append(_job("wrapShift", fractional, periodic))
        expected.append(list(lattice.wrap_shift(tuple(fractional), tuple(periodic))))
    for fractional, box, periodic, eps in BOX_SHIFT_CASES:
        jobs.append(_job("boxShifts", fractional, box, periodic, eps))
        expected.append([list(n) for n in lattice.box_shifts(tuple(fractional), box, tuple(periodic), eps)])
    for args in AXIS_CASES:
        jobs.append(_job("axisRange", "x", *args))
        first, last = lattice._axis_range("x", *args)
        expected.append({"first": first, "last": last})
    for point, limits in LIMIT_CASES:
        jobs.append(_job("withinLimits", point, limits))
        expected.append(lattice.within_limits(tuple(point), limits))
    for box in BOX_CASES:
        jobs.append(_job("resolveBox", box))
        expected.append([list(r) for r in lattice.resolve_box(box)])
        jobs.append(_job("cellBox", CELL, box))
        origin, edges = lattice.cell_box(cell, box)
        expected.append({"origin": list(origin), "vectors": [list(e) for e in edges]})
    results = run(jobs)
    return [{"ts": result, "py": value} for result, value in zip(results, expected, strict=True)]


def test_snap_wrap_box_shifts_axis_shifts_and_limits_match_python() -> None:
    for k, item in enumerate(_lattice_results()):
        assert "ok" in item["ts"], item["ts"]
        _match(item["ts"]["ok"], item["py"], f"lattice job {k}")


def test_a_box_too_large_for_the_page_is_refused_before_any_copy_is_made() -> None:
    """The billion-image box (1000 images on each axis) and the 1e16 range are errors on both sides, at once."""
    too_big = {"x": [0, 1000], "y": [0, 1000], "z": [0, 1000]}
    cases = [
        _job("boxShifts", [0.5, 0.5, 0.5], too_big, [True, True, True], 1e-6),
        _job("boxShifts", [0.5, 0.5, 0.5], {"x": [1e16, 1e16]}, [True, False, False], 1e-6),
        _job("boxShifts", [0.5, 0.5, 0.5], {"x": [0, 1e16]}, [True, False, False], 1e-6),
    ]
    refused = run(cases)
    for result in refused:
        assert result["type"] == "Error", result
    assert "MAX_BOX_SITES" in refused[0]["error"]
    assert "past" in refused[1]["error"] and "past" in refused[2]["error"]
    (normal,) = run([_job("boxShifts", [0.5, 0.5, 0.5], {"x": [0, 2]}, [True, True, True], 1e-6)])
    assert normal["ok"][0] == [0, 0, 0] and len(normal["ok"]) == 2


def test_a_total_box_over_the_site_budget_is_refused() -> None:
    """Each site makes 8 copies: 30,000 sites make 240,000 sites in all, past MAX_BOX_SITES, so none is made."""
    sites = [
        {
            "index": i,
            "element": "C",
            "label": "C",
            "fractional": [0.5, 0.5, 0.5],
            "position": [1.0, 1.0, 1.0],
            "shift": [0, 0, 0],
            "copy": False,
        }
        for i in range(30_000)
    ]
    (result,) = run([_job("baseBox", sites, CELL, {"x": [0, 2], "y": [0, 2], "z": [0, 2]}, [True, True, True], 1e-6)])
    assert result["type"] == "Error", result
    assert "MAX_BOX_SITES" in result["error"]


def test_snap_rounds_half_to_even() -> None:
    # np.round rounds 2.5 to 2 where Math.round would give 3; the match above checks it too, this states it.
    (result,) = run([_job("snapOutcome", [2.5, 0.0, 0.0], [0.0, 0.0, 0.0], CELL, 0.6)])
    assert result["ok"]["fractional"][0] == 2.0


# ---------------------------------------------------------------------------
# sites.py helpers
# ---------------------------------------------------------------------------


def test_site_ref_and_name_matches_match_python() -> None:
    from gemmy.compile.sites import Site, name_matches, site_ref

    fe = Site(index=3, element="Fe", label="Fe1", fractional=(0.0, 0.0, 0.0), position=(0.0, 0.0, 0.0))
    image = Site(
        index=5, element="O", label="O", fractional=(0.0, 0.0, 0.0), position=(0.0, 0.0, 0.0), shift=(1, 0, -1)
    )
    shifted = Site(index=2, element="O", label="O", fractional=(0.0, 0.0, 0.0), position=(0.0, 0.0, 0.0))
    refs = [(image, (1, 0, 0)), (fe, (0, 0, 0)), (shifted, (1, -1, 0))]
    names = ("Fe1", "Fe", "Fe2", "O")
    results = run(
        [_job("siteRef", _site_dict(site), list(wrap)) for site, wrap in refs]
        + [_job("nameMatchesOutcome", name, _site_dict(fe)) for name in names]
    )
    for (site, wrap), result in zip(refs, results[: len(refs)], strict=True):
        assert result == {"ok": site_ref(site, wrap)}
    assert results[0] == {"ok": "5+0_0_-1"}
    assert results[2] == {"ok": "2+-1_1_0"}
    # labels only: "Fe" (the element) does not match the atom labelled Fe1
    assert [result["ok"]["matched"] for result in results[len(refs) :]] == [name_matches(name, fe) for name in names]
    assert [result["ok"]["matched"] for result in results[len(refs) :]] == [True, False, False, False]


# ---------------------------------------------------------------------------
# The site pipeline on every fixture, a few variants and the small examples
# ---------------------------------------------------------------------------

# A JSON label file: a range, a list, and an index-keyed entry.
LABEL_TEXT = json.dumps({"Lab": [0, "1-2"], "3": "Z"})
STAGES = ("built", "snapped", "wrapped", "boxed", "selected")


@dataclass(frozen=True)
class StageCase:
    name: str
    structure: Path
    cells: dict[str, Any]  # the config's cells table, as written
    labels: str | None = None  # a JSON label file's text


def _example_case(name: str) -> StageCase:
    directory = EXAMPLES / name
    config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
    return StageCase(f"example-{name}", directory / config["structure"], config.get("cells", {}))


def _fixture_cells(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name / "config.json").read_text(encoding="utf-8")).get("cells", {})


def _small_cases() -> list[StageCase]:
    cases = [
        StageCase(name, FIXTURES / name / "POSCAR", _fixture_cells(name))
        for name in ("box", "corner_poly", "hydroxide", "labels", "rocksalt", "select_shell", "wrap")
    ]
    cases.append(StageCase("wrap-alt", FIXTURES / "wrap" / "POSCAR.alt", _fixture_cells("wrap")))
    cases += [
        StageCase(name, STRUCTURES / name, {})
        for name in ("vasp4/POSCAR", "vasp5-pv/POSCAR", "cif/NaCl-fm3m.cif", "extxyz-x/x-species.extxyz")
    ]
    # Synthetic atoms outside [0, 1): wrapped into the cell (-0.25 -> 0.75, 1.3 -> 0.3), 0.99999 snapped to 1 then 0.
    outside = "outside\n1.0\n4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 4.0\nMg O\n1 2\nDirect\n"
    outside += "-0.25 1.3 0.99999\n0.5 -1e-6 -1.5\n0.0 0.0 0.0\n"
    skewed = "skewed\n1.0\n4.0 0.0 0.0\n1.0 3.5 0.0\n0.5 0.5 4.5\nMg O\n1 2\nDirect\n"
    skewed += "0.2 -0.7 1.6\n-1.25 0.5 0.5\n0.9 0.9 -0.1\n"
    cases += [
        StageCase("outside-cubic", _file("outside-POSCAR", outside), {"supercell": [2, 1, 1], "periodic": [True] * 3}),
        StageCase(
            "outside-partial",
            _file("skewed-POSCAR", skewed),
            {"periodic": [True, False, True], "box": {"x": [0.0, 0.5]}, "limits": {"x": [-1.0, 4.0]}},
        ),
    ]
    rocksalt = FIXTURES / "rocksalt" / "POSCAR"
    super2 = {"supercell": [2, 1, 1], "periodic": [True, True, True]}
    cases += [
        StageCase("rocksalt-2x1x1", rocksalt, super2),
        StageCase("rocksalt-labels", rocksalt, _fixture_cells("rocksalt"), LABEL_TEXT),
        StageCase("rocksalt-2x1x1-labels", rocksalt, super2, LABEL_TEXT),
        StageCase("wrap-labels", FIXTURES / "wrap" / "POSCAR", {}, LABEL_TEXT),
    ]
    cases += [
        _example_case(path.parent.name)
        for path in sorted(EXAMPLES.glob("*/config.json"))
        if path.parent.name not in LARGE_EXAMPLES
    ]
    return cases


CASES = {case.name: case for case in _small_cases()}
LARGE_CASES = {case.name: case for case in (_example_case(name) for name in sorted(LARGE_EXAMPLES))}


@functools.cache
def _python_stages(name: str) -> dict[str, list[Any]]:
    """The Python pipeline in compile_structure's order for these stages, as Site objects per stage."""
    import numpy as np

    from gemmy.compile import labels, sites
    from gemmy.config import scene_config_from_dict
    from gemmy.readers import load_structure

    case = CASES.get(name) or LARGE_CASES[name]
    cell_config = scene_config_from_dict({"cells": case.cells}).cell
    structure = load_structure(case.structure)
    atoms = sites.repeat_structure(structure, cell_config.supercell, cell_config.periodic)
    cell = np.asarray(atoms.cell.array, dtype=float)
    label_map = labels.load_label_file(_file(f"{name}.labels.json", case.labels)) if case.labels else {}
    built = labels.apply_labels(sites.build_sites(structure, atoms), label_map, len(structure.atoms))
    snapped = sites.snap_sites(built, cell, cell_config.eps)
    wrapped = sites.wrap_sites(snapped, cell, cell_config.periodic)
    boxed = sites.base_box(wrapped, cell, cell_config.box, cell_config.periodic, cell_config.eps)
    selected = sites.select_sites(boxed, cell_config.cartesian_limits)
    return {"built": built, "snapped": snapped, "wrapped": wrapped, "boxed": boxed, "selected": selected}


def _site_job(case: StageCase) -> dict[str, Any]:
    return _job("siteStages", case.structure.read_text(encoding="utf-8"), case.structure.name, case.cells, case.labels)


@functools.cache
def _stage_results() -> dict[str, dict[str, Any]]:
    """The TypeScript stages for every small case, in one node process."""
    names = sorted(CASES)
    results = run([_site_job(CASES[name]) for name in names])
    out: dict[str, dict[str, Any]] = {}
    for name, result in zip(names, results, strict=True):
        assert "ok" in result, f"{name}: {result.get('error')}"
        out[name] = result["ok"]
    return out


def _assert_stages_match(name: str, ts: dict[str, Any]) -> None:
    py = _python_stages(name)
    for stage in STAGES:
        py_dicts = [_site_dict(site) for site in py[stage]]
        assert len(ts[stage]) == len(py_dicts), f"{name} {stage}: {len(ts[stage])} sites, Python {len(py_dicts)}"
        for k, (a, b) in enumerate(zip(ts[stage], py_dicts, strict=True)):
            _match(a, b, f"{name} {stage}[{k}]")


@pytest.mark.parametrize("name", sorted(CASES))
def test_site_pipeline_matches_python(name: str) -> None:
    _assert_stages_match(name, _stage_results()[name])


@pytest.mark.slow
def test_site_pipeline_matches_python_on_large_examples() -> None:
    names = sorted(LARGE_CASES)
    results = run([_site_job(LARGE_CASES[name]) for name in names])
    for name, result in zip(names, results, strict=True):
        assert "ok" in result, result
        _assert_stages_match(name, result["ok"])


# ---------------------------------------------------------------------------
# labels.py: the sidecar file (read and error messages) and applying it
# ---------------------------------------------------------------------------

# (file name, text). The expected outcome is Python's, checked against the TypeScript one.
LABEL_FILE_CASES = [
    ("labels.json", '{"3": "H1", "H2": [0, "1-2"]}'),
    ("labels.json", '{"labels": {"5": "A", "B": ["6-7", 9]}}'),
    ("labels.json", '{"C": ["7-5"]}'),  # an empty range
    ("labels.json", '{"D": [" 1 - 3 "]}'),  # Python's int() takes the spaces
    ("labels.json", '{"E": [true]}'),  # a bool is an int in Python: index 1
    ("labels.toml", '[labels]\n"5" = "X"\nH = [1, "2-3"]\n'),
    ("labels.json", '{"H": "Fe", "Fe": "x"}'),
    ("labels.json", '{"H": 3.5}'),
    ("labels.json", '{"H": ["a-b"]}'),
    ("labels.json", '{"H": [2.5]}'),
    ("labels.json", '{"H": ["-3"]}'),
    ("labels.json", '{"H": [[1]]}'),
    ("labels.json", '{"H": [{"a": 1}]}'),
    ("labels.json", '{"H": null}'),
    ("labels.json", "[1, 2]"),
    ("labels.json", '{"labels": 5}'),
    # One atom, two labels: an error. The same label twice is not.
    ("labels.json", '{"O1": [3], "3": "H2"}'),
    ("labels.json", '{"O": ["5-9"], "7": "A"}'),
    ("labels.json", '{"A": [9], "B": [4], "9": "C", "4": "D"}'),  # the lowest atom with two labels is named
    ("labels.json", '{"A": [1], "B": [1], "C": [1]}'),  # three labels: the first two, sorted
    ("labels.json", '{"O1": [3], "3": "O1", "O1b": []}'),  # the same label twice is accepted
    ("labels.json", '{"H": '),  # not JSON: the parser's own message differs, the prefix must not
    ("labels.toml", "x = "),  # not TOML: likewise
]


def _python_outcome(call: Any) -> dict[str, Any]:
    from gemmy.compile.labels import LabelError

    try:
        return {"ok": call()}
    except LabelError as exc:
        return {"error": str(exc), "type": "LabelError"}


def test_load_label_file_matches_python() -> None:
    from gemmy.compile.labels import load_label_file

    paths = [_file(f"label{k}-{name}", text) for k, (name, text) in enumerate(LABEL_FILE_CASES)]
    results = run([_job("loadLabelFile", str(path), path.read_text(encoding="utf-8")) for path in paths])
    for k, (path, result) in enumerate(zip(paths, results, strict=True)):
        expected = _python_outcome(lambda p=path: {str(int(i)): v for i, v in load_label_file(p).items()})
        text = LABEL_FILE_CASES[k][1]
        if "error" in expected:
            assert "error" in result, f"{text!r}: TypeScript read it, Python says {expected['error']}"
            assert result["type"] == "LabelError"
            if text in ('{"H": ', "x = "):
                assert result["error"].startswith(f"label file: {path} is not valid "), result["error"]
                assert expected["error"].startswith(f"label file: {path} is not valid "), expected["error"]
            else:
                assert result["error"] == expected["error"], text
        else:
            assert "ok" in result, f"{text!r}: {result}"
            assert result["ok"] == expected["ok"], text


def test_apply_labels_matches_python_on_a_supercell() -> None:
    # A supercell atom takes the label of its base atom (index % base count): 20 sites over 8 base atoms here.
    from gemmy.compile.labels import apply_labels, load_label_file
    from gemmy.compile.sites import Site

    path = _file("apply.json", '{"Q": [0], "7": "R"}')
    labels = load_label_file(path)
    sites = [
        Site(index=i, element="O", label="O", fractional=(0.0, 0.0, 0.0), position=(0.0, 0.0, 0.0)) for i in range(20)
    ]
    expected = [_site_dict(site) for site in apply_labels(sites, labels, 8)]
    (result,) = run(
        [
            _job(
                "applyLabels",
                [_site_dict(site) for site in sites],
                {str(k): v for k, v in labels.items()},
                8,
            )
        ]
    )
    _match(result["ok"], expected, "applyLabels")
    assert result["ok"][8]["label"] == "Q" and result["ok"][15]["label"] == "R"


# ---------------------------------------------------------------------------
# displacements.py: the vectors file and the arrows
# ---------------------------------------------------------------------------

DISPLACEMENT_FILE_CASES = [
    '{"vectors": [{"index": 0, "dx": 0.02, "dy": 0.0, "dz": 0.0}]}',
    '{"vectors": [{"index": "4", "dx": "0.5", "dy": true, "dz": 2.9}, {"index": 2.7, "dx": 0, "dy": 0, "dz": 0}]}',
    '{"vectors": [{"index": 0, "dx": 1, "dy": 0, "dz": 0}, {"index": 0, "dx": 2, "dy": 0, "dz": 0}]}',
    '{"vectors": []}',
    '{"vectors": 3}',
    "[1]",
    '{"vectors": [{"index": 0, "dx": 1, "dy": 0}]}',
    '{"vectors": [[0, 0, 0]]}',
    '{"vectors": [{"index": 1, "dx": "x", "dy": 0, "dz": 0}]}',
    '{"vectors": [{"index": "1.0", "dx": 0, "dy": 0, "dz": 0}]}',
    '{"vectors": [{"index": null, "dx": 0, "dy": 0, "dz": 0}]}',
]


def test_load_displacement_file_matches_python() -> None:
    from gemmy.compile.displacements import DisplacementFileError, load_displacement_file

    paths = [_file(f"disp{k}.json", text) for k, text in enumerate(DISPLACEMENT_FILE_CASES)]
    results = run([_job("loadDisplacementFile", str(p), p.read_text(encoding="utf-8")) for p in paths])
    rocksalt = FIXTURES / "rocksalt" / "disp.json"
    (fixture,) = run([_job("loadDisplacementFile", str(rocksalt), rocksalt.read_text(encoding="utf-8"))])
    expected_fixture = {str(k): list(v) for k, v in load_displacement_file(rocksalt).items()}
    _match(fixture["ok"], expected_fixture, "rocksalt disp.json")
    for k, (path, result) in enumerate(zip(paths, results, strict=True)):
        text = DISPLACEMENT_FILE_CASES[k]
        try:
            value = load_displacement_file(path)
        except DisplacementFileError as exc:
            assert result.get("type") == "DisplacementFileError", (text, result)
            assert result["error"] == str(exc), text
        else:
            assert "ok" in result, (text, result)
            _match(result["ok"], {str(i): list(v) for i, v in value.items()}, text)


@pytest.mark.parametrize(
    "case",
    [
        ("rocksalt", "arrow", 5.0, None, "disp"),
        ("rocksalt", "LINE", 5.0, "first", "disp"),
        ("rocksalt-2x1x1", "bogus", 1.0, None, "disp"),
        ("rocksalt-2x1x1", "arrow", 2.0, "last", "disp"),
        ("rocksalt", "arrow", 1.0, "origin", "custom"),
    ],
    ids=["arrow", "line-inward", "supercell-modulo", "supercell-inward", "custom-vectors"],
)
def test_make_displacements_matches_python(case: tuple[str, str, float, str | None, str]) -> None:
    from gemmy.compile.displacements import load_displacement_file, make_displacements
    from gemmy.readers import load_structure

    name, style, scale, inward_rule, source = case
    shown = _python_stages(name)["selected"]
    base_count = len(load_structure(CASES[name].structure).atoms)
    if source == "disp":
        vectors = load_displacement_file(FIXTURES / "rocksalt" / "disp.json")
    else:
        # A zero vector is no arrow, and 1e-13 is zero within the 1e-12 norm limit; 7 is a per-atom vector.
        vectors = {0: (0.0, 0.0, 0.0), 4: (1e-13, 0.0, 0.0), 7: (0.1, 0.2, 0.3)}
    inward = {None: None, "first": shown[0].position, "last": shown[-1].position, "origin": (0.0, 0.0, 0.0)}
    inward_from = inward[inward_rule]
    expected = [
        {
            "site": _site_dict(arrow.site),
            "vector": list(arrow.vector),
            "mode": arrow.mode,
            "anchor": arrow.anchor,
        }
        for arrow in make_displacements(shown, vectors, base_count, scale, style, inward_from)
    ]
    (result,) = run(
        [
            _job(
                "makeDisplacements",
                [_site_dict(site) for site in shown],
                {str(k): list(v) for k, v in vectors.items()},
                base_count,
                scale,
                style,
                None if inward_from is None else list(inward_from),
            )
        ]
    )
    assert "ok" in result, result
    _match(result["ok"], expected, f"{case}")
    assert expected, "the case should draw arrows"
