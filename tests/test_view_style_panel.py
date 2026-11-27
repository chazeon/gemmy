"""The style panel's pure helpers (web/src/ui/style-panel-model.ts) in node: the slider domains and the default window
of a rule (the first distance shell), the names a cluster or a bond starts with, the per-axis parts of the config, and
the edit wrapper that sends a rejected edit (ConfigError) to onError and nothing else. The components themselves are
checked by the type checker and the browser test. The module runs in node, bundled by tests/viewer_bundle.py."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from viewer_bundle import available, header

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")


def _run(body: str, tmp_path: Path) -> Any:
    script = tmp_path / "style_panel.mjs"
    script.write_text(header() + body, encoding="utf-8")
    result = subprocess.run(["node", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_pair_key_orders_the_names(tmp_path: Path) -> None:
    out = _run(
        """
console.log(JSON.stringify([
  elementPairKey("O", "Mg"), elementPairKey("Mg", "O"), elementPairKey("C", "C"),
]));
""",
        tmp_path,
    )
    assert out == ['["O","Mg"]', '["O","Mg"]', '["C","C"]']


def test_pair_keys_cannot_collide_across_labels(tmp_path: Path) -> None:
    out = _run(
        """
console.log(JSON.stringify([elementPairKey("C", "O-O"), elementPairKey("C-O", "O")]));
""",
        tmp_path,
    )
    assert out[0] != out[1]


def test_distances_between_a_centre_and_its_ligands(tmp_path: Path) -> None:
    out = _run(
        """
const pk = elementPairKey;
const distances = new Map([[pk("O", "Fe"), [2.1, 2.2]], [pk("F", "Fe"), [2.0]], [pk("Fe", "Fe"), [3.0]]]);
console.log(JSON.stringify(distancesBetween(distances, "Fe", ["O", "F"])));
""",
        tmp_path,
    )
    assert out == [2.0, 2.1, 2.2]


def test_distances_within_a_set_include_each_name_with_itself(tmp_path: Path) -> None:
    out = _run(
        """
const pk = elementPairKey;
const distances = new Map([[pk("C", "C"), [1.4, 2.4]], [pk("H", "C"), [1.1]], [pk("H", "H"), [1.8]]]);
console.log(JSON.stringify(distancesWithin(distances, ["C", "H"])));
""",
        tmp_path,
    )
    assert out == [1.1, 1.4, 1.8, 2.4]


def test_domain_reaches_past_the_farthest_distance(tmp_path: Path) -> None:
    out = _run(
        """
console.log(JSON.stringify([
  distanceDomain([1.0, 2.0]),
  distanceDomain([]),
  distanceDomain([1.0]),
]));
""",
        tmp_path,
    )
    assert out[0] == pytest.approx([0, 2.25])
    assert out[1] == pytest.approx([0, 6.25])
    assert out[2] == pytest.approx([0, 1.25])


def test_default_window_is_the_first_shell(tmp_path: Path) -> None:
    out = _run(
        """
const first = [1.0, 1.1, 1.2, 2.6, 2.7];
console.log(JSON.stringify([firstShellWindow(first), firstShellWindow([]), firstShellWindow([0.05])]));
""",
        tmp_path,
    )
    assert out[0] == pytest.approx([0.9, 1.3])
    assert out[1] == [0, 3]
    assert out[2] == pytest.approx([0, 0.15])


def test_part_and_chosen_name(tmp_path: Path) -> None:
    out = _run(
        """
console.log(JSON.stringify([
  withPart([1, 1, 1], 1, 3),
  chosenName("Mg", ["O", "Mg"]),
  chosenName("Ca", ["O", "Mg"]),
  chosenName("", []),
]));
""",
        tmp_path,
    )
    assert out == [[1, 3, 1], "Mg", "O", ""]


def test_applier_reports_a_rejected_edit_and_passes_a_good_one(tmp_path: Path) -> None:
    out = _run(
        """
const sent = [];
const errors = [];
const apply = applier((next) => sent.push(next), (message) => errors.push(message));
apply(() => ({ ok: true }));
apply(() => { throw new ConfigError("min must be <= max."); });
let rethrown = null;
try {
  apply(() => { throw new TypeError("a bug"); });
} catch (error) {
  rethrown = error.message;
}
console.log(JSON.stringify({ sent, errors, rethrown }));
""",
        tmp_path,
    )
    assert out == {"sent": [{"ok": True}], "errors": ["min must be <= max."], "rethrown": "a bug"}


def test_default_pair_is_the_nearest_shell_of_two_different_names(tmp_path: Path) -> None:
    out = _run(
        """
const pk = elementPairKey;
const distances = new Map([[pk("O", "O"), [2.6, 2.7]], [pk("O", "Si"), [1.6, 1.62]], [pk("Si", "Si"), [3.1]]]);
console.log(JSON.stringify([defaultPair(distances, ["O", "Si"]), defaultPair(distances, ["Si", "O"])]));
""",
        tmp_path,
    )
    assert out == [["O", "Si"], ["Si", "O"]]


def test_default_pair_prefers_different_names_over_a_nearer_same_name_pair(tmp_path: Path) -> None:
    out = _run(
        """
const pk = elementPairKey;
const distances = new Map([[pk("O", "O"), [1.5]], [pk("O", "Si"), [1.9]]]);
console.log(JSON.stringify(defaultPair(distances, ["O", "Si"])));
""",
        tmp_path,
    )
    assert out == ["O", "Si"]


def test_new_bond_starts_at_si_o_for_stishovite_not_o_o(tmp_path: Path) -> None:
    # Stishovite-like distances, keyed as pairDistances keys them (element symbols, atomic-number order): Si-O at
    # 1.76 and 1.81 A, O-O at 2.3 A. The Add row starts with defaultBondNames, the function the bond section calls.
    out = _run(
        """
const pk = elementPairKey;
const distances = new Map([[pk("O", "O"), [2.3]], [pk("O", "Si"), [1.758, 1.81, 2.6]], [pk("Si", "Si"), [3.1]]]);
console.log(JSON.stringify([defaultBondNames(distances, ["O", "Si"]), defaultBondNames(new Map(), ["O", "Si"])]));
""",
        tmp_path,
    )
    assert out == [["O", "Si"], ["O", "O"]]


def test_default_pair_falls_back_to_a_same_name_pair_and_to_none(tmp_path: Path) -> None:
    out = _run(
        """
const pk = elementPairKey;
const distances = new Map([[pk("Fe", "Fe"), [2.5]], [pk("O", "Si"), [1.6]]]);
console.log(JSON.stringify([
  defaultPair(distances, ["Fe"]),
  defaultPair(new Map(), ["Fe"]),
  defaultPair(distances, ["C"]),
]));
""",
        tmp_path,
    )
    assert out == [["Fe", "Fe"], None, None]


def test_a_cluster_starts_with_the_nearest_pairs_names(tmp_path: Path) -> None:
    out = _run(
        """
const pk = elementPairKey;
const distances = new Map([[pk("O", "O"), [2.6]], [pk("O", "Si"), [1.6]]]);
console.log(JSON.stringify([defaultClusterAtoms(distances, ["O", "Si"]), defaultClusterAtoms(new Map(), ["O"])]));
""",
        tmp_path,
    )
    assert out == [["O", "Si"], []]
