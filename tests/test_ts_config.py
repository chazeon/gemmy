"""Parity of the TypeScript compile config (web/src/compile/config.ts, config-errors.ts, config-export.ts) with the
Python one: gemmy.config (scene_config_from_dict, load_scene_config). Each group runs its jobs in one node process
(tests/ts_bundle.py). The materials are in test_ts_materials.py.
"""

from __future__ import annotations

import importlib.util
import json
import math
import re
import tomllib
from pathlib import Path
from typing import Any

import pytest

from ts_bundle import available, run

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
EXAMPLES = ROOT / "examples"

DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("pydantic", "numpy"))
pytestmark = [
    pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)"),
    pytest.mark.skipif(not DEPS_AVAILABLE, reason="pydantic and NumPy are required for the parity tests"),
]


def normalize(value: Any) -> Any:
    """What the TS side can express: frozensets become sorted lists, tuples become lists, NaN becomes "NaN" (NaN is not
    equal to itself, so two models that both hold NaN would never compare equal)."""
    if isinstance(value, (frozenset, set)):
        return sorted(normalize(item) for item in value)
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        # Keys are strings on the TS side (JSON), so an integer key (a LAMMPS type) is compared as its string.
        return {str(key): normalize(item) for key, item in value.items()}
    if isinstance(value, float) and math.isnan(value):
        return "NaN"
    return value


def _id(path: Path) -> str:
    return str(path.relative_to(ROOT))


def _raw(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _python_model(raw: Any) -> Any:
    from gemmy.config import scene_config_from_dict

    return normalize(scene_config_from_dict(raw).model_dump())


def _python_file_model(path: Path) -> Any:
    from gemmy.config import load_scene_config

    return normalize(load_scene_config(path).model_dump())


def _python_toml_text_model(text: str) -> Any:
    return _python_model(tomllib.loads(text))


# Every config the compile reads: the default config, the fixture configs (JSON) and the examples (JSON and TOML).
JSON_CONFIGS = [
    ROOT / "configs" / "default.json",
    *sorted(FIXTURES.glob("*/config.json")),
    *sorted(EXAMPLES.glob("*/config.json")),
]
TOML_CONFIGS = sorted(EXAMPLES.glob("*/config.toml"))
ALL_CONFIGS = [*JSON_CONFIGS, *TOML_CONFIGS]

# Accepted inputs that stress the aliases, the coercions and the defaults (Python accepts all of them). They cross the
# bridge as JSON, so they hold no non-finite number (json.dumps writes those as tokens node's JSON.parse refuses).
EXTRA_ACCEPTED: list[dict[str, Any]] = [
    {"cell": {"supercell": [2, 1, 1], "limits": {"x": [3, 1]}}},  # limits are not order-checked, as in Python
    {"cells": {"cartesian_limits": {"y": [0, 1]}, "box": {"z": [0.25, 0.75]}, "periodic": [True, False, True]}},
    {
        "bonds": [
            {"a": "A", "b": "B", "min_distance": 1, "max_distance": 2.5, "style": "dotted", "complete": "polyhedra"}
        ],
        "polyhedra": [
            {
                "center": "A",
                "ligands": ["B", "B", "C"],
                "min": 1,
                "max": 2,
                "topology_mode": "TOPOLOGY_ADAPTIVE",
                "color": [0.1, 0.2, 0.3],
                "max_coordination": 6,
            }
        ],
    },
    {"materials": {"gold": {"base_color": [0.9, 0.7, 0.1], "metallic": 1}}},
    # A zero radius is allowed (it draws nothing): the element's and the bond's.
    {"elements": {"O": {"radius": 0}}, "bonds": [{"a": "A", "b": "B", "min": 1, "max": 2, "radius": 0}]},
    # Cluster rules: the sizes by kind (a ring 5 to 7, a molecule 4 and no limit), an explicit null, the atoms as a set,
    # and the distance keys under either name.
    {
        "clusters": [
            {"kind": "molecule", "atoms": ["H", "C", "C"], "min": 1.3, "max": 1.6},
            {"kind": "ring", "atoms": ["N"], "min_distance": 1, "max_distance": 2, "max_size": 9},
            {"kind": "ring", "atoms": ["C"], "min": 1.3, "max": 1.5, "min_size": 6, "name": "benzene"},
        ]
    },
    {"clusters": [{"kind": "molecule", "atoms": ["C"], "min": 1, "max": 2, "max_size": None}]},
    {"displacements": {"enabled": True, "data_file": "", "shell_of": ["5", "5+1_0_0", 7]}},
    {"highlight": {"shell_of": "5+1_0_0", "ghost_opacity": 1}, "select": {"shell_of": 3, "indices": [1, 2]}},
    {"labels": {"file": "labels.toml"}, "structure": "POSCAR"},
    # A key that is also a field name, where it is a name (an element, a material, a bond end) and not a field.
    {
        "elements": {"cell": {"radius": 0.5}},
        "materials": {"min_distance": {"roughness": 0.5}},
        "bonds": [{"a": "cell", "b": "min_distance", "min": 1, "max": 2}],
    },
    # Material names that are not integers keep their order in TS (test_material_order_matches_python).
    {"materials": {"zeta": {"roughness": 0.1}, "alpha": {"roughness": 0.2}, "matte": {"roughness": 0.9}}},
]

# Non-finite floats, as TOML writes them (inf, -inf, nan). pydantic takes them where a float is; a bound check fails
# NaN, as ge and le do. These cannot cross the bridge as dicts, so they are TOML text. The cell values (eps, box,
# limits), the rule distances (bonds, polyhedra, clusters) and a radius's NaN are refused (REJECTED_TOML), so they are
# not here.
NONFINITE_TOML = """\
[elements.O]
color = [inf, -inf, nan]

[highlight]
ghost_value = 0
"""

# (name, text) of the TOML configs above the dict inputs: the TS side reads the text, Python the same text.
TOML_TEXT_CASES = [("nonfinite.toml", NONFINITE_TOML)]


@pytest.fixture(scope="module")
def ts_models() -> list[Any]:
    """The TS parse of every config, in this order: the JSON configs, the TOML configs, the extra accepted inputs and
    the TOML text cases. Each is the TS model as JSON text (non-finite numbers as the Python tokens)."""
    jobs: list[dict[str, Any]] = [{"fn": "parseSceneConfigJson", "args": [_raw(path)]} for path in JSON_CONFIGS]
    jobs += [{"fn": "loadSceneConfigJson", "args": [p.name, p.read_text(encoding="utf-8")]} for p in TOML_CONFIGS]
    jobs += [{"fn": "parseSceneConfigJson", "args": [raw]} for raw in EXTRA_ACCEPTED]
    jobs += [{"fn": "loadSceneConfigJson", "args": [name, text]} for name, text in TOML_TEXT_CASES]
    results = run(jobs)
    for job, result in zip(jobs, results, strict=True):
        assert "ok" in result, f"{job['fn']}: {result.get('error')}"
    return [normalize(json.loads(result["ok"])) for result in results]


def _offset(group: str) -> int:
    """Where a group starts in ts_models."""
    starts = {
        "json": 0,
        "toml": len(JSON_CONFIGS),
        "extra": len(JSON_CONFIGS) + len(TOML_CONFIGS),
        "text": len(JSON_CONFIGS) + len(TOML_CONFIGS) + len(EXTRA_ACCEPTED),
    }
    return starts[group]


@pytest.mark.parametrize("path", JSON_CONFIGS, ids=_id)
def test_json_config_parses_like_python(path: Path, ts_models: list[Any]) -> None:
    assert ts_models[JSON_CONFIGS.index(path)] == _python_model(_raw(path))


@pytest.mark.parametrize("path", TOML_CONFIGS, ids=_id)
def test_toml_config_parses_like_python(path: Path, ts_models: list[Any]) -> None:
    assert ts_models[_offset("toml") + TOML_CONFIGS.index(path)] == _python_file_model(path)


@pytest.mark.parametrize("index", range(len(EXTRA_ACCEPTED)))
def test_accepted_inputs_parse_like_python(index: int, ts_models: list[Any]) -> None:
    assert ts_models[_offset("extra") + index] == _python_model(EXTRA_ACCEPTED[index])


@pytest.mark.parametrize("name, text", TOML_TEXT_CASES, ids=[name for name, _ in TOML_TEXT_CASES])
def test_non_finite_toml_parses_like_python(name: str, text: str, ts_models: list[Any]) -> None:
    index = _offset("text") + [n for n, _ in TOML_TEXT_CASES].index(name)
    assert ts_models[index] == _python_toml_text_model(text)


def test_material_order_matches_python_for_names_that_are_not_integers(ts_models: list[Any]) -> None:
    """A JS object keeps integer-like keys first, so integer-like material names are not in file order. The other names
    keep the order: the defaults, then the user's names as written (Python's dict order)."""
    from gemmy.config import scene_config_from_dict

    raw = EXTRA_ACCEPTED[-1]
    python_order = list(scene_config_from_dict(raw).materials)
    ts_order = list(ts_models[_offset("extra") + len(EXTRA_ACCEPTED) - 1]["materials"])
    assert python_order == ["matte", "bond", "polyhedron", "metal", "glass", "zeta", "alpha"]
    assert ts_order == python_order


def test_exports_read_back_in_python_and_ts_to_the_same_model() -> None:
    """Each config with no non-finite number, parsed in TS and exported (configToToml, configToJson), reads back to the
    same model in Python and in TS: the TOML and the JSON text each. The export runs inside node; a TS model holds
    non-finite numbers in some cases, which the runner refuses as a value, so the reload returns JSON text."""
    from gemmy.config import scene_config_from_dict

    jobs: list[dict[str, Any]] = []
    expected: list[Any] = []
    for path in JSON_CONFIGS:
        jobs.append({"fn": "exportConfigFromDict", "args": [_raw(path)]})
        expected.append(_python_model(_raw(path)))
    for path in TOML_CONFIGS:
        jobs.append({"fn": "exportConfigFromText", "args": [path.name, path.read_text(encoding="utf-8")]})
        expected.append(_python_file_model(path))
    for raw in EXTRA_ACCEPTED:
        jobs.append({"fn": "exportConfigFromDict", "args": [raw]})
        expected.append(_python_model(raw))
    results = run(jobs)
    reloads: list[dict[str, Any]] = []
    for index, (job, result) in enumerate(zip(jobs, results, strict=True)):
        assert "ok" in result, f"{job['args'][0]!r}: {result.get('error')}"
        exported = result["ok"]
        assert normalize(scene_config_from_dict(tomllib.loads(exported["toml"])).model_dump()) == expected[index]
        assert normalize(scene_config_from_dict(json.loads(exported["json"])).model_dump()) == expected[index]
        reloads.append({"fn": "loadSceneConfigJson", "args": ["config.toml", exported["toml"]]})
        reloads.append({"fn": "loadSceneConfigJson", "args": ["config.json", exported["json"]]})
    for index, result in enumerate(run(reloads)):
        assert "ok" in result, f"reload {index}: {result.get('error')}"
        assert normalize(json.loads(result["ok"])) == expected[index // 2], f"reload {index} differs in TS"


@pytest.mark.parametrize("name, text", TOML_TEXT_CASES, ids=[name for name, _ in TOML_TEXT_CASES])
def test_toml_export_keeps_non_finite_numbers_and_json_export_refuses_them(name: str, text: str) -> None:
    """The TOML export writes inf and nan, reads back in Python and in TS as the model of the original text. The JSON
    export of the same config is a ConfigError that names the first non-finite key (as the export writes it) and points
    to the TOML export."""
    expected = _python_toml_text_model(text)
    toml_job, json_job = run(
        [
            {"fn": "exportTomlFromText", "args": [name, text]},
            {"fn": "exportJsonFromText", "args": [name, text]},
        ]
    )
    assert "ok" in toml_job, toml_job.get("error")
    assert normalize(_python_model(tomllib.loads(toml_job["ok"]))) == expected
    (reload,) = run([{"fn": "loadSceneConfigJson", "args": ["config.toml", toml_job["ok"]]}])
    assert normalize(json.loads(reload["ok"])) == expected
    assert json_job["type"] == "ConfigError", json_job
    assert json_job["error"].startswith("elements.O.color.0: Infinity cannot be written as JSON"), json_job["error"]
    assert "TOML" in json_job["error"]


def test_export_keeps_names_that_are_not_aliases() -> None:
    """The export renames min_distance, max_distance, cartesian_limits and cell only where they are fields. An element
    called "cell" and a material called "min_distance" keep their names in the file."""
    (exported,) = run([{"fn": "exportConfigFromDict", "args": [EXTRA_ACCEPTED[-2]]}])
    data = json.loads(exported["ok"]["json"])
    assert list(data["elements"]) == ["cell"]
    assert list(data["materials"])[-1] == "min_distance"
    assert data["bonds"] == [
        {
            "a": "cell",
            "b": "min_distance",
            "min": 1,
            "max": 2,
            "radius": 0.08,
            "color": [0.7, 0.7, 0.7, 1],
            "material": "bond",
            "visible": True,
            "style": "solid",
            "complete": "ends",
        }
    ]
    assert "cells" in data and "cell" not in data


# Inputs both sides reject, with the key path the TS message must name. The path is the one pydantic reports, with the
# alias the user wrote (`bonds.0.min`, `cells.limits`), and the TS message starts with it as a whole.
REJECTED: list[tuple[str, dict[str, Any], str]] = [
    ("unknown top-level key", {"bogus": 1}, "bogus"),
    (
        "unknown nested key",
        {"bonds": [{"a": "Si", "b": "O", "min": 1, "max": 2, "colour": [1, 0, 0]}]},
        "bonds.0.colour",
    ),
    (
        "bad topology_mode",
        {"polyhedra": [{"center": "Al", "ligands": ["O"], "min": 1, "max": 2, "topology_mode": "fast"}]},
        "polyhedra.0.topology_mode",
    ),
    ("box low above high", {"cells": {"box": {"x": [0.9, 0.1]}}}, "cells.box"),
    ("cluster kind", {"clusters": [{"kind": "blob", "atoms": ["C"], "min": 1, "max": 2}]}, "clusters.0.kind"),
    ("cluster without atoms", {"clusters": [{"kind": "ring", "atoms": [], "min": 1, "max": 2}]}, "clusters.0.atoms"),
    ("two-element colour", {"elements": {"O": {"color": [1, 2]}}}, "elements.O.color"),
    ("empty ligands", {"polyhedra": [{"center": "Al", "ligands": [], "min": 1, "max": 2}]}, "polyhedra.0.ligands"),
    ("negative eps", {"cells": {"eps": -1}}, "cells.eps"),
    ("negative element radius", {"elements": {"O": {"radius": -0.1}}}, "elements.O.radius"),
    (
        "negative bond radius",
        {"bonds": [{"a": "A", "b": "B", "min": 1, "max": 2, "radius": -0.01}]},
        "bonds.0.radius",
    ),
    ("ghost_opacity above 1", {"highlight": {"ghost_opacity": 2}}, "highlight.ghost_opacity"),
    ("unknown limits axis", {"cells": {"limits": {"w": [0, 1]}}}, "cells.limits"),
    ("unknown material key", {"materials": {"x": {"colour": 1}}}, "materials.x.colour"),
    ("fractional shell_of", {"highlight": {"shell_of": 1.5}}, "highlight.shell_of"),
    (
        "both min and min_distance",
        {"bonds": [{"a": "A", "b": "B", "min": 1, "min_distance": 2, "max": 3}]},
        "bonds.0.min_distance",  # pydantic consumes min and reports the field name
    ),
    ("missing min is reported as min", {"bonds": [{"a": "A", "b": "B", "max": 3}]}, "bonds.0.min"),
    ("bond window reversed", {"bonds": [{"a": "A", "b": "B", "min": 2, "max": 1}]}, "bonds.0.max"),
    ("negative bond min", {"bonds": [{"a": "A", "b": "B", "min": -1, "max": 2}]}, "bonds.0.min"),
    (
        "cluster window reversed",
        {"clusters": [{"kind": "ring", "atoms": ["C"], "min_distance": 2, "max_distance": 1}]},
        "clusters.0.max_distance",
    ),
    ("cluster kind not a string", {"clusters": [{"kind": [], "atoms": ["C"], "min": 1, "max": 2}]}, "clusters.0.kind"),
    (
        "cluster atom not a name",
        {"clusters": [{"kind": "ring", "atoms": [{}], "min": 1, "max": 2}]},
        "clusters.0.atoms.0",
    ),
    (
        "ring without upper limit",
        {"clusters": [{"kind": "ring", "atoms": ["C"], "min": 1, "max": 2, "max_size": None}]},
        "clusters.0.max_size",
    ),
    (
        "ring above MAX_RING_SIZE",
        {"clusters": [{"kind": "ring", "atoms": ["C"], "min": 1, "max": 2, "max_size": 13}]},
        "clusters.0.max_size",
    ),
    (
        "ring max_size below min_size",
        {"clusters": [{"kind": "ring", "atoms": ["C"], "min": 1, "max": 2, "min_size": 6, "max_size": 5}]},
        "clusters.0.max_size",
    ),
    (
        "cluster size below 3",
        {"clusters": [{"kind": "molecule", "atoms": ["C"], "min": 1, "max": 2, "min_size": 2}]},
        "clusters.0.min_size",
    ),
    ("bad min under its alias", {"bonds": [{"a": "A", "b": "B", "min": [1], "max": 3}]}, "bonds.0.min"),
    (
        "min_distance under the field name",
        {"bonds": [{"a": "A", "b": "B", "min_distance": [1], "max": 3}]},
        "bonds.0.min_distance",
    ),
    ("unknown key under cells", {"cells": {"supercel": [1, 1, 1]}}, "cells.supercel"),
    ("cell written under its field name", {"cell": {"supercell": [1, "a", 1]}}, "cell.supercell.1"),
    (
        "cartesian_limits given by its field name",
        {"cells": {"cartesian_limits": {"w": [0, 1]}}},
        "cells.cartesian_limits",
    ),
]

# LAMMPS type maps (`types`). A label is checked by the element rule, the same in both sides
# (test_type_labels_name_the_same_element_as_python).
TYPE_MAPS_ACCEPTED: list[dict[str, Any]] = [
    {"types": {"1": "Mg", "2": "O"}},
    {"types": {"1": "Fe1", "2": "Fe_pv", "10": "Xc", "3": "D", "4": "fe"}},
    {"types": {}},
]

# Each label that names an element (the value is that element) or names none (None), in the types map.
TYPE_LABELS = {
    "Fe1": "Fe",
    "Fe_pv": "Fe",
    "Fe/abc": "Fe",
    "O2-": "O",
    "D1": "H",
    "T": "H",
    "fe": "Fe",
    "FE": "Fe",
    "Fe2O3": "Fe",
    "Hx": "H",
    "Xc": "X",
    "X_cen": "X",
    "X": "X",
    "Hf2": "Hf",
    "Zn2+": "Zn",
    "Qq": None,
    "Carbon": None,
    "Ab": None,
    "Xcen": None,
    "Hxx": None,
    "1": None,
    "": None,
    "_Fe": None,
}

# Non-finite inputs that are rejected: TOML text, since the bridge cannot carry a non-finite number as a dict.
REJECTED_TOML: list[tuple[str, str, str]] = [
    ("nan bond max", '[[bonds]]\na = "O"\nb = "H"\nmin = 1\nmax = nan\n', "bonds.0.max"),
    ("inf polyhedron max", '[[polyhedra]]\ncenter = "Al"\nligands = ["O"]\nmin = 1\nmax = inf\n', "polyhedra.0.max"),
    ("-inf cluster min", '[[clusters]]\nkind = "ring"\natoms = ["C"]\nmin = -inf\nmax = 2\n', "clusters.0.min"),
    ("nan element radius", "[elements.O]\nradius = nan\n", "elements.O.radius"),
    ("nan eps", "[cells]\neps = nan\n", "cells.eps"),
    ("inf eps", "[cells]\neps = inf\n", "cells.eps"),
    ("eps of a half cell", "[cells]\neps = 0.5\n", "cells.eps"),
    ("inf box range", "[cells]\nbox = { x = [0, inf] }\n", "cells.box.x.1"),
    ("-inf box range", "[cells]\nbox = { y = [-inf, 1] }\n", "cells.box.y.0"),
    ("nan cartesian limit", "[cells.limits]\nz = [0, nan]\n", "cells.limits.z.1"),
    ("inf ghost_value", "[highlight]\nghost_value = inf\n", "highlight.ghost_value"),
    ("type label that names no element", '[types]\n1 = "Qq"\n', "types.1"),
    ("type label that is a bare number", '[types]\n1 = "1"\n', "types.1"),
]


def _python_loc(exc: ValueError) -> str:
    """The first error's key path, as pydantic reports it (a ValidationError) or the message's start."""
    errors = getattr(exc, "errors", None)
    if errors is None:
        return str(exc)
    return ".".join(str(part) for part in errors()[0]["loc"])


def _is_under(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + ".")


@pytest.fixture(scope="module")
def rejections() -> list[dict[str, Any]]:
    return run([{"fn": "parseSceneConfigJson", "args": [raw]} for _, raw, _ in REJECTED])


@pytest.mark.parametrize("case", range(len(REJECTED)), ids=[name for name, _, _ in REJECTED])
def test_invalid_config_is_rejected_with_the_key_path(case: int, rejections: list[dict[str, Any]]) -> None:
    from gemmy.config import scene_config_from_dict

    name, raw, path = REJECTED[case]
    with pytest.raises(ValueError) as python_error:
        scene_config_from_dict(raw)
    python_path = _python_loc(python_error.value)
    assert _is_under(python_path, path), f"{name}: Python reports {python_path}"
    result = rejections[case]
    assert "error" in result, f"{name}: TS accepted the config"
    assert result["type"] == "ConfigError"
    assert result["error"].startswith(path + ": "), f"{name}: {result['error']}"


@pytest.mark.parametrize("case", range(len(REJECTED_TOML)), ids=[name for name, _, _ in REJECTED_TOML])
def test_invalid_toml_config_is_rejected_with_the_key_path(case: int) -> None:
    from gemmy.config import scene_config_from_dict

    name, text, path = REJECTED_TOML[case]
    with pytest.raises(ValueError) as python_error:
        scene_config_from_dict(tomllib.loads(text))
    assert _is_under(_python_loc(python_error.value), path), name
    (result,) = run([{"fn": "loadSceneConfigJson", "args": ["config.toml", text]}])
    assert result["type"] == "ConfigError", f"{name}: TS accepted the config"
    assert result["error"].startswith(path + ": "), f"{name}: {result['error']}"


def test_loading_a_config_that_is_not_an_object_is_rejected() -> None:
    result = run([{"fn": "loadSceneConfigJson", "args": ["list.json", "[1, 2]"]}])[0]
    assert result["type"] == "ConfigError"
    assert "must contain an object" in result["error"]


def test_ring_max_size_at_the_limit_parses_like_python() -> None:
    """A ring may have MAX_RING_SIZE members: the largest accepted value parses the same in both."""
    raw = {"clusters": [{"kind": "ring", "atoms": ["C"], "min": 1, "max": 2, "max_size": 12}]}
    result = run([{"fn": "parseSceneConfigJson", "args": [raw]}])[0]
    assert "ok" in result, result.get("error")
    assert normalize(json.loads(result["ok"])) == _python_model(raw)


@pytest.mark.parametrize("raw", TYPE_MAPS_ACCEPTED, ids=lambda raw: json.dumps(raw))
def test_type_maps_parse_like_python(raw: dict[str, Any]) -> None:
    (result,) = run([{"fn": "parseSceneConfigJson", "args": [raw]}])
    assert "ok" in result, result.get("error")
    assert normalize(json.loads(result["ok"])) == _python_model(raw)


def test_type_labels_name_the_same_element_as_python() -> None:
    """The element rule of a label is the Python one (gemmy.elements.element_of_label): each label is accepted in
    both sides with the same type map, or refused in both."""
    from gemmy.config import scene_config_from_dict

    jobs = [{"fn": "parseSceneConfigJson", "args": [{"types": {"1": label}}]} for label in TYPE_LABELS]
    results = run(jobs)
    for label, element, result in zip(TYPE_LABELS, TYPE_LABELS.values(), results, strict=True):
        try:
            python_ok = scene_config_from_dict({"types": {"1": label}}).types[1] == label
        except ValueError:
            python_ok = False
        assert python_ok == (element is not None), f"{label!r}: the table is out of step with Python"
        assert ("ok" in result) == python_ok, f"{label!r}: TS {result.get('error', 'accepts')}"


def test_type_map_exports_read_back_in_python_and_ts() -> None:
    """A type map exports (TOML and JSON, with its integer keys written as strings) and reads back to the same model."""
    raw = {"types": {"1": "Fe1", "12": "Ca"}}
    (exported,) = run([{"fn": "exportConfigFromDict", "args": [raw]}])
    assert "ok" in exported, exported.get("error")
    expected = _python_model(raw)
    assert normalize(_python_model(tomllib.loads(exported["ok"]["toml"]))) == expected
    assert normalize(_python_model(json.loads(exported["ok"]["json"]))) == expected
    reloads = run(
        [
            {"fn": "loadSceneConfigJson", "args": ["config.toml", exported["ok"]["toml"]]},
            {"fn": "loadSceneConfigJson", "args": ["config.json", exported["ok"]["json"]]},
        ]
    )
    for reload in reloads:
        assert "ok" in reload, reload.get("error")
        assert normalize(json.loads(reload["ok"])) == expected


# Type keys both sides refuse. The message names the key (`types.01: ...`), because pydantic reports the key-validator's
# error at `types` (the location is the field), so the TS message is checked for its start, as the Python one is.
TYPE_KEYS_REJECTED = ["0", "x", "01", "+1", " 1 ", "1.0", "1_0", "-1", "2147483648", "__proto__"]


@pytest.mark.parametrize("key", TYPE_KEYS_REJECTED)
def test_type_key_is_refused_by_both_sides_with_its_key_path(key: str) -> None:
    from gemmy.config import scene_config_from_dict

    raw = {"types": {key: "Mg"}}
    with pytest.raises(ValueError, match=re.escape(f"types.{key}: ")):
        scene_config_from_dict(raw)
    (result,) = run([{"fn": "parseSceneConfigJson", "args": [raw]}])
    assert result["type"] == "ConfigError", f"{key!r}: TS accepted the key"
    assert result["error"].startswith(f"types.{key}: "), result["error"]


def test_the_largest_type_key_is_accepted_by_both_sides() -> None:
    from gemmy.config import scene_config_from_dict

    assert scene_config_from_dict({"types": {"2147483647": "Mg"}}).types == {2147483647: "Mg"}
    (result,) = run([{"fn": "parseSceneConfigJson", "args": [{"types": {"2147483647": "Mg"}}]}])
    assert "ok" in result, result.get("error")


def test_chemical_symbols_are_ases() -> None:
    """The element symbols the TS label rule knows are ASE's chemical_symbols, in order (structure/elements.ts)."""
    from ase.data import chemical_symbols  # type: ignore

    (result,) = run([{"fn": "chemicalSymbols", "args": []}])
    assert result["ok"] == list(chemical_symbols)
