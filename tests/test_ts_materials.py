"""Parity of the TypeScript materials, number format and element style (web/src/compile/materials.ts) with
gemmy.compile.materials (ghost_color, MaterialTable, style_for, visible_sites). Each group runs its jobs in one node
process (tests/ts_bundle.py).
"""

from __future__ import annotations

import dataclasses
import importlib.util
import math
from typing import Any

import pytest

from ts_bundle import available, run

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
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, float) and math.isnan(value):
        return "NaN"
    return value


def _python_model(raw: Any) -> Any:
    from gemmy.config import scene_config_from_dict

    return normalize(scene_config_from_dict(raw).model_dump())


GHOST_COLOURS = [
    (0.2, 0.6, 1.0, 0.25),  # the default polyhedron colour: blue is the maximum
    (0.9, 0.15, 0.15, 1.0),  # red maximum
    (0.1, 0.9, 0.3, 1.0),  # green maximum
    (0.3, 0.2, 0.9, 1.0),  # blue maximum with a small red
    (0.9, 0.1, 0.5, 1.0),  # red maximum with a negative hue before the modulo
    (0.5, 0.5, 0.5, 1.0),  # grey: saturation zero
    (0.0, 0.0, 0.0, 1.0),  # black
    (0.7, 0.8, 0.95, 1.0),
]
GHOST_PARAMETERS = [(0.35, 0.3, 0.95), (0.2, 0.5, 0.4), (0.5, 0.1, 0.1)]


def test_ghost_color_matches_colorsys_exactly() -> None:
    from gemmy.compile.materials import ghost_color

    cases = [(colour, *params) for colour in GHOST_COLOURS for params in GHOST_PARAMETERS]
    results = run([{"fn": "ghostColor", "args": [list(colour), *params]} for colour, *params in cases])
    for (colour, *params), result in zip(cases, results, strict=True):
        assert result["ok"] == list(ghost_color(colour, *params)), (colour, params)


FORMAT_VALUES = [
    0.00005,
    -0.0,
    -0.00001,
    1e-5,
    0.03125,  # an exact tie: Python rounds to even (0.0312)
    0.09375,  # an exact tie with an odd digit before it (0.0938)
    0.12345,
    0.12335,
    0.5,
    1.0,
    0.1,
    1 / 3,
    0.99995,
    0.00015,
    -0.00025,
    2.5e-5,
    123.45675,
    1e21,
    1e-300,
]


def test_four_decimal_format_matches_python() -> None:
    results = run([{"fn": "formatFixed4", "args": [value]} for value in FORMAT_VALUES])
    for value, result in zip(FORMAT_VALUES, results, strict=True):
        assert result["ok"] == f"{value:.4f}", value


def test_material_table_resolves_like_python() -> None:
    from gemmy.compile.materials import MaterialTable
    from gemmy.scene import MaterialStyle

    base = _python_model({})["materials"]
    # Two names that the variant ids of the sequence below would take, so the variant gets _2.
    base["matte_0p5000_0p0000_0p0000_1p0000"] = base["glass"]
    base["matte_0p5000_0p0000_0p0000_1p0000_1"] = base["glass"]
    base["my.mat"] = base["bond"]
    sequence = [
        ["matte", [0.8, 0.8, 0.8, 1.0]],  # the base itself
        ["matte", [0.5, 0.0, 0.0, 1.0]],  # a new variant (its id is taken twice: _2)
        ["matte", [0.5, 0.0, 0.0, 1.0]],  # cached
        ["glass", [0.2, 0.4, 0.6, 0.2]],  # alpha from the colour
        ["polyhedron", [0.2, 0.6, 1.0, 0.25]],  # equal to the base
        ["newmat", [1.0, -0.0, 0.00005, 1.0]],  # a base that does not exist yet; -0.0 and 0.00005 in the id
        ["my.mat", [0.1, 0.2, 0.3, 1.0]],  # dots in the base name are replaced too
        ["matte", [0.5, 0.0, 0.0, 0.5]],
    ]
    python_table = MaterialTable(
        {name: MaterialStyle(**{**style, "base_color": tuple(style["base_color"])}) for name, style in base.items()}
    )
    expected_ids = [python_table.resolve(material, tuple(color)) for material, color in sequence]
    expected_materials = {name: normalize(dataclasses.asdict(style)) for name, style in python_table.materials.items()}
    assert expected_ids[1] == "matte_0p5000_0p0000_0p0000_1p0000_2"

    result = run([{"fn": "materialSequence", "args": [base, sequence]}])[0]
    assert "ok" in result, result.get("error")
    assert result["ok"]["ids"] == expected_ids
    assert result["ok"]["materials"] == expected_materials


def _site(index: int, element: str, label: str) -> dict[str, Any]:
    return {
        "index": index,
        "element": element,
        "label": label,
        "fractional": [0.0, 0.0, 0.0],
        "position": [0.0, 0.0, 0.0],
        "shift": [0, 0, 0],
        "copy": False,
    }


STYLE_CONFIG = {
    "elements": {
        "Fe1": {"color": [1.0, 0.0, 0.0]},
        "Fe": {"radius": 0.5},
        "default": {"radius": 0.2},
        "O": {"visible": False},
        "Si": {"representation": "hidden"},
    }
}
STYLE_SITES = [
    _site(0, "Fe", "Fe1"),  # the label's style wins
    _site(1, "Fe", "Fe2"),  # no Fe2 style: "default" (the element's Fe style is not used for a label)
    _site(2, "Ca", "Ca"),  # only "default" applies
    _site(3, "O", "O"),  # hidden by visible: false
    _site(4, "Si", "Si"),  # hidden by representation: hidden
    _site(5, "X", "constructor"),  # a prototype name is not a style key
    _site(6, "Au", "Au"),
    _site(7, "Fe", "Fe"),  # the label "Fe" has its own style
]


def test_style_and_visibility_match_python() -> None:
    from gemmy.compile.materials import style_for, visible_sites
    from gemmy.compile.sites import Site
    from gemmy.config import scene_config_from_dict

    python_config = scene_config_from_dict(STYLE_CONFIG)
    sites = [Site(s["index"], s["element"], s["label"], (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)) for s in STYLE_SITES]
    expected_styles = [normalize(style_for(python_config, site).model_dump()) for site in sites]
    expected_visible = [site.index for site in visible_sites(python_config, sites)]
    assert expected_visible == [0, 1, 2, 5, 6, 7]

    config = _python_model(STYLE_CONFIG)
    jobs = [{"fn": "styleFor", "args": [config, site]} for site in STYLE_SITES]
    jobs.append({"fn": "visibleSites", "args": [config, STYLE_SITES]})
    results = run(jobs)
    for index, expected in enumerate(expected_styles):
        assert results[index]["ok"] == expected, STYLE_SITES[index]
    assert [site["index"] for site in results[-1]["ok"]] == expected_visible


# The raw text, not a dict: a JSON -0 reads as the integer 0 in Python and as -0 in JavaScript, and a TOML -0.0 is a
# negative zero on both sides. Both must give one variant id (materials._variant_id) and one table.
SIGNED_ZERO_TEXTS = [
    ("config.json", '{"elements":{"H":{"color":[-0,0.2,0.3]}}}'),
    ("config.toml", "[elements.H]\ncolor = [-0.0, 0.2, 0.3]\n"),
]


@pytest.mark.parametrize("name, text", SIGNED_ZERO_TEXTS, ids=[name for name, _ in SIGNED_ZERO_TEXTS])
def test_negative_zero_in_a_colour_gets_the_same_variant_as_python(name: str, text: str) -> None:
    import json
    import tomllib

    from gemmy.compile.materials import MaterialTable
    from gemmy.config import scene_config_from_dict

    raw = tomllib.loads(text) if name.endswith(".toml") else json.loads(text)
    config = scene_config_from_dict(raw)
    table = MaterialTable(config.materials)
    expected_ids = [table.resolve(style.material, style.color) for style in config.elements.values()]
    expected_materials = {key: normalize(dataclasses.asdict(style)) for key, style in table.materials.items()}
    assert expected_ids == ["matte_0p0000_0p2000_0p3000_1p0000"]

    (result,) = run([{"fn": "elementMaterialsFromText", "args": [name, text]}])
    assert "ok" in result, result.get("error")
    assert result["ok"]["ids"] == expected_ids
    assert result["ok"]["materials"] == expected_materials
