"""The element tables the page's default styles come from: one JSON file per colour scheme
(web/src/compile/schemes/) and the sphere radii (web/src/compile/element-styles.json). The default config
(configs/default.json) carries no element or example rules, and the Python compile never reads the tables: the page
alone uses their colours.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILE = ROOT / "web" / "src" / "compile"
RADII = COMPILE / "element-styles.json"
SCHEMES = COMPILE / "schemes"
REGISTRY = SCHEMES / "registry.ts"
DEFAULTS = ROOT / "configs" / "default.json"
GENERATOR = ROOT / "scripts" / "gen_element_styles.py"
SRC = ROOT / "src" / "gemmy"
HEX = re.compile(r"^#[0-9a-f]{6}$")


def _radii() -> dict[str, Any]:
    return json.loads(RADII.read_text(encoding="utf-8"))


def _scheme(scheme_id: str) -> dict[str, Any]:
    return json.loads((SCHEMES / f"{scheme_id}.json").read_text(encoding="utf-8"))


def _scheme_ids() -> list[str]:
    return sorted(path.stem for path in SCHEMES.glob("*.json"))


def _rgb(hex_colour: str) -> list[float]:
    """A scheme's "#rrggbb" as the 0-1 channels the page uses."""
    return [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]


def _generator():
    spec = importlib.util.spec_from_file_location("gen_element_styles", GENERATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# The dropdown order after Auto (web/src/compile/schemes/registry.ts), and the files that list them.
DROPDOWN = [
    "vesta",
    "jmol",
    "modern",
    "tailwind",
    "print",
    "dark",
    "pastel",
    "watercolour",
    "midcentury",
    "opencolor",
    "cvd",
    "nippon",
    "zhongguo",
    "hokusai",
    "klimt",
    "vangogh",
    "renoir",
]


def test_the_scheme_files_are_the_registry_themes() -> None:
    assert _scheme_ids() == sorted(DROPDOWN)


def test_the_registry_lists_the_dropdown_order() -> None:
    registry = REGISTRY.read_text(encoding="utf-8")
    listed = re.search(r"SCHEMES: readonly SchemeFile\[\] = \[(.*?)\];", registry, re.S)
    assert listed is not None
    assert [name.strip().rstrip(",") for name in listed.group(1).split()] == DROPDOWN


def test_every_scheme_is_a_named_file_with_a_source_and_every_element_a_colour() -> None:
    radii = _radii()["radii"]
    for scheme_id in _scheme_ids():
        scheme = _scheme(scheme_id)
        assert set(scheme) == {"id", "name", "description", "source", "colours"}, scheme_id
        assert scheme["id"] == scheme_id
        assert scheme["name"] and scheme["description"] and scheme["source"], scheme_id
        assert set(scheme["colours"]) == set(radii), scheme_id
        assert all(HEX.match(colour) for colour in scheme["colours"].values()), scheme_id


def test_every_scheme_file_is_listed_in_the_registry() -> None:
    """A theme file that the registry does not import would not show in the dropdown."""
    registry = REGISTRY.read_text(encoding="utf-8")
    for scheme_id in _scheme_ids():
        assert f'from "./{scheme_id}.json"' in registry, scheme_id


def test_every_element_has_a_positive_radius() -> None:
    radii = _radii()["radii"]
    assert len(radii) > 100
    assert all(radius > 0 for radius in radii.values())


def test_both_schemes_cover_the_elements_of_the_old_table() -> None:
    """The old table was the ASE Jmol palette, one entry per element with a covalent radius. Both schemes cover those
    elements, and the Jmol scheme is that palette (to the 0-255 rounding)."""
    from ase.data import chemical_symbols, covalent_radii
    from ase.data.colors import jmol_colors

    jmol = _scheme("jmol")["colours"]
    vesta = _scheme("vesta")["colours"]
    old = [
        (symbol, color)
        for symbol, color, covalent in zip(chemical_symbols, jmol_colors, covalent_radii, strict=False)
        if symbol != "X" and covalent == covalent
    ]
    assert len(old) > 100
    for symbol, color in old:
        assert symbol in vesta, symbol
        assert symbol in jmol, symbol
        assert _rgb(jmol[symbol]) == pytest.approx(list(color), abs=1 / 255 + 1e-9), symbol


def test_vesta_is_the_default_colour_of_the_named_elements() -> None:
    """The values pymatgen's colour file gives VESTA's elements.ini (0-255, written as hex)."""
    assert _scheme("vesta")["colours"]["Si"] == "#1b3bfa"
    assert _scheme("vesta")["colours"]["O"] == "#fe0300"
    assert _scheme("jmol")["colours"]["Si"] == "#f0c8a0"


def test_the_themes_are_the_theme_generator_output() -> None:
    """scripts/gen_themes.py writes the themes; rerunning it must reproduce the files byte for byte."""
    pytest.importorskip("coloraide", reason="coloraide is needed to run the theme generator")
    spec = importlib.util.spec_from_file_location("gen_themes", ROOT / "scripts" / "gen_themes.py")
    assert spec is not None and spec.loader is not None
    themes = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(themes)
    for theme_id in themes.THEMES:
        assert (SCHEMES / f"{theme_id}.json").read_text(encoding="utf-8") == themes.theme_text(theme_id), theme_id


def test_the_files_are_the_generator_output() -> None:
    """The files are regenerated from pymatgen's colour file, which this environment may not have."""
    generator = _generator()
    try:
        path = generator.colour_file()
    except SystemExit:
        pytest.skip("pymatgen is not installed (uv run --with pymatgen)")
    if not path.exists():
        pytest.skip("pymatgen's colour file is not where its package puts it")
    for output, text in generator.outputs(generator.read_sections(path)).items():
        assert output.read_text(encoding="utf-8") == text, output


def test_the_vesta_source_names_pymatgen_and_vesta() -> None:
    source = _scheme("vesta")["source"]
    assert "pymatgen" in source
    assert "MIT" in source
    assert "VESTA" in source


def test_the_radii_name_their_source_and_the_factor() -> None:
    assert "ase.data.covalent_radii" in _radii()["source"]
    assert "radius_factor" in _radii() and _radii()["radius_factor"] == 0.5


@pytest.mark.parametrize("symbol", ["H", "C", "O", "Si", "Na"])
def test_radii_are_the_covalent_radius_times_the_named_factor(symbol: str) -> None:
    from ase.data import chemical_symbols, covalent_radii

    covalent = covalent_radii[chemical_symbols.index(symbol)]
    expected = covalent * _radii()["radius_factor"]
    assert _radii()["radii"][symbol] == pytest.approx(expected, abs=1e-3)


def test_the_python_compile_does_not_read_the_page_tables() -> None:
    for path in SRC.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "element-styles" not in text, path
        assert "schemes/" not in text, path


def test_the_default_config_has_no_element_or_example_rules() -> None:
    defaults = json.loads(DEFAULTS.read_text(encoding="utf-8"))
    assert set(defaults) == {"materials", "cells", "displacements"}
    assert defaults["cells"]["supercell"] == [1, 1, 1]
    assert defaults["cells"]["periodic"] == [True, True, True]
    assert defaults["displacements"]["enabled"] is False
