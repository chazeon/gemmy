"""The type presets (web/src/ui/type-presets.ts and type-presets-file.ts): parsing the browser's copy, matching a file's
signature by its type ids, the list's edits by key, the presets file's refusals, and the element rule of a label
(checked against fastatoms's reader). Run in node through tests/viewer_bundle.py and tests/ts_bundle.py."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from ts_bundle import available as ts_available
from ts_bundle import run
from viewer_bundle import available, node_json

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")

FIXTURES = Path(__file__).parent / "fixtures" / "structures"
NA_CL = {
    "name": "rock salt",
    "types": {"1": "Na", "2": "Cl"},
    "signature": {"types": [1, 2], "masses": None, "labels": None},
}
MASSES = {
    "name": "MgO",
    "types": {"1": "Mg", "2": "O"},
    "signature": {"types": [1, 2], "masses": [24.305, 15.999], "labels": None},
}
# The labels the browser's reader accepts, and the ones it refuses (fastatoms throws on those).
LABELS = [
    "Fe1",
    "fe",
    "Fe_pv",
    "Hx",
    "Xc",
    "X",
    "D",
    "T",
    "Dx",
    "Ne2-",
    "Tc",
    "Og",
    "fE",
    "Qq",
    "Zz",
    "Fee",
    "1",
    "_Fe",
]


def envelope(presets: list[Any], version: int = 2) -> str:
    """A presets file's text for these presets, as the browser keeps it."""
    return json.dumps({"format": "gemmy-type-presets", "version": version, "presets": presets})


def test_a_stored_copy_reads_its_valid_presets_and_drops_the_rest() -> None:
    stored = envelope([NA_CL, {"name": "broken"}, "not a preset"])
    assert node_json(f"const result = presetsFromStored({json.dumps(stored)});") == [NA_CL]
    for text in ["", "{not json", json.dumps([NA_CL])]:
        assert node_json(f"const result = presetsFromStored({json.dumps(text)});") == []


def test_a_version_one_copy_is_dropped_because_its_signatures_have_no_type_ids() -> None:
    old = {
        "name": "rock salt",
        "types": {"1": "Na", "2": "Cl"},
        "signature": {"count": 2, "masses": None, "labels": None},
    }
    assert node_json(f"const result = presetsFromStored({json.dumps(envelope([old], version=1))});") == []
    assert node_json(f"const result = presetsFromStored({json.dumps(envelope([old]))});") == []


def test_a_preset_matches_a_file_with_the_same_type_ids_and_metadata() -> None:
    body = (
        f"const presets = [{json.dumps(NA_CL)}, {json.dumps(MASSES)}];"
        "const sig = (types, masses = null, labels = null) => ({ types, masses, labels });"
        "const result = {"
        " same: matchingPresets(presets, sig([1, 2])).map((p) => p.name),"
        " otherIds: matchingPresets(presets, sig([1, 3])).length,"
        " moreTypes: matchingPresets(presets, sig([1, 2, 3])).length,"
        " massesDiffer: matchingPresets(presets, sig([1, 2], [24.3, 16.0])).length,"
        " withMasses: matchingPresets(presets, sig([1, 2], [24.305, 15.999])).map((p) => p.name) };"
    )
    assert node_json(body) == {
        "same": ["rock salt"],
        "otherIds": 0,
        "moreTypes": 0,
        "massesDiffer": 0,
        "withMasses": ["MgO"],
    }


def test_adding_the_same_preset_twice_keeps_one() -> None:
    body = f"const once = addPreset([], {json.dumps(NA_CL)}); const result = addPreset(once, {json.dumps(NA_CL)});"
    assert node_json(body) == [NA_CL]


def test_rename_and_delete_find_the_preset_by_its_key() -> None:
    body = (
        f"const list = [{json.dumps(NA_CL)}, {json.dumps(MASSES)}];"
        f"const result = {{ renamed: renamePreset(list, presetKey(list[1]), 'oxide').map((p) => p.name),"
        f" deleted: deletePreset(list, presetKey(list[0])).map((p) => p.name),"
        f" missing: deletePreset(list, 'no such key').length }};"
    )
    assert node_json(body) == {"renamed": ["rock salt", "oxide"], "deleted": ["MgO"], "missing": 2}


def test_a_rename_that_makes_two_presets_equal_leaves_one_of_them() -> None:
    salt = {**NA_CL, "name": "salt"}
    body = (
        f"const list = [{json.dumps(NA_CL)}, {json.dumps(salt)}];"
        f"const result = renamePreset(list, presetKey(list[1]), 'rock salt').map((p) => p.name);"
    )
    assert node_json(body) == ["rock salt"]


def test_a_presets_file_round_trips_and_merges_without_repeats() -> None:
    body = (
        f"const shared = presetsFromFile(presetsToFile([{json.dumps(NA_CL)}]));"
        f"const result = {{ shared, merged: mergePresets([{json.dumps(MASSES)}], shared).map((p) => p.name) }};"
    )
    assert node_json(body) == {"shared": [NA_CL], "merged": ["MgO", "rock salt"]}


@pytest.mark.parametrize(
    "text, message",
    [
        ("{not json", "not valid JSON"),
        ('{"format": "something-else", "version": 2, "presets": []}', "not a gemmy type presets file"),
        (envelope([], version=9), "version 9"),
        (envelope([], version=1), "version 1"),
        (envelope([{"name": 1}]), "not a valid type map"),
        (envelope([{**NA_CL, "name": "  "}]), "not a valid type map"),
        (envelope([{**NA_CL, "types": {"01": "Na", "2": "Cl"}}]), "not a valid type map"),
        (envelope([{**NA_CL, "types": {"1": "Qq", "2": "Cl"}}]), "not a valid type map"),
        (envelope([{**NA_CL, "signature": {"types": [2, 1], "masses": None, "labels": None}}]), "not a valid type map"),
        (
            envelope([{**MASSES, "signature": {"types": [1, 2], "masses": [24.3], "labels": None}}]),
            "not a valid type map",
        ),
        (
            envelope([{**MASSES, "signature": {"types": [1, 2], "masses": [None, 1.0], "labels": None}}]),
            "not a valid type map",
        ),
        (envelope([NA_CL] * 201), "more than 200 presets"),
    ],
)
def test_a_file_that_is_not_a_presets_file_is_refused_with_the_reason(text: str, message: str) -> None:
    body = (
        f"let result; try {{ presetsFromFile({json.dumps(text)}); result = 'accepted'; }}"
        " catch (e) { result = e.message; }"
    )
    assert message in node_json(body)


TWO_TYPES_TEXT = (FIXTURES / "two-types" / "two-types.dump").read_text(encoding="utf-8")
SPARSE_IDS_TEXT = TWO_TYPES_TEXT.replace("\n2 2 0.5", "\n2 3 0.5")  # the same file, its second type numbered 3


@pytest.mark.skipif(not ts_available(), reason="node or web/node_modules is missing (cd web && npm ci)")
def test_a_file_with_other_type_ids_does_not_match_a_preset() -> None:
    [read] = run([{"fn": "readStructure", "args": [SPARSE_IDS_TEXT, {"fileName": "sparse.dump"}]}])
    signature = read["ok"]["typeSignature"]
    assert signature["types"] == [1, 3]
    assert node_json(f"const result = matchingPresets([{json.dumps(NA_CL)}], {json.dumps(signature)}).length;") == 0


@pytest.mark.skipif(not ts_available(), reason="node or web/node_modules is missing (cd web && npm ci)")
def test_the_label_rule_is_the_one_fastatoms_reads_labels_by() -> None:
    reads = run(
        [
            {
                "fn": "readStructure",
                "args": [TWO_TYPES_TEXT, {"fileName": "two-types.dump", "pageTypes": {"1": label, "2": "Na"}}],
            }
            for label in LABELS
        ]
    )
    accepted = ["error" not in read for read in reads]
    named = node_json(f"const result = {json.dumps(LABELS)}.map((label) => isElementLabel(label));")
    assert named == accepted
