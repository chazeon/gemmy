from __future__ import annotations

import unittest

from gemmy.compile.pipeline import compile_scene, compile_scene_from_files
from gemmy.compile.selection import SelectionError, parse_site_ref
from gemmy.config import load_scene_config, scene_config_from_dict
from gemmy.structure import load_structure
from golden import FIXTURES

DIR = FIXTURES / "select_shell"


def _compile(select: dict):
    structure = load_structure(DIR / "POSCAR")
    raw = {"select": select, "cells": {"periodic": [True, True, True]}, "elements": {"default": {}}}
    return compile_scene(structure, scene_config_from_dict(raw))


class TestSelection(unittest.TestCase):
    def test_empty_selection_shows_everything(self) -> None:
        full = compile_scene_from_files(
            FIXTURES / "rocksalt" / "config.json", structure=FIXTURES / "rocksalt" / "POSCAR"
        )
        cfg = load_scene_config(FIXTURES / "rocksalt" / "config.json")
        self.assertFalse(cfg.select.is_active())
        self.assertGreater(len(full.primitives.atoms), 7)

    def test_labels_and_indices(self) -> None:
        scene = _compile({"labels": ["O"]})
        self.assertTrue(scene.points)
        self.assertEqual({p.element for p in scene.points}, {"O"})
        only = _compile({"indices": [0]})
        self.assertEqual({p.element for p in only.points}, {"Mg"})
        self.assertEqual(len(only.points), 8)  # Mg 0 sits on a corner: 8 copies

    def test_shell_of_matches_polyhedron_shell(self) -> None:
        scene = compile_scene_from_files(DIR / "config.json", structure=DIR / "POSCAR")
        elements = sorted(a.element for a in scene.primitives.atoms)
        self.assertEqual(elements, ["Mg"] + ["O"] * 6)

    def test_unknown_atom_raises(self) -> None:
        with self.assertRaises(SelectionError):
            _compile({"shell_of": 99})
        with self.assertRaises(SelectionError):
            _compile({"shell_of": "0+1_0"})

    def test_site_ref_parsing(self) -> None:
        self.assertEqual(parse_site_ref(5), (5, None))
        self.assertEqual(parse_site_ref("5"), (5, None))
        self.assertEqual(parse_site_ref("5+1_0_-1"), (5, (1, 0, -1)))

    def test_shell_of_an_image_is_the_same_shell_translated(self) -> None:
        cfg = load_scene_config(DIR / "config.json")
        index = cfg.select.shell_of
        structure = load_structure(DIR / "POSCAR")
        a = structure.lattice[0]
        base = compile_scene(structure, cfg)
        moved = compile_scene(
            structure, cfg.model_copy(update={"select": cfg.select.model_copy(update={"shell_of": f"{index}+1_0_0"})})
        )
        pos = lambda scene: sorted(tuple(round(c, 6) for c in p.position) for p in scene.points)  # noqa: E731
        shifted = sorted(tuple(round(c + d, 6) for c, d in zip(p, a, strict=True)) for p in pos(base))
        self.assertEqual(pos(moved), shifted)


if __name__ == "__main__":
    unittest.main()
