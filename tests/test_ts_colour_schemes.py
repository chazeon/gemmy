"""The page's element colour schemes (web/src/compile/colour-schemes.ts, structure-kind.ts, ui/colour-switch.ts), run in
the node bridge (tests/ts_bundle.py). The page's choice is Auto by default: a crystal takes the VESTA colours and a
molecule the Jmol colours (structure-kind.ts). VESTA or Jmol, when chosen, applies to every structure. Switching the
choice recolours the elements still in their scheme colour and the automatic polyhedra; a colour the user set stays.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

from cluster_structures import MOLECULE_NAME, benzene, molecule_extxyz
from ts_bundle import available, run

ROOT = Path(__file__).resolve().parents[1]
STISHOVITE = ROOT / "examples" / "stishovite" / "POSCAR"
SCHEMES = ROOT / "web" / "src" / "compile" / "schemes"
# The dropdown after Auto: each registered scheme's id and name (web/src/compile/schemes/registry.ts).
DROPDOWN_OPTIONS = [
    {"value": "vesta", "text": "VESTA"},
    {"value": "jmol", "text": "Jmol"},
    {"value": "modern", "text": "Modern"},
    {"value": "tailwind", "text": "Tailwind"},
    {"value": "print", "text": "Print"},
    {"value": "dark", "text": "Night"},
    {"value": "pastel", "text": "Pastel"},
    {"value": "watercolour", "text": "Watercolour"},
    {"value": "midcentury", "text": "Mid-century"},
    {"value": "opencolor", "text": "Open Color"},
    {"value": "cvd", "text": "Colour-blind safe"},
    {"value": "nippon", "text": "Nippon"},
    {"value": "zhongguo", "text": "Zhongguo"},
    {"value": "hokusai", "text": "Hokusai"},
    {"value": "klimt", "text": "Klimt"},
    {"value": "vangogh", "text": "Van Gogh"},
    {"value": "renoir", "text": "Renoir"},
]
FIXTURE_REGISTRY = ROOT / "tests" / "fixtures" / "colour-scheme-fixture" / "registry.ts"

DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("ase", "numpy", "scipy", "pydantic"))
pytestmark = [
    pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)"),
    pytest.mark.skipif(not DEPS_AVAILABLE, reason="ASE, NumPy, SciPy and pydantic are required for the parity tests"),
]


def _colour(scheme: str, symbol: str) -> list[float]:
    """The colour a scheme gives an element, from its file (web/src/compile/schemes/), as 0-1 channels."""
    hex_colour = json.loads((SCHEMES / f"{scheme}.json").read_text(encoding="utf-8"))["colours"][symbol]
    return [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)] + [1.0]


def _switch(
    scheme: str, to: str, hand_set: dict[str, list[float]] | None = None, registry: Path | None = None
) -> dict[str, Any]:
    args: list[Any] = ["POSCAR", STISHOVITE.read_text(encoding="utf-8"), scheme, to]
    if hand_set is not None:
        args.append(hand_set)
    (result,) = run([{"fn": "colourSchemeFixture", "args": args}], registry)
    assert "ok" in result, result.get("error")
    return result["ok"]


def _default_colours(name: str, text: str, choice: str) -> dict[str, list[float]]:
    (result,) = run([{"fn": "defaultColoursFixture", "args": [name, text, choice]}])
    assert "ok" in result, result.get("error")
    return result["ok"]


def _round_trip(name: str, text: str, to: str, hand_set: dict[str, list[float]] | None = None) -> dict[str, Any]:
    args: list[Any] = [name, text, to]
    if hand_set is not None:
        args.append(hand_set)
    (result,) = run([{"fn": "colourRoundTripFixture", "args": args}])
    assert "ok" in result, result.get("error")
    return result["ok"]


def _scheme_colours(scheme: str, symbols: list[str]) -> dict[str, list[float]]:
    (result,) = run([{"fn": "schemeColoursFixture", "args": [scheme, symbols]}])
    assert "ok" in result, result.get("error")
    return result["ok"]


def test_auto_is_the_default_and_the_list_offers_auto_then_the_registered_schemes() -> None:
    (result,) = run([{"fn": "colourSchemesFixture", "args": []}])
    assert result["ok"] == {"options": [{"value": "auto", "text": "Auto"}, *DROPDOWN_OPTIONS], "default": "auto"}


def test_a_theme_file_and_a_registry_line_show_in_the_dropdown_after_the_shipped_schemes() -> None:
    (result,) = run([{"fn": "colourSchemesFixture", "args": []}], FIXTURE_REGISTRY)
    assert result["ok"]["options"][-1] == {"value": "fixture", "text": "Fixture theme"}
    assert [option["value"] for option in result["ok"]["options"]] == ["auto", "vesta", "jmol", "fixture"]


def test_a_theme_recolours_its_elements_and_polyhedra_through_the_switch() -> None:
    result = _switch("auto", "fixture", registry=FIXTURE_REGISTRY)
    # Auto gives the crystal VESTA first; the switch to the fixture theme gives its colours to the atoms and polyhedra.
    assert result["before"]["elements"]["Si"] == pytest.approx(_colour("vesta", "Si"), abs=1e-9)
    assert result["after"]["elements"]["Si"] == pytest.approx([1.0, 0.0, 0.0, 1.0], abs=1e-9)
    assert result["after"]["elements"]["O"] == pytest.approx([0.0, 1.0, 0.0, 1.0], abs=1e-9)
    assert result["after"]["polyhedra"]["Si"] == pytest.approx([1.0, 0.0, 0.0, 1.0], abs=1e-9)


def test_a_stored_choice_is_kept_when_it_names_a_scheme_and_is_auto_otherwise() -> None:
    cases = {None: "auto", "auto": "auto", "vesta": "vesta", "jmol": "jmol", "": "auto", "gone": "auto", "Jmol": "auto"}
    for raw, expected in cases.items():
        (result,) = run([{"fn": "storedChoiceFixture", "args": [raw]}])
        assert result["ok"] == expected, raw


def test_a_stored_id_of_a_theme_is_kept_only_while_the_theme_is_registered() -> None:
    (with_theme,) = run([{"fn": "storedChoiceFixture", "args": ["fixture"]}], FIXTURE_REGISTRY)
    (shipped,) = run([{"fn": "storedChoiceFixture", "args": ["fixture"]}])
    assert with_theme["ok"] == "fixture"
    assert shipped["ok"] == "auto"


def test_the_default_silicon_and_oxygen_are_the_vesta_values() -> None:
    colours = _scheme_colours("vesta", ["Si", "O"])
    assert colours["Si"] == pytest.approx([27 / 255, 59 / 255, 250 / 255, 1.0], abs=1e-3)
    assert colours["O"] == pytest.approx([254 / 255, 3 / 255, 0.0, 1.0], abs=1e-3)


def test_stishovite_opened_alone_takes_vesta_silicon_by_default() -> None:
    result = _switch("auto", "jmol")
    assert result["before"]["elements"]["Si"] == pytest.approx(_colour("vesta", "Si"), abs=1e-9)
    assert result["before"]["elements"]["O"] == pytest.approx(_colour("vesta", "O"), abs=1e-9)


def test_switching_to_jmol_gives_jmol_silicon_and_oxygen() -> None:
    result = _switch("vesta", "jmol")
    assert result["after"]["elements"]["Si"] == pytest.approx(_colour("jmol", "Si"), abs=1e-9)
    assert result["after"]["elements"]["O"] == pytest.approx(_colour("jmol", "O"), abs=1e-9)


def test_the_automatic_si_polyhedron_follows_the_switch() -> None:
    result = _switch("vesta", "jmol")
    assert result["before"]["polyhedra"]["Si"] == pytest.approx(_colour("vesta", "Si"), abs=1e-9)
    assert result["after"]["polyhedra"]["Si"] == pytest.approx(_colour("jmol", "Si"), abs=1e-9)


def test_switching_back_to_vesta_restores_the_vesta_colours() -> None:
    result = _switch("jmol", "vesta")
    assert result["after"]["elements"]["Si"] == pytest.approx(_colour("vesta", "Si"), abs=1e-9)
    assert result["after"]["polyhedra"]["Si"] == pytest.approx(_colour("vesta", "Si"), abs=1e-9)


def test_a_colour_the_user_set_survives_a_switch() -> None:
    red = [1.0, 0.0, 0.0, 1.0]
    result = _switch("vesta", "jmol", hand_set={"Si": red})
    assert result["after"]["elements"]["Si"] == pytest.approx(red, abs=1e-9)
    # The automatic O is still recoloured: only the user's element is kept.
    assert result["after"]["elements"]["O"] == pytest.approx(_colour("jmol", "O"), abs=1e-9)


def test_stishovite_with_auto_takes_vesta_silicon() -> None:
    colours = _default_colours("POSCAR", STISHOVITE.read_text(encoding="utf-8"), "auto")
    assert colours["Si"] == pytest.approx(_colour("vesta", "Si"), abs=1e-9)


MIXED = ROOT / "tests" / "fixtures" / "mixed-labels"


def test_a_label_takes_the_scheme_colour_of_its_element() -> None:
    # C and C_dna are both carbon: each label's style is the VESTA carbon (the colour the scheme gives its element).
    colours = _default_colours("POSCAR", (MIXED / "rings" / "POSCAR").read_text(encoding="utf-8"), "vesta")
    assert colours["C"] == pytest.approx(_colour("vesta", "C"), abs=1e-9)
    assert colours["C_dna"] == pytest.approx(_colour("vesta", "C"), abs=1e-9)


def test_switching_the_scheme_recolours_a_label_by_its_element() -> None:
    # C_dna still holds its scheme colour, so vesta -> jmol gives it jmol's carbon, as it does the plain C label.
    text = (MIXED / "rings" / "POSCAR").read_text(encoding="utf-8")
    (result,) = run([{"fn": "colourSchemeFixture", "args": ["POSCAR", text, "vesta", "jmol"]}])
    assert "ok" in result, result.get("error")
    before, after = result["ok"]["before"]["elements"], result["ok"]["after"]["elements"]
    assert before["C_dna"] == pytest.approx(_colour("vesta", "C"), abs=1e-9)
    assert after["C_dna"] == pytest.approx(_colour("jmol", "C"), abs=1e-9)
    assert after["C"] == pytest.approx(_colour("jmol", "C"), abs=1e-9)


def test_a_second_silicon_label_gets_the_silicon_colour_and_its_polyhedron_takes_it() -> None:
    text = (MIXED / "silica" / "POSCAR").read_text(encoding="utf-8")
    colours = _default_colours("POSCAR", text, "vesta")
    assert colours["Si_b"] == pytest.approx(_colour("vesta", "Si"), abs=1e-9)
    start = _round_trip("POSCAR", text, "vesta")["start"]
    assert start["polyhedra"]["Si"] == pytest.approx(_colour("vesta", "Si"), abs=1e-9)
    assert start["polyhedra"]["Si_b"] == pytest.approx(_colour("vesta", "Si"), abs=1e-9)


def test_a_non_periodic_benzene_with_auto_takes_jmol_carbon() -> None:
    colours = _default_colours(MOLECULE_NAME, molecule_extxyz(benzene()), "auto")
    assert colours["C"] == pytest.approx(_colour("jmol", "C"), abs=1e-9)


def test_an_explicit_jmol_on_stishovite_gives_jmol_silicon() -> None:
    colours = _default_colours("POSCAR", STISHOVITE.read_text(encoding="utf-8"), "jmol")
    assert colours["Si"] == pytest.approx(_colour("jmol", "Si"), abs=1e-9)


def test_an_explicit_vesta_on_a_molecule_stays_vesta() -> None:
    colours = _default_colours(MOLECULE_NAME, molecule_extxyz(benzene()), "vesta")
    assert colours["C"] == pytest.approx(_colour("vesta", "C"), abs=1e-9)


def test_auto_to_vesta_and_back_to_auto_recolours_a_molecule_and_keeps_a_hand_set_colour() -> None:
    red = [1.0, 0.0, 0.0, 1.0]
    result = _round_trip(MOLECULE_NAME, molecule_extxyz(benzene()), "vesta", hand_set={"C": red})
    assert result["start"]["elements"]["H"] == pytest.approx(_colour("jmol", "H"), abs=1e-9)
    assert result["switched"]["elements"]["H"] == pytest.approx(_colour("vesta", "H"), abs=1e-9)
    assert result["back"]["elements"]["H"] == pytest.approx(_colour("jmol", "H"), abs=1e-9)
    for step in ("start", "switched", "back"):
        assert result[step]["elements"]["C"] == pytest.approx(red, abs=1e-9)


def test_auto_to_jmol_and_back_to_auto_restores_a_crystal_and_its_polyhedron() -> None:
    result = _round_trip("POSCAR", STISHOVITE.read_text(encoding="utf-8"), "jmol")
    assert result["switched"]["elements"]["Si"] == pytest.approx(_colour("jmol", "Si"), abs=1e-9)
    assert result["switched"]["polyhedra"]["Si"] == pytest.approx(_colour("jmol", "Si"), abs=1e-9)
    assert result["back"] == result["start"]
