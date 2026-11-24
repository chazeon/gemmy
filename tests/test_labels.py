from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from gemmy.compile.labels import LabelError, load_label_file, run_labeler
from gemmy.compile.pipeline import compile_scene, compile_scene_from_files
from gemmy.config import load_scene_config, scene_config_from_dict
from gemmy.structure import load_structure
from golden import FIXTURES

DIR = FIXTURES / "labels"


def _radii(scene) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for atom in scene.primitives.atoms:
        out.setdefault(atom.element, []).append(atom.radius)
    return out


class TestLabels(unittest.TestCase):
    def test_poscar_labels_style_and_bond_by_label_first(self) -> None:
        scene = compile_scene_from_files(DIR / "config.json", structure=DIR / "POSCAR")
        radii = _radii(scene)
        self.assertEqual(sorted(set(radii["H"])), [0.1, 0.2])  # H2 and H1 styled separately
        bond_radii = sorted(b.radius for b in scene.primitives.bonds)
        # O-H1 matches the label rule (0.06) in preference to the element rule (0.04)
        self.assertEqual(bond_radii.count(0.06), 1)
        self.assertEqual(bond_radii.count(0.04), 2)

    def test_sidecar_and_hook_override_in_order(self) -> None:
        structure = load_structure(DIR / "POSCAR")
        cfg = load_scene_config(DIR / "config.json")
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            (tmp / "labels.json").write_text(json.dumps({"H2": ["5-6"], "4": "H2"}), encoding="utf-8")
            (tmp / "hook.py").write_text("def label(s):\n    return {4: 'H1', 5: 'H1'}\n", encoding="utf-8")
            raw = json.loads((DIR / "config.json").read_text())
            raw["labels"] = {"file": "labels.json", "labeler": "hook.py:label"}
            scene = compile_scene(structure, scene_config_from_dict(raw), base_dir=tmp)
            plain = compile_scene(structure, cfg)
        self.assertEqual(sorted(_radii(plain)["H"]), [0.1, 0.1, 0.2])
        # sidecar relabels all three H as H2, then the hook sets atoms 4 and 5 to H1
        self.assertEqual(sorted(_radii(scene)["H"]), [0.1, 0.2, 0.2])
        self.assertEqual(sorted(_radii(scene)["O"]), sorted(_radii(plain)["O"]))

    def test_errors_name_the_source(self) -> None:
        with self.assertRaisesRegex(LabelError, "nope.json"):
            load_label_file("nope.json")
        with tempfile.TemporaryDirectory() as td:
            (Path(td) / "h.py").write_text("def f(s):\n    return ['A']\n", encoding="utf-8")
            with self.assertRaisesRegex(LabelError, "1 labels for 7 atoms"):
                run_labeler("h.py:f", load_structure(DIR / "POSCAR"), td)
            with self.assertRaisesRegex(LabelError, "no function"):
                run_labeler("h.py:g", load_structure(DIR / "POSCAR"), td)


if __name__ == "__main__":
    unittest.main()
