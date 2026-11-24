from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gemmy.structure import load_structure


class TestStructureLoader(unittest.TestCase):
    def test_ase_loader(self) -> None:
        if importlib.util.find_spec("ase") is None:
            self.skipTest("ASE is not installed in this environment.")
        text = """Simple
1.0
1 0 0
0 1 0
0 0 1
Si
1
Direct
0 0 0
"""
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "POSCAR"
            path.write_text(text, encoding="utf-8")
            structure = load_structure(path)
        self.assertEqual(len(structure.atoms), 1)
        self.assertEqual(structure.atoms[0].element, "Si")

    def test_extxyz_loads_like_the_same_poscar(self) -> None:
        if importlib.util.find_spec("ase") is None:
            self.skipTest("ASE is not installed in this environment.")
        from ase import Atoms
        from ase.io import write

        atoms = Atoms(
            "SiO2", scaled_positions=[(0, 0, 0), (0.3, 0.3, 0), (0.7, 0.7, 0.5)], cell=(4.0, 4.0, 2.5), pbc=True
        )
        with tempfile.TemporaryDirectory() as tmp:
            write(Path(tmp, "s.extxyz"), atoms, format="extxyz")
            write(Path(tmp, "POSCAR"), atoms, format="vasp")
            xyz, poscar = load_structure(Path(tmp, "s.extxyz")), load_structure(Path(tmp, "POSCAR"))
        self.assertEqual([a.element for a in xyz.atoms], [a.element for a in poscar.atoms])
        for p, q in zip(xyz.atoms, poscar.atoms, strict=True):
            for x, y in zip(p.fractional, q.fractional, strict=True):
                self.assertAlmostEqual(x, y, places=6)
        self.assertEqual(xyz.comment, "s.extxyz")

    def test_a_structure_without_a_cell_is_an_error(self) -> None:
        if importlib.util.find_spec("ase") is None:
            self.skipTest("ASE is not installed in this environment.")
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "m.xyz").write_text("2\nwater fragment\nO 0 0 0\nH 0 0 0.96\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "no cell"):
                load_structure(Path(tmp, "m.xyz"))

    def test_missing_ase_dependency_raises_runtime_error(self) -> None:
        original_import = __import__

        def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "ase" or name.startswith("ase."):
                raise ImportError("blocked by test")
            return original_import(name, globals, locals, fromlist, level)

        with patch("builtins.__import__", side_effect=guarded_import):
            with self.assertRaises(RuntimeError) as exc_info:
                load_structure("POSCAR")

        self.assertIn("ASE is required to load structure input", str(exc_info.exception))

    def test_vasp_custom_species_labels_are_preserved_as_style_keys(self) -> None:
        if importlib.util.find_spec("ase") is None:
            self.skipTest("ASE is not installed in this environment.")
        text = """Custom labels
1.0
1 0 0
0 1 0
0 0 1
Al O H H1 H2
1 1 1 1 1
Direct
0 0 0
0.2 0.2 0.2
0.4 0.4 0.4
0.6 0.6 0.6
0.8 0.8 0.8
"""
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "POSCAR"
            path.write_text(text, encoding="utf-8")
            structure = load_structure(path)
        self.assertEqual([a.element for a in structure.atoms], ["Al", "O", "H", "H", "H"])
        self.assertEqual([a.style_key for a in structure.atoms], ["Al", "O", "H", "H1", "H2"])


if __name__ == "__main__":
    unittest.main()
