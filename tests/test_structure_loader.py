from __future__ import annotations

import gzip
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gemmy.readers import load_structure

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "structures"


def _fractions(structure) -> list[tuple[float, float, float]]:
    """Each atom's fractional position, rounded so that a float's last digit does not matter."""
    return [tuple(round(x, 9) for x in atom.fractional) for atom in structure.atoms]


def _read(path: Path, types) -> tuple[list[str], list[tuple[float, float, float]]]:
    structure = load_structure(path, types)
    return [atom.element for atom in structure.atoms], _fractions(structure)


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

        with patch.dict(os.environ, {"GEMMY_READER": "ase"}), patch("builtins.__import__", side_effect=guarded_import):
            with self.assertRaises(RuntimeError) as exc_info:
                load_structure("POSCAR")

        self.assertIn("ASE is required to load structure input", str(exc_info.exception))

    def test_vasp_species_label_element_matches_the_browser_reader(self) -> None:
        # Expected elements are what fastatoms (the browser reader) gives for the same POSCAR species line.
        if importlib.util.find_spec("ase") is None:
            self.skipTest("ASE is not installed in this environment.")
        cases = {
            "Fe1": "Fe",
            "Fe_pv": "Fe",
            "Fe/abc123": "Fe",
            "Fe+": "Fe",
            "O2-": "O",
            "D1": "H",
            "D": "H",
            "T": "H",
            "fe": "Fe",
            "FE": "Fe",
            "Fe2O3": "Fe",
            "Ca": "Ca",
            "Ca2x": "Ca",
            "Hx": "H",
            "Ox": "O",
            "Hf2": "Hf",
            "Zn2+": "Zn",
            "Xc": "X",
            "X_cen": "X",
            "X1": "X",
            "X": "X",
            "Xc2": "X",
            "Qq": None,
            "Carbon": None,
            "Cubic": None,
            "Oxygen": None,
            "Ab": None,
            "Xenon": None,
            "Xcen": None,
            "Hxx": None,
        }
        for label, element in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as td:
                path = Path(td) / "POSCAR"
                path.write_text(
                    f"label test\n1.0\n1 0 0\n0 1 0\n0 0 1\n{label} O\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5\n",
                    encoding="utf-8",
                )
                if element is None:
                    with self.assertRaisesRegex(ValueError, "Cannot tell which element the label"):
                        load_structure(path)
                else:
                    structure = load_structure(path)
                    self.assertEqual(structure.atoms[0].element, element)
                    self.assertEqual(structure.atoms[0].style_key, label)

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

    def test_lammps_dump_with_a_type_map_takes_labels_and_their_elements(self) -> None:
        dump = FIXTURES / "two-types" / "two-types.dump"
        structure = load_structure(dump, {1: "Mg", 2: "O"})
        self.assertEqual([a.element for a in structure.atoms], ["Mg", "O", "Mg"])
        self.assertEqual([a.style_key for a in structure.atoms], ["Mg", "O", "Mg"])
        self.assertEqual(structure.atoms[1].fractional, (0.5, 0.5, 0.5))

    def test_lammps_type_map_label_gives_the_element_and_keeps_the_label(self) -> None:
        dump = FIXTURES / "two-types" / "two-types.dump"
        structure = load_structure(dump, {1: "Fe1", 2: "O_oct"})
        self.assertEqual([a.element for a in structure.atoms], ["Fe", "O", "Fe"])
        self.assertEqual([a.style_key for a in structure.atoms], ["Fe1", "O_oct", "Fe1"])

    def test_lammps_type_map_overrides_the_masses_comments(self) -> None:
        # The Masses comments say type 1 is Mg; the map says Fe, and the map wins.
        data = FIXTURES / "lammps-masses" / "mgo-masses.data"
        structure = load_structure(data, {1: "Fe1", 2: "O"})
        self.assertEqual([a.element for a in structure.atoms], ["Fe", "O", "O", "Fe", "O", "Fe", "Fe", "O"])
        self.assertEqual([a.style_key for a in structure.atoms][:2], ["Fe1", "O"])

    def test_lammps_type_without_a_label_is_an_error_naming_the_type(self) -> None:
        dump = FIXTURES / "two-types" / "two-types.dump"
        with self.assertRaisesRegex(ValueError, r"types \[2\] have no label.*`types` key"):
            load_structure(dump, {1: "Mg"})

    def test_empty_type_map_is_no_map(self) -> None:
        dump = FIXTURES / "two-types" / "two-types.dump"
        self.assertEqual(
            [a.element for a in load_structure(dump, {}).atoms],
            [a.element for a in load_structure(dump).atoms],
        )

    def test_type_map_on_a_poscar_is_an_error(self) -> None:
        text = "Si\n1.0\n4 0 0\n0 4 0\n0 0 4\nSi O\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5\n"
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "POSCAR"
            path.write_text(text, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "is not a LAMMPS data or dump file"):
                load_structure(path, {1: "Fe"})

    def test_type_map_on_a_file_that_is_not_lammps_by_name_is_an_error(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "dump.xyz"
            path.write_text("1\n\nFe 0 0 0\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "is not a LAMMPS data or dump file"):
                load_structure(path, {1: "Mg"})

    def test_dump_without_a_type_column_takes_no_map(self) -> None:
        text = (
            "ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n1\nITEM: BOX BOUNDS pp pp pp\n"
            "0.0 4.0\n0.0 4.0\n0.0 4.0\nITEM: ATOMS id element x y z\n1 Fe 0.0 0.0 0.0\n"
        )
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "element.dump"
            path.write_text(text, encoding="utf-8")
            self.assertEqual(load_structure(path).atoms[0].element, "Fe")
            with self.assertRaisesRegex(ValueError, "has no type column"):
                load_structure(path, {1: "Fe"})

    def test_gzipped_data_and_dump_read_like_their_plain_files(self) -> None:
        cases = [
            (FIXTURES / "lammps-masses" / "mgo-masses.data", "mgo.data.gz", {1: "Fe1", 2: "O"}),
            (FIXTURES / "two-types" / "two-types.dump", "two-types.dump.gz", {1: "Mg", 2: "O"}),
        ]
        with tempfile.TemporaryDirectory() as td:
            for plain, name, types in cases:
                gz = Path(td) / name
                gz.write_bytes(gzip.compress(plain.read_bytes()))
                self.assertEqual(_read(gz, types), _read(plain, types))

    def test_data_positions_are_measured_from_the_header_origin(self) -> None:
        text = (
            "LAMMPS data, title line\n2 atoms\n2 atom types\n\n1.0 5.0 xlo xhi\n-2.0 2.0 ylo yhi\n0.5 4.5 zlo zhi\n\n"
            "Masses\n\n1 24.305\n2 15.999\n\n"
            "Atoms # atomic\n\n1 1 2.0 -1.0 1.0\n2 2 4.0 1.0 3.0\n"
        )
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "origin.data"
            path.write_text(text, encoding="utf-8")
            for types in (None, {1: "Fe", 2: "O"}):
                with self.subTest(types=types):
                    self.assertEqual(
                        _fractions(load_structure(path, types)), [(0.25, 0.25, 0.125), (0.75, 0.75, 0.625)]
                    )

    def test_dump_without_a_map_is_measured_from_its_origin(self) -> None:
        # The absolute x, y, z columns are moved by the box origin (1, -2, 0.5), with or without a map.
        dump = FIXTURES / "lammps-origin" / "origin.dump"
        for types in (None, {1: "Fe", 2: "O"}):
            with self.subTest(types=types):
                self.assertEqual(_fractions(load_structure(dump, types)), [(0.25, 0.25, 0.125), (0.75, 0.75, 0.625)])

    def test_dump_with_scaled_columns_is_already_measured_from_its_origin(self) -> None:
        dump = FIXTURES / "lammps-origin" / "origin-scaled.dump"
        for types in (None, {1: "Fe", 2: "O"}):
            with self.subTest(types=types):
                self.assertEqual(_fractions(load_structure(dump, types)), [(0.5, 0.5, 0.5), (0.0, 0.0, 0.0)])


if __name__ == "__main__":
    unittest.main()
