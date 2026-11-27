"""Which dropped file is the config, and what each sidecar is (web/src/compile/files.ts), and the type signature of a
LAMMPS file (web/src/structure/types.ts). Run in node through tests/ts_bundle.py; skipped without node."""

from __future__ import annotations

from pathlib import Path

import pytest

from ts_bundle import available, run

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")

FIXTURES = Path(__file__).parent / "fixtures" / "structures"
CONFIG = 'structure = "POSCAR"\n'
LABELS = '{"0": "Fe1", "1": "O"}'
DISPLACEMENTS = '{"vectors": [{"index": 0, "dx": 0.1, "dy": 0, "dz": 0}]}'
SCENE = '{"schema_version": 3, "points": [], "primitives": {}, "materials": {}}'


def sidecar(name: str, text: str) -> dict:
    return {"name": name, "text": text}


def pick(files: list[dict], structure: str = "POSCAR") -> dict:
    """pickConfig's result: {"ok": the picked name, or null for the defaults}, or the error's type and message."""
    [result] = run([{"fn": "pickConfig", "args": [files, structure]}])
    if "ok" in result and result["ok"] is not None:
        return {"ok": result["ok"]["name"]}
    return result


def kind(name: str, text: str) -> str:
    [result] = run([{"fn": "sidecarKind", "args": [name, text]}])
    assert "ok" in result, result
    return result["ok"]


def test_the_config_named_for_the_structure_wins() -> None:
    files = [sidecar("labels.json", LABELS), sidecar("config.toml", CONFIG)]
    assert pick(files) == {"ok": "config.toml"}


def test_a_label_file_alone_is_not_a_config() -> None:
    # The bug this guards: a dropped labels.json was taken as the config. With none, the defaults apply.
    assert pick([sidecar("labels.json", LABELS)]) == {"ok": None}


def test_a_displacement_file_alone_is_not_a_config() -> None:
    assert pick([sidecar("moves.json", DISPLACEMENTS)]) == {"ok": None}


def test_a_scene_file_is_not_a_config() -> None:
    assert pick([sidecar("scene.json", SCENE)]) == {"ok": None}


def test_the_only_other_toml_or_json_is_the_config_beside_label_and_displacement_files() -> None:
    files = [sidecar("labels.json", LABELS), sidecar("moves.json", DISPLACEMENTS), sidecar("mine.toml", CONFIG)]
    assert pick(files) == {"ok": "mine.toml"}


def test_a_file_the_config_refers_to_is_not_a_config() -> None:
    # cfg.toml names labels.json; labels.json is not label-shaped, so only the reference keeps it out.
    files = [sidecar("cfg.toml", '[labels]\nfile = "names.json"\n'), sidecar("names.json", '{"x": 1}')]
    assert pick(files) == {"ok": "cfg.toml"}


def test_the_structure_stem_names_the_config() -> None:
    files = [sidecar("ice.toml", CONFIG), sidecar("other.toml", CONFIG)]
    assert pick(files, structure="ice.cif") == {"ok": "ice.toml"}


def test_several_unnamed_configs_are_an_error_that_names_them() -> None:
    result = pick([sidecar("a.toml", CONFIG), sidecar("b.json", "{}")])
    assert result["type"] == "ConfigPickError"
    assert "a.toml, b.json" in result["error"]


def test_sidecar_kinds() -> None:
    assert kind("labels.json", LABELS) == "labels"
    assert kind("labels.toml", '[labels]\n"H1" = [0, "2-3"]\n') == "labels"
    assert kind("labels.json", '{"labels": {"H1": [0, "2-3"]}}') == "labels"
    assert kind("moves.json", DISPLACEMENTS) == "displacements"
    assert kind("scene.json", SCENE) == "scene"
    assert kind("config.toml", CONFIG) == "data"
    # A config's own tables are not label maps: an empty list, or a table with a string value and a name key.
    assert kind("cfg.json", '{"bonds": [], "labels": {"file": "x.json"}}') == "data"
    assert kind("POSCAR", "anything") == "other"


def test_a_lammps_file_without_masses_has_its_types_and_no_labels() -> None:
    text = (FIXTURES / "two-types" / "two-types.dump").read_text(encoding="utf-8")
    [result] = run([{"fn": "readStructure", "args": [text, {"fileName": "two-types.dump"}]}])
    assert result["ok"]["typeSignature"] == {"types": [1, 2], "masses": None, "labels": None}
    assert result["ok"]["unresolvedTypes"] == [1, 2]


def test_a_lammps_file_with_masses_has_each_types_mass_and_label() -> None:
    text = (FIXTURES / "lammps-masses" / "mgo-masses.data").read_text(encoding="utf-8")
    [result] = run([{"fn": "readStructure", "args": [text, {"fileName": "mgo-masses.data"}]}])
    assert result["ok"]["typeSignature"] == {"types": [1, 2], "masses": [24.305, 15.999], "labels": ["Mg", "O"]}
    assert result["ok"]["unresolvedTypes"] == []


def lookup(files: list[dict], name: str) -> dict:
    """sidecarText over the dropped files: the text, null when none matches, or the error's class and message."""
    [result] = run([{"fn": "sidecarText", "args": [files, name]}])
    return result


@pytest.mark.parametrize("ref", ["labels.json", "./labels.json", "sub/../labels.json", "sub/labels.json"])
def test_a_config_path_finds_the_dropped_file_it_names(ref: str) -> None:
    # The dropped files have no folders, so a path is looked up by its normal form, then by its base name.
    assert lookup([sidecar("labels.json", LABELS)], ref) == {"ok": LABELS}


def test_a_path_that_names_no_dropped_file_finds_nothing() -> None:
    assert lookup([sidecar("labels.json", LABELS)], "other.json") == {"ok": None}


def test_several_dropped_files_with_the_name_are_an_error_that_names_them_all() -> None:
    result = lookup([sidecar("labels.json", LABELS), sidecar("labels.json", "{}")], "sub/labels.json")
    assert result["type"] == "AmbiguousFileError"
    assert result["error"].count("labels.json") >= 2


def test_a_config_is_not_taken_when_it_names_a_label_file_by_its_folder() -> None:
    # The config names sub/names.json; the dropped file is names.json, which the name finds by its base name, so it is
    # not a config candidate and the config is the one left.
    files = [sidecar("cfg.toml", '[labels]\nfile = "sub/names.json"\n'), sidecar("names.json", '{"x": 1}')]
    assert pick(files) == {"ok": "cfg.toml"}
