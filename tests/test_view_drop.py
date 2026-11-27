"""What a drop holds, grouped (web/src/scene/drop.ts): each structure file is a structure, named by its format's row
in structure/readers.ts, and every other file is a sidecar (or, with no structure, a scene file). Run in node through
tests/viewer_bundle.py."""

from __future__ import annotations

from typing import Any

import pytest

from viewer_bundle import available, node_json

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")


def _groups(names: list[str]) -> dict[str, Any]:
    """groupFiles over the names (the objects are the names themselves): structures as (file, format), and others."""
    return node_json(
        "const { structures, others } = groupFiles(args[0], (name) => name);\n"
        "const result = { structures: structures.map(({ file, reader }) => [file, reader.name]), others };",
        names,
    )


def test_a_structure_is_grouped_with_its_format_and_the_rest_are_sidecars() -> None:
    found = _groups(["POSCAR", "config.toml", "labels.json", "ice.cif"])
    assert found == {
        "structures": [["POSCAR", "vasp"], ["ice.cif", "cif"]],
        "others": ["config.toml", "labels.json"],
    }


def test_each_structure_file_is_its_own_structure() -> None:
    found = _groups(["a.xyz", "b.extxyz", "data.nacl"])
    assert found["structures"] == [["a.xyz", "extxyz"], ["b.extxyz", "extxyz"], ["data.nacl", "lammps-data"]]
    assert found["others"] == []


def test_with_no_structure_every_file_is_a_scene_file() -> None:
    found = _groups(["scene.json", "other.json.gz"])
    assert found == {"structures": [], "others": ["scene.json", "other.json.gz"]}


def test_a_name_that_matches_no_format_is_not_a_structure() -> None:
    assert _groups(["notes.txt"]) == {"structures": [], "others": ["notes.txt"]}


def _sources(names: list[str]) -> list[dict[str, Any]]:
    """sourcesOf over the names (the objects are {name}): each source's kind, its file name and its sidecars' names."""
    return node_json(
        "const files = args[0].map((name) => ({ name }));\n"
        "const result = sourcesOf(files).map((source) => ({\n"
        "  kind: source.kind,\n"
        "  name: source.file.name,\n"
        "  sidecars: source.sidecars?.map((file) => file.name) ?? null,\n"
        "}));",
        names,
    )


def test_each_structure_is_a_structure_tab_with_the_other_files_as_sidecars() -> None:
    assert _sources(["POSCAR", "config.toml"]) == [{"kind": "structure", "name": "POSCAR", "sidecars": ["config.toml"]}]
    found = _sources(["a.xyz", "labels.json", "b.cif"])
    assert [(s["name"], s["sidecars"]) for s in found] == [
        ("a.xyz", ["labels.json"]),
        ("b.cif", ["labels.json"]),
    ]


def test_with_no_structure_the_files_are_scene_tabs() -> None:
    assert _sources(["scene.json"]) == [{"kind": "file", "name": "scene.json", "sidecars": None}]
