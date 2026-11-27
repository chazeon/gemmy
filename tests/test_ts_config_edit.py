"""The style panel's config edits (web/src/compile/config-edit-*.ts) against the Python config (gemmy.config).

Each edit runs in the node bridge (tests/ts_bundle.py, editConfig) on a config dict. The tests check what each edit
changes (the paths that differ, and nothing else), the errors with their key paths, that the input config is not
changed, that the edited config's file form validates in Python, and that Python compiles an edited config to the scene
TypeScript compiles. The compile parity uses the rocksalt fixture, with the Mg-O window widened, O recoloured and a
2x2x1 supercell.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import warnings
from pathlib import Path
from typing import Any

import pytest

from cluster_structures import MOLECULE_NAME, benzene, molecule_extxyz
from golden import normalize
from ts_bundle import available, run

ROOT = Path(__file__).resolve().parents[1]
ROCKSALT = ROOT / "tests" / "fixtures" / "rocksalt"

DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("ase", "numpy", "scipy", "pydantic"))
pytestmark = [
    pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)"),
    pytest.mark.skipif(not DEPS_AVAILABLE, reason="ASE, NumPy, SciPy and pydantic are required for the parity tests"),
]

# The default bond rule, element style and polyhedron rule the schema fills in (config.ts), so the tests can name them.
DEFAULT_BOND = {"radius": 0.08, "color": [0.7, 0.7, 0.7, 1.0], "material": "bond", "visible": True}
DEFAULT_BOND_FIELDS = {"style": "solid", "complete": "ends"}
DEFAULT_ELEMENT = {"visible": True, "representation": "sphere", "radius": 0.35, "color": [0.8, 0.8, 0.8, 1.0]}


def rocksalt_raw() -> dict[str, Any]:
    return json.loads((ROCKSALT / "config.json").read_text(encoding="utf-8"))


def rocksalt_with_clusters() -> dict[str, Any]:
    raw = rocksalt_raw()
    raw["clusters"] = [{"kind": "ring", "atoms": ["Mg"], "min": 1.3, "max": 1.5}]
    return raw


# ---- running the edits ----------------------------------------------------------------------------------------------


def edit_steps(*steps: tuple[str, ...]) -> list[list[Any]]:
    """Each step is (name, *arguments): the bridge takes [name, arguments] pairs."""
    return [[name, list(args)] for name, *args in steps]


def edited(raw: dict[str, Any], *steps: tuple[str, ...]) -> dict[str, Any]:
    """The bridge's result for the steps on the config: the config, its file form, and the input check. Asserts that the
    edit succeeded and left its input unchanged."""
    (result,) = run([{"fn": "editConfig", "args": [raw, edit_steps(*steps)]}])
    assert "ok" in result, result.get("error")
    assert result["ok"]["inputUnchanged"] is True, "an edit changed its input config"
    return {"config": json.loads(result["ok"]["config"]), "data": json.loads(result["ok"]["data"])}


def refused(raw: dict[str, Any], *steps: tuple[str, ...]) -> str:
    """The message of the ConfigError the steps throw; asserts that they were refused."""
    (result,) = run([{"fn": "editConfig", "args": [raw, edit_steps(*steps)]}])
    assert "error" in result, f"the edit was accepted: {result.get('ok')}"
    assert result["type"] == "ConfigError", result
    return result["error"]


def parsed(raw: dict[str, Any]) -> dict[str, Any]:
    """The config as the schema reads it (defaults filled, Python's field names)."""
    (result,) = run([{"fn": "parseSceneConfigJson", "args": [raw]}])
    assert "ok" in result, result.get("error")
    return json.loads(result["ok"])


def changed_paths(before: Any, after: Any, prefix: str = "") -> list[str]:
    """The key paths at which two parsed configs differ. A key present on one side only is a change at that key. A list
    of rules is compared rule by rule (its index is in the path); any other list, such as a colour, is one value."""
    if isinstance(before, dict) and isinstance(after, dict):
        return [path for key in sorted(set(before) | set(after)) for path in _key_changes(before, after, prefix, key)]
    if isinstance(before, list) and isinstance(after, list) and len(before) == len(after) and _rules(before, after):
        return [
            path
            for position, (old, new) in enumerate(zip(before, after, strict=True))
            for path in changed_paths(old, new, _join(prefix, str(position)))
        ]
    return [] if before == after else [prefix]


def _rules(before: list[Any], after: list[Any]) -> bool:
    return all(isinstance(item, dict) for item in [*before, *after])


def _key_changes(before: dict[str, Any], after: dict[str, Any], prefix: str, key: str) -> list[str]:
    if key not in before or key not in after:
        return [_join(prefix, key)]
    return changed_paths(before[key], after[key], _join(prefix, key))


def _join(prefix: str, key: str) -> str:
    return f"{prefix}.{key}" if prefix else key


def python_config(data: dict[str, Any]) -> Any:
    """The file form read by Python's SceneConfig, as plain data (frozensets as sorted lists)."""
    from gemmy.config import scene_config_from_dict

    return normalize(_plain(scene_config_from_dict(data).model_dump()))


def _plain(value: Any) -> Any:
    if isinstance(value, (frozenset, set)):
        return sorted(_plain(item) for item in value)
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    return value


# ---- elements -------------------------------------------------------------------------------------------------------


def test_element_visibility_changes_only_that_flag() -> None:
    before = parsed(rocksalt_raw())
    result = edited(rocksalt_raw(), ("setElementVisible", "O", False))
    assert changed_paths(before, result["config"]) == ["elements.O.visible"]


def test_element_colour_on_a_new_key_starts_from_the_default_entry() -> None:
    """styleFor falls back to "default" for a key with no entry, so the new entry copies that and changes only the
    colour."""
    raw = rocksalt_raw()
    before = parsed(raw)
    result = edited(raw, ("setElementColor", "Na", [0.1, 0.2, 0.3, 1.0]))
    assert changed_paths(before, result["config"]) == ["elements.Na"]
    assert result["config"]["elements"]["Na"] == {
        **before["elements"]["default"],
        "color": [0.1, 0.2, 0.3, 1.0],
    }


def test_element_colour_on_a_new_key_without_a_default_uses_the_schema_defaults() -> None:
    result = edited({"elements": {"O": {"radius": 0.28}}}, ("setElementColor", "Na", [1.0, 0.0, 0.0, 1.0]))
    assert result["config"]["elements"]["Na"] == {
        **DEFAULT_ELEMENT,
        "color": [1.0, 0.0, 0.0, 1.0],
        "material": "matte",
    }


def test_element_radius_changes_only_that_radius() -> None:
    before = parsed(rocksalt_raw())
    result = edited(rocksalt_raw(), ("setElementRadius", "Mg", 0.5))
    assert changed_paths(before, result["config"]) == ["elements.Mg.radius"]


def test_negative_element_radius_is_refused_at_its_key() -> None:
    assert refused(rocksalt_raw(), ("setElementRadius", "Mg", -0.1)).startswith("elements.Mg.radius:")


# ---- bonds ----------------------------------------------------------------------------------------------------------


def test_bond_window_changes_both_distances() -> None:
    before = parsed(rocksalt_raw())
    result = edited(rocksalt_raw(), ("setBondWindow", 0, 1.5, 2.8))
    assert changed_paths(before, result["config"]) == ["bonds.0.max_distance", "bonds.0.min_distance"]
    assert result["data"]["bonds"][0]["min"] == 1.5
    assert result["data"]["bonds"][0]["max"] == 2.8


@pytest.mark.parametrize(
    ("step", "path", "value"),
    [
        (("setBondVisible", 0, False), "bonds.0.visible", False),
        (("setBondColor", 0, [1.0, 0.0, 0.0, 1.0]), "bonds.0.color", [1.0, 0.0, 0.0, 1.0]),
        (("setBondRadius", 0, 0.2), "bonds.0.radius", 0.2),
        (("setBondStyle", 0, "dashed"), "bonds.0.style", "dashed"),
    ],
)
def test_bond_field_edits_change_only_that_field(step: tuple[str, ...], path: str, value: Any) -> None:
    before = parsed(rocksalt_raw())
    result = edited(rocksalt_raw(), step)
    assert changed_paths(before, result["config"]) == [path]
    assert _get(result["config"], path) == value


def _get(data: Any, path: str) -> Any:
    for segment in path.split("."):
        data = data[int(segment)] if isinstance(data, list) else data[segment]
    return data


def test_bond_style_outside_the_allowed_names_is_refused_at_its_key() -> None:
    assert refused(rocksalt_raw(), ("setBondStyle", 0, "wavy")).startswith("bonds.0.style:")


def test_bond_window_with_min_above_max_is_refused_at_max() -> None:
    message = refused(rocksalt_raw(), ("setBondWindow", 0, 3.0, 2.0))
    assert message == "bonds.0.max: min must be <= max."


def test_negative_bond_radius_is_refused_at_its_key() -> None:
    assert refused(rocksalt_raw(), ("setBondRadius", 0, -0.01)).startswith("bonds.0.radius:")


def test_added_bond_rule_takes_the_schema_defaults() -> None:
    before = parsed(rocksalt_raw())
    result = edited(rocksalt_raw(), ("addBondRule", "Mg", "Mg", 2.5, 3.0))
    assert result["config"]["bonds"][:1] == before["bonds"]
    assert result["config"]["bonds"][1] == {
        "a": "Mg",
        "b": "Mg",
        "min_distance": 2.5,
        "max_distance": 3.0,
        **DEFAULT_BOND,
        **DEFAULT_BOND_FIELDS,
    }


def test_added_bond_rule_with_min_above_max_is_refused_at_its_index() -> None:
    assert refused(rocksalt_raw(), ("addBondRule", "O", "Mg", 3.0, 2.0)) == "bonds.1.max: min must be <= max."


def test_removed_bond_rule_is_gone() -> None:
    result = edited(rocksalt_raw(), ("removeBondRule", 0))
    assert result["config"]["bonds"] == []


@pytest.mark.parametrize(
    "step",
    [("setBondWindow", 3, 1.0, 2.0), ("setBondVisible", 1, True), ("removeBondRule", 5)],
)
def test_a_rule_index_out_of_range_is_refused_with_the_index(step: tuple[str, ...]) -> None:
    message = refused(rocksalt_raw(), step)
    assert message.startswith(f"bonds.{step[1]}: there is no rule at this index (the config has 1 in bonds)")


# ---- polyhedra ------------------------------------------------------------------------------------------------------


def test_polyhedron_ligands_are_sorted_and_unique() -> None:
    result = edited(rocksalt_raw(), ("setPolyhedronLigands", 0, ["O", "Mg", "O"]))
    assert result["config"]["polyhedra"][0]["ligands"] == ["Mg", "O"]


def test_empty_polyhedron_ligands_are_refused_at_ligands() -> None:
    assert refused(rocksalt_raw(), ("setPolyhedronLigands", 0, [])).startswith("polyhedra.0.ligands:")


def test_polyhedron_window_visibility_and_colour_change_only_their_fields() -> None:
    before = parsed(rocksalt_raw())
    cases = [
        (("setPolyhedronWindow", 0, 1.5, 2.6), ["polyhedra.0.max_distance", "polyhedra.0.min_distance"]),
        (("setPolyhedronVisible", 0, False), ["polyhedra.0.visible"]),
        (("setPolyhedronColor", 0, [0.0, 1.0, 0.0, 0.5]), ["polyhedra.0.color"]),
    ]
    for step, paths in cases:
        assert changed_paths(before, edited(rocksalt_raw(), step)["config"]) == paths


def test_added_polyhedron_rule_takes_the_schema_defaults_and_image_centres() -> None:
    result = edited(rocksalt_raw(), ("addPolyhedronRule", "O", ["Mg"], 1.8, 2.4))
    assert result["config"]["polyhedra"][1] == {
        "center": "O",
        "ligands": ["Mg"],
        "min_distance": 1.8,
        "max_distance": 2.4,
        "min_coordination": 4,
        "max_coordination": None,
        "visible": True,
        "color": [0.2, 0.6, 1.0, 1],
        "material": "polyhedron",
        "name": None,
        "topology_mode": "topology_locked",
        "image_centers": True,
    }


def test_polyhedron_centre_changes_only_the_centre() -> None:
    before = parsed(rocksalt_raw())
    result = edited(rocksalt_raw(), ("setPolyhedronCenter", 0, "O"))
    assert changed_paths(before, result["config"]) == ["polyhedra.0.center"]


def test_removed_polyhedron_rule_is_gone() -> None:
    assert edited(rocksalt_raw(), ("removePolyhedronRule", 0))["config"]["polyhedra"] == []


def test_polyhedron_window_with_min_above_max_is_refused() -> None:
    assert refused(rocksalt_raw(), ("setPolyhedronWindow", 0, 2.6, 1.5)) == "polyhedra.0.max: min must be <= max."


# ---- clusters -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "min_size", "max_size"),
    [("ring", 5, 7), ("molecule", 4, None)],
)
def test_added_cluster_rule_takes_the_sizes_of_its_kind(kind: str, min_size: int, max_size: int | None) -> None:
    result = edited(rocksalt_with_clusters(), ("addClusterRule", kind, ["O"], 1.0, 2.0))
    rule = result["config"]["clusters"][1]
    assert (rule["kind"], rule["min_size"], rule["max_size"]) == (kind, min_size, max_size)


def test_cluster_edits_change_only_their_fields() -> None:
    before = parsed(rocksalt_with_clusters())
    cases = [
        (("setClusterVisible", 0, False), ["clusters.0.visible"]),
        (("setClusterColor", 0, [0.0, 0.0, 1.0, 0.5]), ["clusters.0.color"]),
        (("setClusterWindow", 0, 1.0, 2.0), ["clusters.0.max_distance", "clusters.0.min_distance"]),
    ]
    for step, paths in cases:
        assert changed_paths(before, edited(rocksalt_with_clusters(), step)["config"]) == paths


def test_cluster_atoms_replace_the_set() -> None:
    before = parsed(rocksalt_with_clusters())
    result = edited(rocksalt_with_clusters(), ("setClusterAtoms", 0, ["O", "Mg", "O"]))
    assert changed_paths(before, result["config"]) == ["clusters.0.atoms"]
    assert result["config"]["clusters"][0]["atoms"] == ["Mg", "O"]


def test_empty_cluster_atoms_are_refused_at_atoms() -> None:
    assert refused(rocksalt_with_clusters(), ("setClusterAtoms", 0, [])).startswith("clusters.0.atoms:")


def test_cluster_kind_change_re_resolves_the_member_counts() -> None:
    """A molecule's max_size is no limit; as a ring it takes the ring's 5 to 7. Back to a molecule, the counts are its
    own again. The same kind keeps the counts the rule has."""
    result = edited(
        rocksalt_with_clusters(),
        ("addClusterRule", "molecule", ["Mg"], 1.0, 2.0),
        ("setClusterKind", 1, "ring"),
    )
    ring = result["config"]["clusters"][1]
    assert (ring["kind"], ring["min_size"], ring["max_size"]) == ("ring", 5, 7)
    molecule = edited(
        rocksalt_with_clusters(),
        ("addClusterRule", "molecule", ["Mg"], 1.0, 2.0),
        ("setClusterKind", 1, "ring"),
        ("setClusterKind", 1, "molecule"),
    )["config"]["clusters"][1]
    assert (molecule["kind"], molecule["min_size"], molecule["max_size"]) == ("molecule", 4, None)


def test_cluster_kind_to_its_own_kind_keeps_the_counts() -> None:
    before = parsed(rocksalt_with_clusters())
    result = edited(rocksalt_with_clusters(), ("setClusterKind", 0, "ring"))
    assert changed_paths(before, result["config"]) == []


def test_a_benzene_ring_changed_to_a_molecule_validates() -> None:
    """Detection makes benzene's ring flat. A molecule cannot be flat, so the change drops flat with the member counts,
    and the edited config validates in Python."""
    (result,) = run([{"fn": "defaultConfigFixture", "args": [MOLECULE_NAME, molecule_extxyz(benzene())]}])
    raw = _unwrap(result)["data"]
    [index] = [position for position, rule in enumerate(raw["clusters"]) if rule["kind"] == "ring"]
    assert raw["clusters"][index]["flat"] is True
    changed = edited(raw, ("setClusterKind", index, "molecule"))
    assert changed["data"]["clusters"][index]["kind"] == "molecule"
    assert python_config(changed["data"])["clusters"][index]["kind"] == "molecule"


def test_supercell_changes_only_the_supercell() -> None:
    before = parsed(rocksalt_raw())
    result = edited(rocksalt_raw(), ("setSupercell", [2, 2, 1]))
    assert changed_paths(before, result["config"]) == ["cell.supercell"]


def test_box_axis_is_set_and_then_given_back_to_the_whole_cell() -> None:
    before = parsed(rocksalt_raw())
    boxed = edited(rocksalt_raw(), ("setBox", "z", [0.2, 0.8]))
    assert changed_paths(before, boxed["config"]) == ["cell.box.z"]
    assert boxed["config"]["cell"]["box"]["z"] == [0.2, 0.8]
    restored = edited(rocksalt_raw(), ("setBox", "z", [0.2, 0.8]), ("setBox", "z", None))
    assert changed_paths(before, restored["config"]) == []


def test_box_with_low_above_high_is_refused_at_the_box() -> None:
    assert "box ranges must be [low, high] with low <= high." in refused(rocksalt_raw(), ("setBox", "x", [0.8, 0.2]))


def test_box_ends_set_the_three_axes_in_one_edit() -> None:
    result = edited(rocksalt_raw(), ("setBoxEnds", {"from": [0.1, 0.2, 0.3], "to": [0.9, 0.8, 0.7]}))
    assert result["config"]["cell"]["box"] == {"x": [0.1, 0.9], "y": [0.2, 0.8], "z": [0.3, 0.7]}


def test_box_ends_leave_out_an_axis_that_spans_the_whole_cell() -> None:
    result = edited(rocksalt_raw(), ("setBoxEnds", {"from": [0.0, 0.2, 0.0], "to": [1.0, 0.8, 1.0]}))
    assert result["config"]["cell"]["box"] == {"y": [0.2, 0.8]}
    assert changed_paths(parsed(rocksalt_raw()), result["config"]) == ["cell.box.y"]


def test_box_ends_replace_a_box_set_before() -> None:
    result = edited(
        rocksalt_raw(),
        ("setBox", "z", [0.2, 0.8]),
        ("setBoxEnds", {"from": [0.0, 0.0, 0.0], "to": [1.0, 1.0, 1.0]}),
    )
    assert result["config"]["cell"]["box"] == {}


def test_box_ends_with_low_above_high_on_one_axis_are_refused_at_the_box() -> None:
    message = refused(rocksalt_raw(), ("setBoxEnds", {"from": [0.9, 0.0, 0.0], "to": [0.1, 1.0, 1.0]}))
    assert "box ranges must be [low, high] with low <= high." in message


def test_periodic_flag_changes_only_its_axis() -> None:
    before = parsed(rocksalt_raw())
    result = edited(rocksalt_raw(), ("setPeriodic", "z", False))
    assert changed_paths(before, result["config"]) == ["cell.periodic"]


# ---- the input, and the file form ----------------------------------------------------------------------------------


def test_a_chain_of_edits_leaves_the_input_config_unchanged() -> None:
    raw = rocksalt_with_clusters()
    steps = (
        ("setElementVisible", "O", False),
        ("setBondWindow", 0, 1.5, 2.8),
        ("addPolyhedronRule", "O", ["Mg"], 1.8, 2.4),
        ("setBox", "x", [0.1, 0.9]),
        ("removeClusterRule", 0),
    )
    before = copy.deepcopy(raw)
    edited(raw, *steps)
    assert raw == before


CHAINS = {
    "element": (("setElementVisible", "O", False), ("setElementColor", "Na", [0.1, 0.2, 0.3, 1.0])),
    "bonds": (("setBondWindow", 0, 1.5, 2.8), ("addBondRule", "O", "O", 2.5, 3.0), ("removeBondRule", 0)),
    "polyhedra": (("setPolyhedronLigands", 0, ["Mg", "O"]), ("addPolyhedronRule", "O", ["Mg"], 1.8, 2.4)),
    "clusters": (("addClusterRule", "ring", ["Mg"], 1.3, 1.5), ("setClusterColor", 1, [0.0, 0.0, 1.0, 0.5])),
    "cell": (("setSupercell", [2, 2, 1]), ("setBox", "y", [0.0, 0.5]), ("setPeriodic", "z", False)),
}


@pytest.mark.parametrize("name", sorted(CHAINS))
def test_an_edited_config_validates_in_python_and_reads_back_the_same(name: str) -> None:
    result = edited(rocksalt_with_clusters(), *CHAINS[name])
    assert python_config(result["data"]) == normalize(_plain(result["config"]))


def test_the_rocksalt_config_itself_reads_the_same_in_both() -> None:
    assert python_config(rocksalt_with_clusters()) == normalize(_plain(parsed(rocksalt_with_clusters())))


# ---- compile parity ------------------------------------------------------------------------------------------------

PARITY_STEPS = (
    ("setBondWindow", 0, 1.5, 2.8),
    ("setElementColor", "O", [0.1, 0.2, 0.9, 1.0]),
    ("setSupercell", [2, 2, 1]),
)


def test_python_compiles_an_edited_config_to_the_scene_typescript_compiles() -> None:
    result = edited(rocksalt_raw(), *PARITY_STEPS)
    data_text = json.dumps(result["data"])
    poscar = (ROCKSALT / "POSCAR").read_text(encoding="utf-8")
    disp = (ROCKSALT / "disp.json").read_text(encoding="utf-8")

    (ts,) = run(
        [
            {
                "fn": "compileFixture",
                "args": ["POSCAR", poscar, "config.json", data_text, {"disp.json": disp}],
            }
        ]
    )
    assert "ok" in ts, ts.get("error")
    python_scene, python_warnings = _python_compile(poscar, disp, data_text)
    assert _comparable(normalize(ts["ok"]["scene"])) == _comparable(python_scene)
    assert ts["ok"]["warnings"] == python_warnings


def _comparable(scene: dict[str, Any]) -> dict[str, Any]:
    """The scene with each topology's faces left out. A hull is triangulated differently by Qhull and quickhull (the
    parity of the hull faces is test_ts_compile.py's), so only the points of each topology are compared here."""
    topologies = [{k: v for k, v in topo.items() if k != "faces"} for topo in scene["topologies"]]
    return {**scene, "topologies": topologies}


def _python_compile(poscar: str, disp: str, data_text: str) -> tuple[dict[str, Any], list[str]]:
    from gemmy.compile.pipeline import compile_scene_from_files
    from gemmy.config import scene_to_dict

    with tempfile.TemporaryDirectory() as folder:
        Path(folder, "POSCAR").write_text(poscar, encoding="utf-8")
        Path(folder, "disp.json").write_text(disp, encoding="utf-8")
        Path(folder, "config.json").write_text(data_text, encoding="utf-8")
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            scene = compile_scene_from_files(Path(folder, "config.json"), structure=Path(folder, "POSCAR"))
    messages = [str(w.message) for w in caught if issubclass(w.category, UserWarning)]
    return normalize(scene_to_dict(scene)), messages


# ---- polyhedra that replace their bonds, and image centres (stishovite opened alone) ---------------------------

STISHOVITE = ROOT / "examples" / "stishovite" / "POSCAR"
SI_O_WINDOW = (1.6, 2.0)  # the window of examples/stishovite/config.toml


def stishovite_alone() -> dict[str, Any]:
    """The config a structure opened alone gets (defaultConfig), in its file form."""
    (result,) = run([{"fn": "defaultConfigFixture", "args": ["POSCAR", STISHOVITE.read_text(encoding="utf-8")]}])
    return _unwrap(result)["data"]


def _unwrap(result: dict[str, Any]) -> dict[str, Any]:
    assert "ok" in result, result.get("error")
    return result["ok"]


def test_a_polyhedron_on_stishovite_alone_has_image_centres_and_hides_the_si_o_bond() -> None:
    raw = stishovite_alone()
    before = parsed(raw)
    result = edited(raw, ("addPolyhedronReplacingBonds", "Si", ["O"], *SI_O_WINDOW))
    after = result["config"]
    assert after["polyhedra"][-1]["image_centers"] is True
    [si_o] = [index for index, rule in enumerate(after["bonds"]) if {rule["a"], rule["b"]} == {"Si", "O"}]
    assert after["bonds"][si_o]["visible"] is False
    # Stishovite opened alone already hides Si-O (defaultConfig), so the polyhedron changes only its list.
    assert sorted(changed_paths(before, after)) == ["polyhedra"]


def test_the_hidden_bond_comes_back_with_show() -> None:
    raw = stishovite_alone()
    shown = edited(raw, ("addPolyhedronReplacingBonds", "Si", ["O"], *SI_O_WINDOW), ("setBondVisible", 0, True))
    assert shown["config"]["bonds"][0]["visible"] is True


def test_a_bond_to_a_non_ligand_stays_visible() -> None:
    raw = rocksalt_raw()
    raw["bonds"].append({"a": "Mg", "b": "Mg", "min": 2.9, "max": 3.3})
    result = edited(raw, ("addPolyhedronReplacingBonds", "O", ["Mg"], 1.8, 2.4))
    assert [rule["visible"] for rule in result["config"]["bonds"]] == [False, True]


def test_the_image_centres_switch_changes_only_its_field() -> None:
    before = parsed(rocksalt_raw())
    result = edited(rocksalt_raw(), ("setPolyhedronImageCentres", 0, True))
    assert changed_paths(before, result["config"]) == ["polyhedra.0.image_centers"]


def test_a_polyhedron_on_stishovite_alone_compiles_the_same_in_python_and_typescript(tmp_path: Path) -> None:
    from gemmy.compile.pipeline import compile_scene_from_files
    from gemmy.config import scene_to_dict

    raw = stishovite_alone()
    data = edited(raw, ("addPolyhedronReplacingBonds", "Si", ["O"], *SI_O_WINDOW))["data"]
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(data), encoding="utf-8")
    compiled = run(
        [
            {
                "fn": "compileFixture",
                "args": ["POSCAR", STISHOVITE.read_text(encoding="utf-8"), "config.json", json.dumps(data), {}],
            }
        ]
    )
    scene = normalize(_unwrap(compiled[0])["scene"])
    python_scene = normalize(scene_to_dict(compile_scene_from_files(config_path, STISHOVITE)))
    # Hull faces are triangulated differently by Qhull and quickhull, so each face is compared as its point set.
    assert _comparable(scene) == _comparable(python_scene)
    assert _facet_sets(scene) == _facet_sets(python_scene)


def _facet_sets(scene: dict[str, Any]) -> list[set[frozenset[str]]]:
    return [{frozenset(topo["point_ids"][i] for i in face) for face in topo["faces"]} for topo in scene["topologies"]]


def test_the_polyhedron_adds_only_its_ligands_beyond_the_box(tmp_path: Path) -> None:
    """No bond-completion atoms: a point outside the cell box is an O within the Si-O window of a Si, and the bonds add
    none. The box is the whole cell, so every point is inside [0, 1] except the pulled-in ligands."""
    raw = stishovite_alone()
    data = edited(raw, ("addPolyhedronReplacingBonds", "Si", ["O"], *SI_O_WINDOW))["data"]
    (result,) = run(
        [
            {
                "fn": "compileFixture",
                "args": ["POSCAR", STISHOVITE.read_text(encoding="utf-8"), "config.json", json.dumps(data), {}],
            }
        ]
    )
    points = _unwrap(result)["scene"]["points"]
    silicon = [point["position"] for point in points if point["element"] == "Si"]
    outside = [point for point in points if any(not 0 <= f <= 1 for f in point["fractional"])]
    assert outside, "the polyhedron should pull in ligands outside the box"
    for point in outside:
        assert point["element"] == "O"
        assert any(SI_O_WINDOW[0] <= _distance(point["position"], si) <= SI_O_WINDOW[1] for si in silicon)


def _distance(a: list[float], b: list[float]) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b, strict=True)) ** 0.5


# ---- automatic bonds: re-detect and clear (one owned rule per element pair) -------------------------------------

DEFAULTS = ROOT / "configs" / "default.json"


def _detected(path: Path, tolerance: float, metal_pairs: bool = False) -> list[dict[str, Any]]:
    job = {
        "fn": "detectedRulesFixture",
        "args": [
            path.name,
            path.read_text(encoding="utf-8"),
            DEFAULTS.read_text(encoding="utf-8"),
            tolerance,
            metal_pairs,
        ],
    }
    return _unwrap(run([job])[0])


def _default_data(path: Path) -> dict[str, Any]:
    """The config a structure opened alone gets, in its file form."""
    (result,) = run([{"fn": "defaultConfigFixture", "args": [path.name, path.read_text(encoding="utf-8")]}])
    return _unwrap(result)["data"]


def _owned(config: dict[str, Any]) -> list[str]:
    """The element pairs of a config's bond rules, as the page keeps them (one per pair, in either order)."""
    return [json.dumps(sorted([rule["a"], rule["b"]]), separators=(",", ":")) for rule in parsed(config)["bonds"]]


def _pairs(config: dict[str, Any]) -> list[tuple[str, str]]:
    return [(rule["a"], rule["b"]) for rule in parsed(config)["bonds"]]


def test_re_detect_twice_gives_equal_configs() -> None:
    raw = _default_data(STISHOVITE)
    owned = _owned(raw)
    first = edited(raw, ("replaceAutomaticBonds", owned, _detected(STISHOVITE, 0.15)))["data"]
    second = edited(first, ("replaceAutomaticBonds", owned, _detected(STISHOVITE, 0.15)))["data"]
    assert second == first


def test_re_detect_after_a_tolerance_change_replaces_the_windows_in_place() -> None:
    """Rock salt: only Mg-O has a window. A wider tolerance widens that one rule and adds none."""
    raw = _default_data(ROCKSALT / "POSCAR")
    owned = _owned(raw)
    before = parsed(raw)["bonds"]
    after = edited(raw, ("replaceAutomaticBonds", owned, _detected(ROCKSALT / "POSCAR", 0.3)))["config"]["bonds"]
    assert len(after) == len(before) == 1
    assert after[0]["max_distance"] > before[0]["max_distance"]
    assert (after[0]["a"], after[0]["b"]) == (before[0]["a"], before[0]["b"])


def test_a_user_edited_pair_survives_and_is_not_duplicated() -> None:
    """The panel takes an edited pair out of the owned set: detection then leaves its rule alone, adds no second one."""
    raw = _default_data(STISHOVITE)
    result = edited(
        raw,
        ("setBondColor", 0, [1.0, 0.0, 0.0, 1.0]),
        ("replaceAutomaticBonds", [], _detected(STISHOVITE, 0.15)),
    )
    assert _pairs(result["data"]) == [("O", "Si")]
    assert result["config"]["bonds"][0]["color"] == [1.0, 0.0, 0.0, 1.0]


def test_clear_then_re_detect_restores_the_same_pairs() -> None:
    raw = _default_data(STISHOVITE)
    owned = _owned(raw)
    cleared = edited(raw, ("clearAutomaticBonds", owned))["data"]
    assert parsed(cleared)["bonds"] == []
    restored = edited(cleared, ("replaceAutomaticBonds", [], _detected(STISHOVITE, 0.15)))["config"]
    assert [(rule["a"], rule["b"]) for rule in restored["bonds"]] == _pairs(raw)


def test_re_detect_at_a_higher_tolerance_adds_the_wider_rule() -> None:
    raw = _default_data(STISHOVITE)
    owned = _owned(raw)
    wider = _detected(STISHOVITE, 0.5)
    result = edited(raw, ("replaceAutomaticBonds", owned, wider))
    # At 0.5 the Si-O window widens, and Si-Si (about 3.0 A apart) comes into its window too: a new pair, a new rule.
    assert sorted(_pairs(result["data"])) == [("O", "Si"), ("Si", "Si")]
    si_o = next(rule for rule in result["config"]["bonds"] if (rule["a"], rule["b"]) == ("O", "Si"))
    assert si_o["max_distance"] == pytest.approx(wider[0]["max_distance"])


# ---- automatic polyhedra: re-detect and clear (one owned polyhedron per centre element) ----------------------------


def _detected_polyhedra(path: Path) -> list[dict[str, Any]]:
    (result,) = run([{"fn": "defaultPolyhedraFixture", "args": [path.name, path.read_text(encoding="utf-8")]}])
    return _unwrap(result)


def _owned_centres(config: dict[str, Any]) -> list[str]:
    """The centre elements of a config's polyhedra, as the page keeps them (one automatic polyhedron per centre)."""
    return [rule["center"] for rule in parsed(config)["polyhedra"]]


def test_re_detect_polyhedra_twice_gives_equal_configs() -> None:
    raw = _default_data(STISHOVITE)
    owned = _owned_centres(raw)
    detected = _detected_polyhedra(STISHOVITE)
    emitted = [rule["center"] for rule in detected]  # stishovite's Si draws its polyhedron
    first = edited(raw, ("replaceAutomaticPolyhedra", owned, detected, emitted))["data"]
    second = edited(first, ("replaceAutomaticPolyhedra", owned, detected, emitted))["data"]
    assert second == first


def test_a_user_polyhedron_survives_re_detect_and_clear_automatic() -> None:
    """A user's polyhedron on O (not a detected centre) is not touched by either action; the automatic Si one is."""
    raw = _default_data(STISHOVITE)
    owned = _owned_centres(raw)
    with_user = edited(raw, ("addPolyhedronRule", "O", ["Si"], 1.5, 2.2))["data"]
    detected = _detected_polyhedra(STISHOVITE)
    redetected = edited(
        with_user, ("replaceAutomaticPolyhedra", owned, detected, [rule["center"] for rule in detected])
    )
    cleared = edited(with_user, ("clearAutomaticPolyhedra", owned))
    for result in (redetected, cleared):
        user_rows = [rule for rule in parsed(result["data"])["polyhedra"] if rule["center"] == "O"]
        assert [rule["ligands"] for rule in user_rows] == [["Si"]]
    assert sorted(_owned_centres(redetected["data"])) == ["O", "Si"]
    assert _owned_centres(cleared["data"]) == ["O"]


def test_clear_removes_only_the_owned_pairs() -> None:
    raw = _default_data(STISHOVITE)
    result = edited(raw, ("addBondRule", "O", "O", 2.5, 3.0), ("clearAutomaticBonds", _owned(raw)))
    assert _pairs(result["data"]) == [("O", "O")]


# ---- the bonds a polyhedron draws: hidden by its rule, shown by Clear, kept hidden by re-detect ----------


def _si_o_rule(config: dict[str, Any]) -> dict[str, Any]:
    return next(rule for rule in config["bonds"] if {rule["a"], rule["b"]} == {"Si", "O"})


def test_clear_automatic_polyhedra_shows_si_o_again() -> None:
    result = edited(stishovite_alone(), ("clearAutomaticPolyhedra", ["Si"]))
    assert result["config"]["polyhedra"] == []
    assert _si_o_rule(result["config"])["visible"] is True


def test_a_user_hidden_bond_stays_hidden_after_clear() -> None:
    raw = stishovite_alone()
    hidden_index = len(raw["bonds"])  # the O-O rule added last
    with_hidden = edited(raw, ("addBondRule", "O", "O", 2.5, 3.0), ("setBondVisible", hidden_index, False))["data"]
    result = edited(with_hidden, ("clearAutomaticPolyhedra", ["Si"]))
    [oo] = [rule for rule in result["config"]["bonds"] if (rule["a"], rule["b"]) == ("O", "O")]
    assert oo["visible"] is False
    assert _si_o_rule(result["config"])["visible"] is True


def test_re_detect_polyhedra_hides_si_o_again() -> None:
    cleared = edited(stishovite_alone(), ("clearAutomaticPolyhedra", ["Si"]))["data"]
    detected = _detected_polyhedra(STISHOVITE)
    result = edited(cleared, ("replaceAutomaticPolyhedra", [], detected, [rule["center"] for rule in detected]))
    assert _si_o_rule(result["config"])["visible"] is False
    assert _owned_centres(result["data"]) == ["Si"]


def test_re_detect_bonds_keeps_si_o_hidden() -> None:
    raw = stishovite_alone()
    result = edited(raw, ("replaceAutomaticBonds", _owned(raw), _detected(STISHOVITE, 0.15)))
    assert _si_o_rule(result["config"])["visible"] is False


def test_hiding_a_polyhedron_with_its_eye_does_not_show_its_bonds() -> None:
    result = edited(stishovite_alone(), ("setPolyhedronVisible", 0, False))
    assert _si_o_rule(result["config"])["visible"] is False
