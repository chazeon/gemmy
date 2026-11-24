from __future__ import annotations

import importlib.util
import unittest

from golden import FIXTURES, dumps, updating

DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("ase", "scipy", "numpy"))


@unittest.skipUnless(DEPS_AVAILABLE, "ASE, SciPy and NumPy are required for golden tests.")
class TestGoldenScenes(unittest.TestCase):
    def _check(self, name: str, poscar: str = "POSCAR") -> None:
        from gemmy.compile.pipeline import compile_scene_from_files
        from gemmy.config import scene_to_dict

        directory = FIXTURES / name
        scene = compile_scene_from_files(directory / "config.json", structure=directory / poscar)
        actual = dumps(scene_to_dict(scene))
        golden = directory / "scene.golden.json"
        if updating():
            golden.write_text(actual, encoding="utf-8")
        self.assertEqual(actual, golden.read_text(encoding="utf-8"))

    def test_rocksalt_octahedra_and_displacements(self) -> None:
        self._check("rocksalt")

    def test_hydroxide_oh_completion(self) -> None:
        self._check("hydroxide")

    def test_box_duplicates_boundary_atoms(self) -> None:
        self._check("box")
        from gemmy.compile.pipeline import compile_scene_from_files

        directory = FIXTURES / "box"
        scene = compile_scene_from_files(directory / "config.json", structure=directory / "POSCAR")
        counts: dict[str, int] = {}
        for point in scene.points:
            counts[point.element] = counts.get(point.element, 0) + 1
        self.assertEqual(counts, {"C": 8, "N": 4, "O": 2, "H": 1})  # corner, edge, face, interior

    def test_corner_centre_polyhedra_and_hidden_centre(self) -> None:
        from gemmy.compile.pipeline import compile_scene_from_files

        self._check("corner_poly")
        directory = FIXTURES / "corner_poly"
        scene = compile_scene_from_files(directory / "config.json", structure=directory / "POSCAR")
        self.assertEqual(len(scene.primitives.polyhedra), 8)  # 8 corner copies of Al
        self.assertFalse([a for a in scene.primitives.atoms if a.element == "Al"])  # hidden, still defines them

    def test_labels_style_and_bonds_by_label(self) -> None:
        self._check("labels")

    def test_select_shell_isolates_one_octahedron(self) -> None:
        from gemmy.compile.pipeline import compile_scene_from_files

        self._check("select_shell")
        directory = FIXTURES / "select_shell"
        scene = compile_scene_from_files(directory / "config.json", structure=directory / "POSCAR")
        self.assertEqual(len(scene.primitives.polyhedra), 1)
        self.assertEqual(len(scene.primitives.atoms), 7)  # Mg + 6 O
        self.assertEqual(len(scene.primitives.bonds), 6)

    def test_wrap_eps_makes_equivalent_cells_identical(self) -> None:
        from gemmy.compile.pipeline import compile_scene_from_files
        from gemmy.config import scene_to_dict

        self._check("wrap")
        directory = FIXTURES / "wrap"
        alt = scene_to_dict(compile_scene_from_files(directory / "config.json", structure=directory / "POSCAR.alt"))
        alt["source_comment"] = "POSCAR"  # comes from the file name
        self.assertEqual(dumps(alt), (directory / "scene.golden.json").read_text(encoding="utf-8"))

    def test_compile_is_deterministic(self) -> None:
        from gemmy.compile.pipeline import compile_scene_from_files
        from gemmy.config import scene_to_dict

        directory = FIXTURES / "rocksalt"
        runs = [
            dumps(scene_to_dict(compile_scene_from_files(directory / "config.json", structure=directory / "POSCAR")))
            for _ in range(2)
        ]
        self.assertEqual(runs[0], runs[1])


if __name__ == "__main__":
    unittest.main()
