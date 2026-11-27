from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from gemmy.compile.clusters import ClusterRule, matching_atoms, molecule_name
from gemmy.compile.labels import LabelError, load_label_file, run_labeler
from gemmy.compile.pipeline import compile_scene, compile_scene_from_files
from gemmy.compile.polyhedra import is_ligand, rules_for_center
from gemmy.compile.selection import apply_selection
from gemmy.compile.sites import Site
from gemmy.config import PolyhedronRule, SelectConfig, load_scene_config, scene_config_from_dict
from gemmy.readers import load_structure
from gemmy.readers.record import AtomRecord, Structure
from golden import FIXTURES

DIR = FIXTURES / "labels"
_CLUSTER_WINDOW = {"min_distance": 1.3, "max_distance": 1.5, "min_size": 3, "max_size": 6}


def _radii(scene) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for atom in scene.primitives.atoms:
        out.setdefault(atom.element, []).append(atom.radius)
    return out


class TestLabels(unittest.TestCase):
    def test_poscar_labels_style_and_bond_by_label(self) -> None:
        scene = compile_scene_from_files(DIR / "config.json", structure=DIR / "POSCAR")
        radii = _radii(scene)
        self.assertEqual(sorted(set(radii["H"])), [0.1, 0.2])  # H2 and H1 styled by their own labels
        bond_radii = sorted(b.radius for b in scene.primitives.bonds)
        # one O-H rule per H label: O-H1 draws 0.06 (one H1), O-H2 draws 0.04 (two H2); the H style matches no atom
        self.assertEqual(bond_radii.count(0.06), 1)
        self.assertEqual(bond_radii.count(0.04), 2)

    def test_rules_selection_and_names_use_the_label(self) -> None:
        c_dna = Site(0, "C", "C_dna", (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
        c = Site(1, "C", "C", (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
        c_dna2 = Site(2, "C", "C_dna", (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
        polyhedron = PolyhedronRule(center="C", ligands={"C"}, min_distance=1.0, max_distance=2.0)
        self.assertEqual(rules_for_center([polyhedron], c_dna), [])
        self.assertEqual(rules_for_center([polyhedron], c), [polyhedron])
        self.assertFalse(is_ligand(polyhedron, c_dna))
        self.assertTrue(is_ligand(polyhedron, c))
        self.assertTrue(matching_atoms(ClusterRule(kind="ring", atoms=["C"], **_CLUSTER_WINDOW), c))
        self.assertFalse(matching_atoms(ClusterRule(kind="ring", atoms=["C"], **_CLUSTER_WINDOW), c_dna))
        dna_molecule = ClusterRule(kind="molecule", atoms=["C_dna"], **{**_CLUSTER_WINDOW, "max_size": None})
        self.assertEqual(molecule_name(dna_molecule, [c_dna, c_dna2]), "C_dna2")
        # a selection by label keeps only the atoms with that exact label
        cell = np.eye(3) * 10.0
        kept = apply_selection([c_dna, c], SelectConfig(labels=["C"]), {0: c_dna, 1: c}, {}, [], cell)
        self.assertEqual([s.index for s in kept], [1])

    def test_names_match_the_label_exactly(self) -> None:
        # A C_dna atom is not a C: the C style and the C-C rule leave it alone, and "C" does not match it.
        structure = Structure(
            comment="two carbons",
            lattice=((10.0, 0, 0), (0, 10.0, 0), (0, 0, 10.0)),
            atoms=[AtomRecord("C", (0.0, 0.0, 0.0), style_key="C_dna"), AtomRecord("C", (1.5, 0.0, 0.0))],
        )
        config = scene_config_from_dict(
            {
                "cells": {"periodic": [False, False, False]},
                "elements": {"C": {"radius": 0.5}, "default": {"radius": 0.3}},
                "bonds": [{"a": "C", "b": "C", "min": 1.0, "max": 2.0}],
            }
        )
        scene = compile_scene(structure, config)
        self.assertEqual(scene.primitives.bonds, [])
        self.assertEqual({atom.label: atom.radius for atom in scene.primitives.atoms}, {"C_dna": 0.3, "C": 0.5})

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

    def test_one_atom_with_two_labels_is_an_error(self) -> None:
        # The lowest atom with two labels is named, its labels sorted (JS keeps integer-like keys first).
        cases = [
            ('{"O1": [3], "3": "H2"}', "atom 3 is given two labels, 'H2' and 'O1'"),
            ('{"O": ["5-9"], "7": "A"}', "atom 7 is given two labels, 'A' and 'O'"),
        ]
        for text, message in cases:
            with tempfile.TemporaryDirectory() as td:
                path = Path(td) / "labels.json"
                path.write_text(text, encoding="utf-8")
                with self.assertRaises(LabelError) as ctx:
                    load_label_file(path)
                self.assertEqual(str(ctx.exception), f"label file {path}: {message}")

    def test_same_label_twice_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "labels.json"
            path.write_text('{"O1": [3], "3": "O1"}', encoding="utf-8")
            self.assertEqual(load_label_file(path), {3: "O1"})

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
