"""Default bond rules (web/src/compile/default-rules.ts): the rules the page derives for a structure opened without a
config. They are checked in node (tests/ts_bundle.py), and an exported config is read back by Python: it validates, and
compiled by Python it gives the scene the page compiles from the same rules.
"""

from __future__ import annotations

import functools
import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

from cluster_structures import MOLECULE_NAME, molecule_extxyz, poscar
from ts_bundle import available, run

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
EXAMPLES = ROOT / "examples"
DEFAULTS_TEXT = (ROOT / "configs" / "default.json").read_text(encoding="utf-8")
DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("ase", "numpy", "scipy", "pydantic"))
TOLERANCE = 1e-9
BOND_MIN = 0.4  # default-rules.ts BOND_MIN_DISTANCE
ELEMENT_STYLES = ROOT / "web" / "src" / "compile" / "element-styles.json"
SCHEMES = ROOT / "web" / "src" / "compile" / "schemes"

pytestmark = [
    pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)"),
    pytest.mark.skipif(not DEPS_AVAILABLE, reason="ASE, NumPy, SciPy and pydantic are required for these tests"),
]

# Synthetic structures on purpose. The dummy case: Mg, an O 1.0 A away (so Mg-O has a rule) and an X 1.0 A from Mg. X
# would bond to Mg if it had a radius; the dummy has none, so no rule names X.
DUMMY_POSCAR = """Mg, O and a dummy X
1.0
2.0 0.0 0.0
0.0 2.0 0.0
0.0 0.0 2.0
Mg O X
1 1 1
Direct
0.0 0.0 0.0
0.5 0.0 0.0
0.0 0.5 0.0
"""

# Pure fcc copper: its nearest neighbours (2.55 A) lie inside the Cu-Cu window, but two metals get no rule.
COPPER_POSCAR = """Cu, fcc conventional cell
1.0
3.61 0.0 0.0
0.0 3.61 0.0
0.0 0.0 3.61
Cu
4
Direct
0.0 0.0 0.0
0.0 0.5 0.5
0.5 0.0 0.5
0.5 0.5 0.0
"""


def _pairs(rules: list[dict[str, Any]]) -> set[frozenset[str]]:
    return {frozenset((rule["a"], rule["b"])) for rule in rules}


def _renamed(rule: dict[str, Any]) -> dict[str, Any]:
    """A rule with the names the config file writes its distances under (min and max, as configToData does)."""
    names = {"min_distance": "min", "max_distance": "max"}
    return {names.get(key, key): value for key, value in rule.items()}


def _job(name: str, text: str) -> dict[str, Any]:
    return {"fn": "defaultRulesFixture", "args": [name, text, DEFAULTS_TEXT]}


def _unwrap(result: dict[str, Any]) -> dict[str, Any]:
    assert "ok" in result, f"TypeScript failed: {result.get('type')}: {result.get('error')}"
    return result["ok"]


@functools.cache
def _derived(path: str) -> dict[str, Any]:
    """The defaultRulesFixture of a structure file (cached: each file is read once per test process)."""
    file = Path(path)
    return _unwrap(run([_job(file.name, file.read_text(encoding="utf-8"))])[0])


# ---- the rules the page derives ------------------------------------------------------------------------------------


def test_rock_salt_mgo_gets_only_mg_o_with_the_nearest_neighbour_in_its_window() -> None:
    rules = _derived(str(FIXTURES / "rocksalt" / "POSCAR"))["rules"]
    assert _pairs(rules) == {frozenset({"Mg", "O"})}  # no Mg-Mg (two metals), no O-O
    [mg_o] = rules
    assert mg_o["min_distance"] <= 2.1 <= mg_o["max_distance"]  # the Mg-O distance: half the 4.2 A cell edge


def test_rules_are_ordered_by_atomic_number_of_the_element_pair() -> None:
    rules = _derived(str(EXAMPLES / "uio-66" / "POSCAR"))["rules"]
    # C (6), O (8), Zr (40): each pair has its lower atomic number first.
    assert [(rule["a"], rule["b"]) for rule in rules] == [("C", "C"), ("C", "O"), ("O", "Zr")]


def test_uio_66_gets_no_zr_zr_rule() -> None:
    # Zr-Zr contacts (up to 4.0 A) lie inside the window, but Zr is a metal.
    rules = _derived(str(EXAMPLES / "uio-66" / "POSCAR"))["rules"]
    assert frozenset({"Zr"}) not in _pairs(rules)


def test_pure_fcc_copper_gets_no_default_bonds() -> None:
    result = _unwrap(run([_job("POSCAR", COPPER_POSCAR)])[0])
    assert result["rules"] == []


def test_dry_ice_gets_c_o_and_no_c_c() -> None:
    rules = _derived(str(EXAMPLES / "dry-ice" / "POSCAR"))["rules"]
    assert _pairs(rules) == {frozenset({"C", "O"})}


def test_stishovite_gets_si_o() -> None:
    rules = _derived(str(EXAMPLES / "stishovite" / "POSCAR"))["rules"]
    assert _pairs(rules) == {frozenset({"Si", "O"})}


def test_a_dummy_x_atom_gets_no_rule() -> None:
    result = _unwrap(run([_job("POSCAR", DUMMY_POSCAR)])[0])
    assert "X" in result["elements"]
    assert _pairs(result["rules"]) == {frozenset({"Mg", "O"})}


MIXED_RINGS = FIXTURES / "mixed-labels" / "rings" / "POSCAR"
MIXED_SILICA = FIXTURES / "mixed-labels" / "silica" / "POSCAR"


def test_a_label_gets_bond_rules_of_its_own_though_its_element_is_shared() -> None:
    # C and C_dna are both carbon: one window (C-C), but the bonds are named by label, each pair once and in order.
    rules = _derived(str(MIXED_RINGS))["rules"]
    assert [(rule["a"], rule["b"]) for rule in rules] == [("C", "C"), ("C", "C_dna"), ("C_dna", "C_dna")]
    # The C-C window: two covalent radii of 0.76 A, plus the 15% tolerance, from the bond minimum.
    for rule in rules:
        assert rule["min_distance"] == pytest.approx(BOND_MIN)
        assert rule["max_distance"] == pytest.approx(2 * 0.76 * 1.15, abs=1e-6)


def test_a_second_si_label_gets_its_own_bond_rule() -> None:
    # Si and Si_b are silicon: each bonds to O, so each label has its own O-Si rule, and O-O gets none.
    rules = _derived(str(MIXED_SILICA))["rules"]
    assert [(rule["a"], rule["b"]) for rule in rules] == [("O", "Si"), ("O", "Si_b")]


def test_every_default_rule_completes_nothing() -> None:
    # complete "ends" would pull in the atom across a box face, a dangling atom outside the box.
    for path in [FIXTURES / "rocksalt" / "POSCAR", EXAMPLES / "stishovite" / "POSCAR"]:
        assert {rule["complete"] for rule in _derived(str(path))["rules"]} == {"none"}


def test_a_structure_opened_alone_pulls_in_no_atoms_beyond_its_box(tmp_path: Path) -> None:
    # Stishovite's bonds reach across the cell faces. With complete "none" every point lies in the cell (its faces
    # included), so no O is pulled in from outside it.
    from gemmy.compile.pipeline import compile_scene_from_files
    from gemmy.config import scene_to_dict

    (result,) = run(
        [
            {
                "fn": "defaultConfigFixture",
                "args": ["POSCAR", (EXAMPLES / "stishovite" / "POSCAR").read_text(encoding="utf-8")],
            }
        ]
    )
    data = _unwrap(result)["data"]
    # The bonds are the rules under test. Polyhedra are left out: they draw ligand images outside the box on purpose.
    data["polyhedra"] = []
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(data), encoding="utf-8")
    python_scene = scene_to_dict(compile_scene_from_files(config_path, EXAMPLES / "stishovite" / "POSCAR"))
    for point in python_scene["points"]:
        assert all(-TOLERANCE <= f <= 1 + TOLERANCE for f in point["fractional"]), point


# ---- the rules validate, and export --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [FIXTURES / "rocksalt" / "POSCAR", EXAMPLES / "dry-ice" / "POSCAR", EXAMPLES / "stishovite" / "POSCAR"],
    ids=["rocksalt", "dry-ice", "stishovite"],
)
def test_the_rules_export_as_the_rules_they_are(path: Path) -> None:
    derived = _derived(str(path))
    assert derived["exportedRules"] == [_renamed(rule) for rule in derived["rules"]]


@pytest.mark.parametrize(
    "path",
    [FIXTURES / "rocksalt" / "POSCAR", EXAMPLES / "dry-ice" / "POSCAR", EXAMPLES / "stishovite" / "POSCAR"],
    ids=["rocksalt", "dry-ice", "stishovite"],
)
def test_python_accepts_the_exported_config(path: Path, tmp_path: Path) -> None:
    from gemmy.config import load_scene_config

    derived = _derived(str(path))
    config_path = tmp_path / "config.json"
    config_path.write_text(derived["json"], encoding="utf-8")
    bonds = [rule.model_dump(mode="json") for rule in load_scene_config(config_path).bonds]
    assert bonds == derived["rules"]


# ---- the exported config compiles to the page's scene --------------------------------------------------------------


def _first_difference(a: Any, b: Any, path: str = "scene") -> str | None:
    """The path of the first place two JSON-like values differ (a is the TypeScript side), or None if equal. Python's
    tuples are lists here, as JSON writes them."""
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            return (
                f"{path}: keys differ (only in ts {sorted(set(a) - set(b))}, only in python {sorted(set(b) - set(a))})"
            )
        for key in a:
            found = _first_difference(a[key], b[key], f"{path}.{key}")
            if found is not None:
                return found
        return None
    if isinstance(a, list) and isinstance(b, (list, tuple)):
        if len(a) != len(b):
            return f"{path}: length {len(a)} (ts) != {len(b)} (python)"
        for index, (x, y) in enumerate(zip(a, b, strict=True)):
            found = _first_difference(x, y, f"{path}[{index}]")
            if found is not None:
                return found
        return None
    if isinstance(a, bool) != isinstance(b, bool) or a != b:
        return f"{path}: ts={a!r} python={b!r}"
    return None


@pytest.mark.parametrize(
    "path",
    [FIXTURES / "rocksalt" / "POSCAR", EXAMPLES / "dry-ice" / "POSCAR"],
    ids=["rocksalt", "dry-ice"],
)
def test_the_exported_config_gives_the_same_scene_in_python_and_typescript(path: Path, tmp_path: Path) -> None:
    from gemmy.compile.pipeline import compile_scene_from_files
    from gemmy.config import scene_to_dict

    derived = _derived(str(path))
    config_path = tmp_path / "config.json"
    config_path.write_text(derived["json"], encoding="utf-8")
    compiled = _unwrap(
        run(
            [
                {
                    "fn": "compileFixture",
                    "args": [path.name, path.read_text(encoding="utf-8"), "config.json", derived["json"], {}],
                }
            ]
        )[0]
    )
    python_scene = scene_to_dict(compile_scene_from_files(config_path, path))
    difference = _first_difference(compiled["scene"], python_scene)
    assert difference is None, f"{path.name}: first difference from Python at {difference}"


# ---- the cell a structure opened alone gets (defaultConfig) --------------------------------------------------------


def _default_cell(path: Path) -> dict[str, Any]:
    return _default_config_of(path)


def test_a_poscar_alone_is_periodic_on_all_three_axes_and_shows_the_unit_cell() -> None:
    cell = _default_cell(FIXTURES / "rocksalt" / "POSCAR")
    assert cell["periodic"] == [True, True, True]
    assert cell["supercell"] == [1, 1, 1]


# A C2 pair in a 5 A box: C has its VESTA colour, and a C-C pair is a bond.
CARBON_POSCAR = """C2 in a box
1.0
5.0 0.0 0.0
0.0 5.0 0.0
0.0 0.0 5.0
C
2
Cartesian
0.0 0.0 0.0
1.3 0.0 0.0
"""


def _default_config(name: str, text: str) -> dict[str, Any]:
    """The config a structure opened alone gets (defaultConfig), as the page's fixture reports it."""
    (result,) = run([{"fn": "defaultConfigFixture", "args": [name, text]}])
    return _unwrap(result)


def _default_config_of(path: Path) -> dict[str, Any]:
    return _default_config(path.name, path.read_text(encoding="utf-8"))


def _table_entry(symbol: str) -> dict[str, Any]:
    """The default (VESTA) colour and radius of an element, from the page's files."""
    hex_colour = json.loads((SCHEMES / "vesta.json").read_text(encoding="utf-8"))["colours"][symbol]
    radius = json.loads(ELEMENT_STYLES.read_text(encoding="utf-8"))["radii"][symbol]
    return {"color": [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)] + [1.0], "radius": radius}


def test_carbon_alone_gets_its_vesta_colour_and_no_polyhedra() -> None:
    config = _default_config("POSCAR", CARBON_POSCAR)
    assert list(config["elements"]) == ["C"]
    assert config["elements"]["C"]["color"] == _table_entry("C")["color"]
    assert config["polyhedra"] == 0


def test_stishovite_alone_gets_si_and_o_styles_si_o_bonds_and_one_si_o6_polyhedron() -> None:
    config = _default_config_of(EXAMPLES / "stishovite" / "POSCAR")
    assert set(config["elements"]) == {"Si", "O"}
    assert config["elements"]["Si"]["color"] == _table_entry("Si")["color"]
    assert config["elements"]["O"]["radius"] == _table_entry("O")["radius"]
    assert {frozenset(pair) for pair in config["bonds"]} == {frozenset({"Si", "O"})}
    assert config["polyhedra"] == 1


def test_an_unknown_element_gets_the_grey_default_entry() -> None:
    config = _default_config_of(FIXTURES / "rocksalt" / "POSCAR")
    assert set(config["elements"]) == {"Mg", "O"}  # both have table entries: no default entry
    dummy = _default_config("POSCAR", DUMMY_POSCAR)
    assert set(dummy["elements"]) == {"Mg", "O", "default"}  # the X atom takes the grey default
    assert dummy["elements"]["default"]["color"] == [0.5, 0.5, 0.5, 1.0]


def test_an_extxyz_with_no_pbc_is_not_periodic() -> None:
    # The apoferritin extxyz says pbc="F F F", so its cell is shown with every axis off.
    cell = _default_cell(EXAMPLES / "apoferritin" / "apoferritin.extxyz")
    assert cell["periodic"] == [False, False, False]
    assert cell["supercell"] == [1, 1, 1]


# ---- detection options (tolerance, metal pairs) ---------------------------------------------------------------------


def _detected(path: Path, tolerance: float, metal_pairs: bool) -> list[dict[str, Any]]:
    job = {
        "fn": "detectedRulesFixture",
        "args": [path.name, path.read_text(encoding="utf-8"), DEFAULTS_TEXT, tolerance, metal_pairs],
    }
    return _unwrap(run([job])[0])


def test_the_default_options_give_the_default_rules() -> None:
    assert (
        _detected(FIXTURES / "rocksalt" / "POSCAR", 0.15, False)
        == _derived(str(FIXTURES / "rocksalt" / "POSCAR"))["rules"]
    )


def test_metal_metal_on_gives_mg_mg_in_rocksalt() -> None:
    # Off (the default), Mg-Mg has no rule; on, its window is the one Mg-Mg pair of two metals gets.
    assert frozenset({"Mg"}) not in _pairs(_detected(FIXTURES / "rocksalt" / "POSCAR", 0.15, False))
    assert frozenset({"Mg"}) in _pairs(_detected(FIXTURES / "rocksalt" / "POSCAR", 0.15, True))


# ---- default polyhedra (web/src/compile/default-shapes.ts) -----------------------------------------------------------

# Rock salt NaCl: the conventional 8-atom cell, a = 5.64 A. Each Na has six Cl neighbours at 2.82 A. Na-Na (3.99 A) is
# two metals, so it has no window.
NACL_POSCAR = """NaCl, rock salt
1.0
5.64 0.0 0.0
0.0 5.64 0.0
0.0 0.0 5.64
Na Cl
4 4
Direct
0.0 0.0 0.0
0.0 0.5 0.5
0.5 0.0 0.5
0.5 0.5 0.0
0.5 0.0 0.0
0.0 0.5 0.0
0.0 0.0 0.5
0.5 0.5 0.5
"""

# A water molecule in a box: O is an anion and H is never a centre, so no element centres a polyhedron.
WATER_POSCAR = """H2O in a box
1.0
10.0 0.0 0.0
0.0 10.0 0.0
0.0 0.0 10.0
O H
1 2
Cartesian
0.0 0.0 0.0
0.96 0.0 0.0
-0.24 0.93 0.0
"""


def _default_polyhedra(name: str, text: str) -> list[dict[str, Any]]:
    (result,) = run([{"fn": "defaultPolyhedraFixture", "args": [name, text]}])
    return _unwrap(result)


def _polyhedron_names(text: str, tmp_path: Path) -> tuple[list[str], int]:
    """The name of each polyhedron the page's default config compiles to, and how many points of the centre element
    the scene holds (image centres included), read back by Python."""
    from gemmy.compile.pipeline import compile_scene_from_files
    from gemmy.config import scene_to_dict

    config = _unwrap(run([{"fn": "defaultConfigFixture", "args": ["POSCAR", text]}])[0])["data"]
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    poscar = tmp_path / "POSCAR"
    poscar.write_text(text, encoding="utf-8")
    scene = scene_to_dict(compile_scene_from_files(config_path, poscar))
    names = [primitive["name"] for primitive in scene["primitives"]["polyhedra"]]
    centre = next(rule["center"] for rule in config["polyhedra"])
    return names, sum(point["element"] == centre for point in scene["points"])


def test_stishovite_gets_one_si_o_polyhedron() -> None:
    rules = _default_polyhedra("POSCAR", (EXAMPLES / "stishovite" / "POSCAR").read_text(encoding="utf-8"))
    assert [(rule["center"], rule["ligands"]) for rule in rules] == [("Si", ["O"])]


def test_stishovite_has_one_si_o6_polyhedron_per_si_point_image_centres_included(tmp_path: Path) -> None:
    text = (EXAMPLES / "stishovite" / "POSCAR").read_text(encoding="utf-8")
    names, centres = _polyhedron_names(text, tmp_path)
    assert names == ["SiO6"] * centres
    assert centres > 2  # the two Si of the cell, and the Si images on its faces and edges


def test_rock_salt_nacl_gets_one_na_cl_polyhedron_of_six(tmp_path: Path) -> None:
    rules = _default_polyhedra("POSCAR", NACL_POSCAR)
    assert [(rule["center"], rule["ligands"]) for rule in rules] == [("Na", ["Cl"])]
    names, centres = _polyhedron_names(NACL_POSCAR, tmp_path)
    assert names == ["NaCl6"] * centres
    assert centres > 4  # the four Na of the cell, and the Na images on its faces and edges


def test_a_molecule_with_no_anion_centre_gets_no_polyhedra() -> None:
    assert _default_polyhedra("POSCAR", WATER_POSCAR) == []


def test_a_protein_carbon_with_few_anion_neighbours_gets_no_polyhedron() -> None:
    # The C2 pair has no O or F neighbour, so its carbons have a median of 0 anion neighbours: below MIN_COORDINATION.
    assert _default_polyhedra("POSCAR", CARBON_POSCAR) == []


# ---- the bonds the default polyhedra draw are hidden; an uncovered bond stays visible ---------------------

# An SiO6 octahedron in a 10 A cube, and an H2 pair far from it: the Si-O bonds are the polyhedron's edges; the H-H
# bond is one no polyhedron covers.
SIO6_AND_H2_POSCAR = """SiO6 and H2
1.0
10.0 0.0 0.0
0.0 10.0 0.0
0.0 0.0 10.0
Si O H
1 6 2
Direct
0.0 0.0 0.0
0.18 0.0 0.0
-0.18 0.0 0.0
0.0 0.18 0.0
0.0 -0.18 0.0
0.0 0.0 0.18
0.0 0.0 -0.18
0.5 0.5 0.5
0.5 0.5 0.56
"""


def _visible_pairs(config: dict[str, Any]) -> dict[frozenset[str], bool]:
    """Each bond rule's element pair with its visibility (the file form writes visible on every rule)."""
    return {frozenset((rule["a"], rule["b"])): rule["visible"] for rule in config["bonds"]}


def test_stishovite_opens_with_si_o_hidden_and_its_polyhedron_shown() -> None:
    data = _default_config_of(EXAMPLES / "stishovite" / "POSCAR")["data"]
    assert _visible_pairs(data)[frozenset({"Si", "O"})] is False
    assert [rule["visible"] for rule in data["polyhedra"]] == [True]


def test_a_bond_no_polyhedron_covers_stays_visible() -> None:
    data = _default_config("POSCAR", SIO6_AND_H2_POSCAR)["data"]
    pairs = _visible_pairs(data)
    assert pairs[frozenset({"H"})] is True  # the H-H bond: no polyhedron joins H to anything
    assert pairs[frozenset({"Si", "O"})] is False


# ---- automatic polyhedra take their centre's colour (default-shapes.ts centreColourOf) ------------------------------


def _redetected(path: Path, colours: dict[str, list[float]]) -> dict[str, Any]:
    """The config of a structure opened alone, its element colours set to `colours`, with its automatic polyhedra
    Re-detected (redetectedPolyhedraFixture): the colours before and after, and the config's file form."""
    job = {"fn": "redetectedPolyhedraFixture", "args": [path.name, path.read_text(encoding="utf-8"), colours]}
    return _unwrap(run([job])[0])


def test_stishovite_si_polyhedron_takes_the_si_element_colour() -> None:
    [rule] = _default_polyhedra("POSCAR", (EXAMPLES / "stishovite" / "POSCAR").read_text(encoding="utf-8"))
    assert rule["color"] == _table_entry("Si")["color"]


def test_rock_salt_na_polyhedron_takes_the_na_element_colour() -> None:
    [rule] = _default_polyhedra("POSCAR", NACL_POSCAR)
    assert rule["center"] == "Na"
    assert rule["color"] == _table_entry("Na")["color"]


def test_redetect_gives_the_same_colour() -> None:
    result = _redetected(EXAMPLES / "stishovite" / "POSCAR", {})
    assert result["before"] == [_table_entry("Si")["color"]]
    assert result["after"] == result["before"]


def test_redetect_takes_the_colour_the_config_gives_the_centre(tmp_path: Path) -> None:
    override = [0.1, 0.9, 0.1, 1.0]
    result = _redetected(EXAMPLES / "stishovite" / "POSCAR", {"Si": override})
    assert result["before"] == [_table_entry("Si")["color"]]  # the polyhedron keeps its colour until Re-detect
    assert result["after"] == [override]
    # The exported config validates in Python, and its polyhedron rule carries the colour.
    from gemmy.config import scene_config_from_dict

    config = scene_config_from_dict(result["data"])
    assert [list(rule.color) for rule in config.polyhedra] == [override]


# ---- automatic polyhedra hide their centre atoms (config-edit-polyhedra.ts) --------------------------------------


def _automatic_centres(path: Path, action: str) -> dict[str, Any]:
    """The automatic centres of a structure opened alone, after `action` ("clear" or "redetect"): the visibility of each
    element, the file form, and the file form after a second edit (automaticCentresFixture)."""
    job = {"fn": "automaticCentresFixture", "args": [path.name, path.read_text(encoding="utf-8"), action]}
    return _unwrap(run([job])[0])


def test_stishovite_default_config_hides_si_and_shows_o() -> None:
    elements = _default_config_of(EXAMPLES / "stishovite" / "POSCAR")["elements"]
    assert elements["Si"]["visible"] is False
    assert elements["O"]["visible"] is True


def test_clear_automatic_shows_the_si_centre_again() -> None:
    assert _automatic_centres(EXAMPLES / "stishovite" / "POSCAR", "clear")["visible"]["Si"] is True


def test_redetect_is_idempotent_and_keeps_si_hidden() -> None:
    result = _automatic_centres(EXAMPLES / "stishovite" / "POSCAR", "redetect")
    assert result["visible"]["Si"] is False
    assert result["again"] == result["data"]


# ---- automatic polyhedra build on image centres (default-shapes.ts, config-edit-polyhedra.ts) --------------------


def test_stishovite_automatic_polyhedron_builds_on_image_centres() -> None:
    [rule] = _default_polyhedra("POSCAR", (EXAMPLES / "stishovite" / "POSCAR").read_text(encoding="utf-8"))
    assert rule["image_centers"] is True


def test_uio_66_automatic_polyhedra_build_on_image_centres() -> None:
    rules = _default_polyhedra("POSCAR", (EXAMPLES / "uio-66" / "POSCAR").read_text(encoding="utf-8"))
    assert [rule["center"] for rule in rules] == ["Zr"]
    assert all(rule["image_centers"] is True for rule in rules)


def test_collinear_centre_with_no_polyhedron_keeps_its_atoms_and_bonds_visible() -> None:
    """Mg with four collinear O: detection counts four ligands and makes a polyhedron rule, but the compile skips it
    (its ligands have no hull, polyhedra.ts), so nothing is drawn. The Mg atoms and the Mg-O bonds stay visible."""
    text = poscar(
        20.0,
        [
            ("Mg", (10.0, 10.0, 10.0)),
            ("O", (12.0, 10.0, 10.0)),
            ("O", (12.2, 10.0, 10.0)),
            ("O", (8.0, 10.0, 10.0)),
            ("O", (7.8, 10.0, 10.0)),
        ],
    )
    data = _default_config("POSCAR", text)["data"]
    assert [rule["center"] for rule in data["polyhedra"]] == ["Mg"]
    assert data["elements"]["Mg"]["visible"] is True
    mg_o = [rule for rule in data["bonds"] if {rule["a"], rule["b"]} == {"Mg", "O"}]
    assert mg_o and all(rule.get("visible", True) for rule in mg_o)


def test_redetect_keeps_image_centres_on() -> None:
    result = _redetected(EXAMPLES / "uio-66" / "POSCAR", {})
    assert result["data"]["polyhedra"]
    assert all(rule["image_centers"] is True for rule in result["data"]["polyhedra"])


def test_uio_66_at_2x2x2_gets_one_polyhedron_per_zr_point() -> None:
    # Every Zr point of the supercell is a centre, its periodic images included, and each draws its polyhedron.
    data = _default_config_of(EXAMPLES / "uio-66" / "POSCAR")["data"]
    data["cells"]["supercell"] = [2, 2, 2]
    text = (EXAMPLES / "uio-66" / "POSCAR").read_text(encoding="utf-8")
    (result,) = run([{"fn": "compileFixture", "args": ["POSCAR", text, "config.json", json.dumps(data), {}]}])
    scene = _unwrap(result)["scene"]
    zr_points = [point for point in scene["points"] if point["element"] == "Zr"]
    assert len(zr_points) > 54  # more than the 54 of the unit cell: the images are in the scene
    ring_names = {rule["name"] for rule in data["clusters"]}  # the ring polygons are not polyhedra of Zr
    zr_polyhedra = [p for p in scene["primitives"]["polyhedra"] if p["name"] not in ring_names]
    assert len(zr_polyhedra) == len(zr_points)


# ---- automatic rings (web/src/compile/default-rings.ts) -----------------------------------------

# A chair cyclohexane in a 10 A box: six carbons on a 1.45 A hexagon, alternately 0.25 A above and below its mean plane.
# Its bonds are 1.53 A (inside the C-C window), and its ring is not flat, so it gets no ring.


def _chair_poscar() -> str:
    import math

    radius, puckering = 1.446, 0.25
    lines = []
    for k in range(6):
        angle = math.radians(60 * k)
        height = puckering if k % 2 == 0 else -puckering
        lines.append(f"{radius * math.cos(angle):.6f} {radius * math.sin(angle):.6f} {height:.6f}")
    return (
        "cyclohexane chair in a box\n1.0\n10.0 0.0 0.0\n0.0 10.0 0.0\n0.0 0.0 10.0\nC\n6\nCartesian\n"
        + "\n".join(lines)
        + "\n"
    )


CHAIR_POSCAR = _chair_poscar()


def _default_rings(name: str, text: str) -> list[dict[str, Any]]:
    (result,) = run([{"fn": "defaultRingsFixture", "args": [name, text]}])
    return _unwrap(result)


def _ring_polygons(config: dict[str, Any], poscar: Path, tmp_path: Path) -> list[tuple[str, list[float]]]:
    """Each ring polygon the default config's scene draws: its name and the fractional centroid of its corners."""
    from gemmy.compile.pipeline import compile_scene_from_files
    from gemmy.config import scene_to_dict

    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    scene = scene_to_dict(compile_scene_from_files(config_path, poscar))
    ring_names = {rule["name"] for rule in config["clusters"]}
    points = {point["id"]: point for point in scene["points"]}
    polygons = []
    for primitive in scene["primitives"]["polyhedra"]:
        if primitive["name"] not in ring_names:
            continue
        corners = [points[point_id]["fractional"] for point_id in primitive["ligand_point_ids"]]
        centroid = [sum(corner[axis] for corner in corners) / len(corners) for axis in range(3)]
        polygons.append((primitive["name"], centroid))
    return polygons


def test_benzene_in_a_box_gets_one_c6_ring_rule_and_one_ring(tmp_path: Path) -> None:
    text = molecule_extxyz((FIXTURES / "benzene" / "POSCAR").read_text(encoding="utf-8"))
    rules = _default_rings(MOLECULE_NAME, text)
    assert [(rule["kind"], rule["atoms"], rule["name"]) for rule in rules] == [("ring", ["C"], "C 6-ring")]
    config = _default_config(MOLECULE_NAME, text)["data"]
    molecule = tmp_path / MOLECULE_NAME
    molecule.write_text(text, encoding="utf-8")
    assert [name for name, _ in _ring_polygons(config, molecule, tmp_path)] == ["C 6-ring"]


def test_naphthalene_gets_two_c6_rings(tmp_path: Path) -> None:
    text = molecule_extxyz((FIXTURES / "naphthalene" / "POSCAR").read_text(encoding="utf-8"))
    assert [rule["name"] for rule in _default_rings(MOLECULE_NAME, text)] == ["C 6-ring"]
    config = _default_config(MOLECULE_NAME, text)["data"]
    molecule = tmp_path / MOLECULE_NAME
    molecule.write_text(text, encoding="utf-8")
    assert [name for name, _ in _ring_polygons(config, molecule, tmp_path)] == ["C 6-ring", "C 6-ring"]


def test_a_puckered_cyclohexane_gets_no_ring() -> None:
    assert _default_rings("POSCAR", CHAIR_POSCAR) == []


def test_a_ring_of_c_dna_is_named_and_grouped_by_its_label() -> None:
    # Two flat benzene-like rings, one of C and one of C_dna (a label of carbon): each gets a rule of its own, by label.
    text = MIXED_RINGS.read_text(encoding="utf-8")
    rules = _default_rings("POSCAR", text)
    assert [(rule["atoms"], rule["name"]) for rule in rules] == [(["C"], "C 6-ring"), (["C_dna"], "C_dna 6-ring")]


def test_stishovite_gets_no_ring() -> None:
    assert _default_rings("POSCAR", (EXAMPLES / "stishovite" / "POSCAR").read_text(encoding="utf-8")) == []


def test_uio_66_gets_its_24_bdc_benzene_rings(tmp_path: Path) -> None:
    # UiO-66's conventional cell has four formula units, six BDC linkers each: 24 C6 rings. Twelve of them lie on a cell
    # face, and the polygons on a face are drawn on both faces, as their atoms are: 36 polygons in all.
    text = (EXAMPLES / "uio-66" / "POSCAR").read_text(encoding="utf-8")
    assert [rule["name"] for rule in _default_rings("POSCAR", text)] == ["C 6-ring"]
    # A crystal gets no automatic rings (structureKindOf), so the rings are added by hand here, as the user would.
    config = _default_config("POSCAR", text)["data"]
    config["clusters"] = _default_rings("POSCAR", text)
    poscar = tmp_path / "POSCAR"
    poscar.write_text(text, encoding="utf-8")
    polygons = _ring_polygons(config, poscar, tmp_path)
    assert len(polygons) == 36
    distinct = {tuple(round(x % 1.0, 4) % 1.0 for x in centroid) for _, centroid in polygons}
    assert len(distinct) == 24


def _benzene_molecule() -> str:
    return molecule_extxyz((FIXTURES / "benzene" / "POSCAR").read_text(encoding="utf-8"))


def _automatic_rings(name: str, text: str, action: str) -> dict[str, Any]:
    job = {"fn": "automaticRingsFixture", "args": [name, text, action]}
    return _unwrap(run([job])[0])


def test_redetect_of_automatic_rings_is_idempotent() -> None:
    result = _automatic_rings(MOLECULE_NAME, _benzene_molecule(), "redetect")
    assert result["rings"] == ["C 6-ring"]
    assert result["again"] == result["data"]


def test_clear_automatic_removes_the_automatic_rings() -> None:
    assert _automatic_rings(MOLECULE_NAME, _benzene_molecule(), "clear")["rings"] == []


def test_a_user_ring_survives_redetect_and_clear() -> None:
    job = {"fn": "userRingFixture", "args": [MOLECULE_NAME, _benzene_molecule()]}
    result = _unwrap(run([job])[0])
    assert result["before"] == ["C 6-ring", "mine"]
    assert result["redetected"] == ["C 6-ring", "mine"]
    assert result["cleared"] == ["mine"]


def _apoferritin_ring_scene() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """The rule names of apoferritin's default rings, and its TypeScript scene (ring polygons among its polyhedra)."""
    path = EXAMPLES / "apoferritin" / "apoferritin.extxyz"
    data = _default_config(path.name, path.read_text(encoding="utf-8"))["data"]
    job = {
        "fn": "compileFixture",
        "args": [path.name, path.read_text(encoding="utf-8"), "config.json", json.dumps(data), {}],
    }
    return data["clusters"], _unwrap(run([job])[0])["scene"]


def test_apoferritin_draws_each_flat_ring_once_and_no_puckered_proline() -> None:
    # Its His and Trp five-rings (C3N2, C4N) are one "C,N 5-ring" rule, and its Phe, Tyr and Trp benzene rings one
    # "C 6-ring" rule. The flat rule leaves out the puckered prolines (C4N, 48 of its 216 five-rings); no ring is drawn
    # twice, and every polygon is flat.
    import numpy as np

    rules, scene = _apoferritin_ring_scene()
    assert [rule["name"] for rule in rules] == ["C,N 5-ring", "C 6-ring"]
    points = {point["id"]: point for point in scene["points"]}
    ring_names = {rule["name"] for rule in rules}
    polygons = [p for p in scene["primitives"]["polyhedra"] if p["name"] in ring_names]
    assert sum(p["name"] == "C,N 5-ring" for p in polygons) == 168
    assert sum(p["name"] == "C 6-ring" for p in polygons) == 360
    assert len({frozenset(p["ligand_point_ids"]) for p in polygons}) == len(polygons)  # none drawn twice
    for polygon in polygons:
        corners = np.array([points[i]["position"] for i in polygon["ligand_point_ids"]], dtype=float)
        area = np.zeros(3)
        for k in range(len(corners)):
            area += np.cross(corners[k], corners[(k + 1) % len(corners)])
        offsets = (corners - corners.mean(axis=0)) @ (area / np.linalg.norm(area))
        assert np.all(np.abs(offsets) <= 0.1 + 1e-9)  # flat within the shared tolerance


# A pyridine (C5N) and a benzene (C6) in one 20 A box. Both are flat six-rings of carbon and nitrogen, so one
# "C,N 6-ring" rule draws both, and the "C 6-ring" rule that benzene would get on its own is left out (no ring is drawn
# twice).


def _ring_pair_poscar() -> str:
    import math

    def hexagon(cx: float, symbols: list[str]) -> list[tuple[str, float, float]]:
        return [
            (symbol, cx + 1.39 * math.cos(math.radians(60 * k)), cx + 1.39 * math.sin(math.radians(60 * k)))
            for k, symbol in enumerate(symbols)
        ]

    atoms = hexagon(5, ["N", "C", "C", "C", "C", "C"]) + hexagon(14, ["C"] * 6)
    carbons = [a for a in atoms if a[0] == "C"]
    nitrogens = [a for a in atoms if a[0] == "N"]
    lines = [
        "pyridine and benzene",
        "1.0",
        "20.0 0.0 0.0",
        "0.0 20.0 0.0",
        "0.0 0.0 20.0",
        "C N",
        f"{len(carbons)} {len(nitrogens)}",
        "Cartesian",
    ]
    lines += [f"{x:.6f} {y:.6f} 10.0" for _, x, y in carbons + nitrogens]
    return "\n".join(lines) + "\n"


def test_a_pyridine_and_a_benzene_share_one_c_n_six_ring_rule_and_each_ring_is_drawn_once() -> None:
    text = molecule_extxyz(_ring_pair_poscar())
    assert [rule["name"] for rule in _default_rings(MOLECULE_NAME, text)] == ["C,N 6-ring"]
    data = _default_config(MOLECULE_NAME, text)["data"]
    job = {"fn": "compileFixture", "args": [MOLECULE_NAME, text, "config.json", json.dumps(data), {}]}
    scene = _unwrap(run([job])[0])["scene"]
    polygons = [p for p in scene["primitives"]["polyhedra"] if p["name"] == "C,N 6-ring"]
    assert len(polygons) == 2
    assert len({frozenset(p["ligand_point_ids"]) for p in polygons}) == 2


# A benzene (C6) and a flat C5Si hexagon (a silicon in a benzene's place) far apart. The C,Si window must reach Si-C
# bonds (2.15 A) but not the C-C diagonals of either ring (2.41 A): the C6 is drawn by the C,Si rule and so is the C5Si.
def _ring_si_poscar() -> str:
    import math

    def hexagon(cx: float, symbols: list[str]) -> list[tuple[str, float, float]]:
        return [
            (symbol, cx + 1.39 * math.cos(math.radians(60 * k)), 10.0 + 1.39 * math.sin(math.radians(60 * k)))
            for k, symbol in enumerate(symbols)
        ]

    atoms = hexagon(5, ["C"] * 6) + hexagon(14, ["Si", "C", "C", "C", "C", "C"])
    carbons = [a for a in atoms if a[0] == "C"]
    silicons = [a for a in atoms if a[0] == "Si"]
    lines = [
        "benzene and a silicon benzene",
        "1.0",
        "20.0 0.0 0.0",
        "0.0 20.0 0.0",
        "0.0 0.0 20.0",
        "C Si",
        f"{len(carbons)} {len(silicons)}",
        "Cartesian",
    ]
    lines += [f"{x:.6f} {y:.6f} 10.0" for _, x, y in carbons + silicons]
    return "\n".join(lines) + "\n"


def test_a_benzene_and_a_c5si_hexagon_far_apart_both_draw() -> None:
    """Both rings are drawn. The C,Si rule's window does not reach the C-C diagonals of either ring; a window over the
    whole element set (Si-Si, 2.55 A) would make the benzene's diagonals bonds and draw neither ring."""
    text = molecule_extxyz(_ring_si_poscar())
    assert [rule["name"] for rule in _default_rings(MOLECULE_NAME, text)] == ["C,Si 6-ring"]
    data = _default_config(MOLECULE_NAME, text)["data"]
    job = {"fn": "compileFixture", "args": [MOLECULE_NAME, text, "config.json", json.dumps(data), {}]}
    scene = _unwrap(run([job])[0])["scene"]
    polygons = [p for p in scene["primitives"]["polyhedra"] if p["name"] == "C,Si 6-ring"]
    assert len(polygons) == 2
    assert len({frozenset(p["ligand_point_ids"]) for p in polygons}) == 2


def _rocksalt_supercell_text(cells: tuple[int, int, int]) -> str:
    """Rock salt (a = 5.64 A, 8 atoms a conventional cell) repeated cells times: 4 Na and 4 Cl per cell."""
    nx, ny, nz = cells
    na_basis = [(0.0, 0.0, 0.0), (0.0, 0.5, 0.5), (0.5, 0.0, 0.5), (0.5, 0.5, 0.0)]
    cl_basis = [(0.5, 0.0, 0.0), (0.0, 0.5, 0.0), (0.0, 0.0, 0.5), (0.5, 0.5, 0.5)]

    def sites(basis: list[tuple[float, float, float]]) -> list[str]:
        return [
            f"{(i + bx) / nx!r} {(j + by) / ny!r} {(k + bz) / nz!r}"
            for i in range(nx)
            for j in range(ny)
            for k in range(nz)
            for bx, by, bz in basis
        ]

    a = 5.64
    na, cl = sites(na_basis), sites(cl_basis)
    return "\n".join(
        [
            "Rock salt supercell, large input",
            "1.0",
            f"{nx * a} 0.0 0.0",
            f"0.0 {ny * a} 0.0",
            f"0.0 0.0 {nz * a}",
            "Na Cl",
            f"{len(na)} {len(cl)}",
            "Direct",
            *na,
            *cl,
            "",
        ]
    )


def test_a_160k_atom_rock_salt_runs_the_default_detection_without_a_range_error() -> None:
    """The bonds of 80,000 Na each reach six Cl: 480,000 entries. Spread into Math.max that was a RangeError (the
    argument limit). Each stage runs over the whole structure; the times are printed with -s."""
    text = _rocksalt_supercell_text((20, 20, 50))
    (result,) = run([{"fn": "detectDefaultsTimed", "args": ["POSCAR", text]}])
    assert "ok" in result, result.get("error")
    detected = result["ok"]
    print(f"\n160k rock salt detection (ms): {detected['ms']}")
    assert detected["bonds"] == 1  # Na-Cl only: metal pairs and Cl-Cl get no default bond
    assert detected["centres"] == ["Na"]
    assert detected["rings"] == 0


def _dense_carbon_text(atoms: int, edge: float) -> str:
    """Carbon atoms at seeded random points of an edge-sized cube: far denser than any ring, so the graph is huge."""
    import random

    rng = random.Random(7)
    points = [f"{rng.uniform(0, edge):.4f} {rng.uniform(0, edge):.4f} {rng.uniform(0, edge):.4f}" for _ in range(atoms)]
    return "\n".join(
        [
            "Dense carbon, synthetic",
            "1.0",
            f"{edge} 0.0 0.0",
            f"0.0 {edge} 0.0",
            f"0.0 0.0 {edge}",
            "C",
            str(atoms),
            "Cartesian",
            *points,
            "",
        ]
    )


def test_a_dense_carbon_cluster_gives_up_on_the_ring_search_without_a_freeze() -> None:
    """A dense cluster has more bonds than the step budget covers: detection gives up (no rings) and returns, rather
    than following every cycle. The times are printed with -s."""
    text = _dense_carbon_text(1500, 2.5)
    (result,) = run([{"fn": "detectDefaultsTimed", "args": ["POSCAR", text]}])
    assert "ok" in result, result.get("error")
    print(f"\ndense carbon cluster detection (ms): {result['ok']['ms']}")
    assert result["ok"]["rings"] == 0


# ---- the kind rule (web/src/compile/default-kind.ts): rings for a molecule, polyhedra for a crystal ----------------
# A crystal (periodic in any direction, a POSCAR) gets polyhedra and no automatic rings; a molecule (pbc F F F)
# gets rings and no automatic polyhedra. Detection of each kind is unchanged: these tests read the default config
# and Re-detect.

NACL_PATH = EXAMPLES / "nacl" / "POSCAR"
STISHOVITE_PATH = EXAMPLES / "stishovite" / "POSCAR"
UIO_66_PATH = EXAMPLES / "uio-66" / "POSCAR"
DNA_PATH = EXAMPLES / "dna-1bna" / "1bna.extxyz"


def _data_of(path: Path) -> dict[str, Any]:
    return _default_config_of(path)["data"]


def _redetected_shapes(name: str, text: str) -> dict[str, Any]:
    (result,) = run([{"fn": "redetectShapesFixture", "args": [name, text]}])
    return _unwrap(result)


@pytest.mark.parametrize("path", [STISHOVITE_PATH, NACL_PATH, UIO_66_PATH], ids=["stishovite", "nacl", "uio-66"])
def test_a_periodic_crystal_gets_polyhedra_and_no_rings(path: Path) -> None:
    data = _data_of(path)
    assert data["polyhedra"], "a crystal gets its polyhedra"
    assert data["clusters"] == []


def test_a_centre_label_gets_a_polyhedron_of_its_own_with_its_label_ligands() -> None:
    # Si and Si_b are both silicon: each is a centre of its own, coordinated by the O label.
    data = _data_of(MIXED_SILICA)
    assert [(rule["center"], rule["ligands"]) for rule in data["polyhedra"]] == [("Si", ["O"]), ("Si_b", ["O"])]


def test_each_centre_label_draws_its_polyhedron_and_hides_its_own_atoms(tmp_path: Path) -> None:
    # The centres of Si and Si_b each draw a polyhedron, and the atoms of both labels are hidden (no Si atom is shown).
    from gemmy.compile.pipeline import compile_scene_from_files
    from gemmy.config import scene_to_dict

    text = MIXED_SILICA.read_text(encoding="utf-8")
    config = _unwrap(run([{"fn": "defaultConfigFixture", "args": ["POSCAR", text]}])[0])["data"]
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    poscar = tmp_path / "POSCAR"
    poscar.write_text(text, encoding="utf-8")
    scene = scene_to_dict(compile_scene_from_files(config_path, poscar))
    labels = {point["id"]: point["label"] for point in scene["points"]}
    centres = [labels[polyhedron["center_point_id"]] for polyhedron in scene["primitives"]["polyhedra"]]
    assert set(centres) == {"Si", "Si_b"}  # one per centre point, image centres included
    shown = [atom["label"] for atom in scene["primitives"]["atoms"]]
    assert not {"Si", "Si_b"} & set(shown)


def test_stishovite_and_uio_66_get_their_metal_polyhedra() -> None:
    assert [rule["center"] for rule in _data_of(STISHOVITE_PATH)["polyhedra"]] == ["Si"]
    assert [rule["center"] for rule in _data_of(UIO_66_PATH)["polyhedra"]] == ["Zr"]


@pytest.mark.parametrize("name", ["benzene", "naphthalene"])
def test_a_non_periodic_aromatic_molecule_gets_rings_and_no_polyhedra(name: str) -> None:
    text = molecule_extxyz((FIXTURES / name / "POSCAR").read_text(encoding="utf-8"))
    data = _default_config(MOLECULE_NAME, text)["data"]
    assert data["polyhedra"] == []
    assert [rule["name"] for rule in data["clusters"]] == ["C 6-ring"]


def test_dna_is_a_molecule_with_rings_and_no_phosphate_polyhedra() -> None:
    # The 1bna file says pbc "F F F": its P(O4) groups get no tetrahedra, only the rings of its bases.
    data = _data_of(DNA_PATH)
    assert data["polyhedra"] == []
    assert data["clusters"], "the bases' rings are drawn"


def test_redetect_on_a_crystal_adds_polyhedra_and_no_rings() -> None:
    result = _redetected_shapes("POSCAR", STISHOVITE_PATH.read_text(encoding="utf-8"))
    assert result["centres"] == ["Si"]
    assert result["patterns"] == []
    assert result["data"]["clusters"] == []


def test_redetect_on_a_molecule_adds_rings_and_no_polyhedra() -> None:
    text = molecule_extxyz((FIXTURES / "benzene" / "POSCAR").read_text(encoding="utf-8"))
    result = _redetected_shapes(MOLECULE_NAME, text)
    assert result["centres"] == []
    assert [rule["name"] for rule in result["data"]["clusters"]] == ["C 6-ring"]
    assert result["data"]["polyhedra"] == []


def test_redetect_on_dna_draws_no_phosphate_polyhedra() -> None:
    result = _redetected_shapes(DNA_PATH.name, DNA_PATH.read_text(encoding="utf-8"))
    assert result["centres"] == []
    assert result["data"]["polyhedra"] == []


def test_redetect_keeps_a_collinear_centre_visible() -> None:
    """Mg with four collinear O (periodic, so a crystal): detection makes its rule, but the compile draws no polyhedron,
    so Re-detect hides nothing: the Mg atoms and the Mg-O bonds stay visible."""
    text = poscar(
        20.0,
        [
            ("Mg", (10.0, 10.0, 10.0)),
            ("O", (12.0, 10.0, 10.0)),
            ("O", (12.2, 10.0, 10.0)),
            ("O", (8.0, 10.0, 10.0)),
            ("O", (7.8, 10.0, 10.0)),
        ],
    )
    data = _redetected_shapes("POSCAR", text)["data"]
    assert data["elements"]["Mg"]["visible"] is True
    mg_o = [rule for rule in data["bonds"] if {rule["a"], rule["b"]} == {"Mg", "O"}]
    assert mg_o and all(rule.get("visible", True) for rule in mg_o)


def _unique_label_rocksalt(cells: int) -> str:
    """A rock-salt supercell of cells x cells x cells conventional cells, with a label of its own on every atom."""
    mg = [(0, 0, 0), (0, 0.5, 0.5), (0.5, 0, 0.5), (0.5, 0.5, 0)]
    o = [(0.5, 0, 0), (0, 0.5, 0), (0, 0, 0.5), (0.5, 0.5, 0.5)]
    labels: list[str] = []
    coords: list[str] = []
    for i in range(cells):
        for j in range(cells):
            for k in range(cells):
                for element, sites in (("Mg", mg), ("O", o)):
                    for x, y, z in sites:
                        labels.append(f"{element}{len(labels) + 1}")
                        coords.append(f"{(x + i) / cells:.8f} {(y + j) / cells:.8f} {(z + k) / cells:.8f}")
    edge = 4.2 * cells
    return "\n".join(
        [
            "One label per atom",
            "1.0",
            f"{edge} 0.0 0.0",
            f"0.0 {edge} 0.0",
            f"0.0 0.0 {edge}",
            " ".join(labels),
            " ".join("1" for _ in labels),
            "Direct",
            *coords,
            "",
        ]
    )


def test_a_label_per_atom_detects_polyhedra_in_linear_time() -> None:
    # Each centre used to scan every atom for its own label: quadratic, about 1.1 s here, against about 70 ms now.
    detected = _unwrap(run([{"fn": "detectDefaultsTimed", "args": ["unique.poscar", _unique_label_rocksalt(14)]}])[0])
    assert len(detected["centres"]) == 4 * 14**3  # every Mg atom is its own centre, with its own polyhedron
    assert detected["ms"]["polyhedra"] < 500
