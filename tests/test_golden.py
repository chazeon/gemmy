from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import warnings
from pathlib import Path

from golden import FIXTURES, dumps, updating

DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("ase", "scipy", "numpy"))


@unittest.skipUnless(DEPS_AVAILABLE, "ASE, SciPy and NumPy are required for golden tests.")
class TestGoldenScenes(unittest.TestCase):
    def _check(self, name: str, poscar: str = "POSCAR"):
        from gemmy.compile.pipeline import compile_scene_from_files
        from gemmy.config import scene_to_dict

        directory = FIXTURES / name
        scene = compile_scene_from_files(directory / "config.json", structure=directory / poscar)
        actual = dumps(scene_to_dict(scene))
        golden = directory / "scene.golden.json"
        if updating():
            golden.write_text(actual, encoding="utf-8")
        self.assertEqual(actual, golden.read_text(encoding="utf-8"))
        return scene

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

    def test_flat_polyhedra_and_collinear_warning(self) -> None:
        """Square-planar CuO4 and a flat C6 ring are drawn as polygons, from both sides. The Ne with two F is on a
        line: no polygon, and a warning naming it."""
        with self.assertWarnsRegex(UserWarning, "polyhedron NeF2 skipped for centre Ne"):
            scene = self._check("flat_poly")
        self.assertEqual(sorted(p.name for p in scene.primitives.polyhedra), ["C6ring", "CuO4"])
        faces = {topo.id: topo.faces for topo in scene.topologies}
        ring = next(p for p in scene.primitives.polyhedra if p.name == "C6ring")
        self.assertEqual(len(faces[ring.topology_id]), 8)  # 4 triangles of the hexagon, each drawn from both sides

    def test_compile_is_deterministic(self) -> None:
        from gemmy.compile.pipeline import compile_scene_from_files
        from gemmy.config import scene_to_dict

        directory = FIXTURES / "rocksalt"
        runs = [
            dumps(scene_to_dict(compile_scene_from_files(directory / "config.json", structure=directory / "POSCAR")))
            for _ in range(2)
        ]
        self.assertEqual(runs[0], runs[1])

    def test_benzene_ring_cluster(self) -> None:
        """An isolated benzene: one ring cluster of 6 carbons, drawn as a fan from its centroid (a computed point, no
        atom), with the C-C and C-H bonds."""
        from gemmy.compile.pipeline import compile_scene_from_files

        self._check("benzene")
        directory = FIXTURES / "benzene"
        scene = compile_scene_from_files(directory / "config.json", structure=directory / "POSCAR")
        self.assertEqual([p.name for p in scene.primitives.polyhedra], ["ring6"])
        ring = scene.primitives.polyhedra[0]
        self.assertEqual(len(ring.ligand_point_ids), 7)  # 6 carbons, then the centroid (the fan's index 6)
        centroid = next(p for p in scene.points if p.id == ring.center_point_id)
        self.assertIsNone(centroid.ref)
        self.assertEqual(centroid.element, "X")
        self.assertNotIn(centroid.id, [a.point_id for a in scene.primitives.atoms])

    def test_naphthalene_two_ring_clusters(self) -> None:
        """Naphthalene: its two hexagons, never the ten-membered ring."""
        from gemmy.compile.pipeline import compile_scene_from_files

        self._check("naphthalene")
        directory = FIXTURES / "naphthalene"
        scene = compile_scene_from_files(directory / "config.json", structure=directory / "POSCAR")
        self.assertEqual([p.name for p in scene.primitives.polyhedra], ["ring6", "ring6"])
        self.assertEqual([len(p.ligand_point_ids) for p in scene.primitives.polyhedra], [7, 7])

    def _benzene_with_centre_he(self) -> tuple[str, dict]:
        """The benzene POSCAR with one He at the ring's centre (fractional 0.5, 0.5, 0.5) and its config, as text."""
        lines = (FIXTURES / "benzene" / "POSCAR").read_text(encoding="utf-8").splitlines()
        lines[5] = "C H He"  # the species line
        lines[6] = "6 6 1"  # the counts
        lines.append("0.5 0.5 0.5")
        raw = json.loads((FIXTURES / "benzene" / "config.json").read_text(encoding="utf-8"))
        return "\n".join(lines) + "\n", raw

    def _compile_text(self, poscar: str, raw: dict):
        """Python compile of the text, with the UserWarning messages it raised."""
        from gemmy.compile.pipeline import compile_scene_from_files

        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "POSCAR").write_text(poscar, encoding="utf-8")
            Path(folder, "config.json").write_text(json.dumps(raw), encoding="utf-8")
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                scene = compile_scene_from_files(Path(folder, "config.json"), structure=Path(folder, "POSCAR"))
        return scene, [str(w.message) for w in caught if issubclass(w.category, UserWarning)]

    def test_cluster_on_polyhedron_ligands_is_skipped_on_both_sides(self) -> None:
        """Benzene's ring and a He-centred polyhedron over the same six C would draw two surfaces in one plane. The
        polyhedron wins: the ring is skipped with a warning, the same warning from the TypeScript compile."""
        from ts_bundle import available, run

        if not available():
            self.skipTest("node or web/node_modules is missing (cd web && npm ci)")
        poscar, raw = self._benzene_with_centre_he()
        raw["polyhedra"] = [{"center": "He", "ligands": ["C"], "min": 1.3, "max": 1.5}]
        scene, python_messages = self._compile_text(poscar, raw)
        self.assertEqual(len(python_messages), 1)
        self.assertIn("cluster ring6 skipped: its members are exactly the ligands of polyhedron", python_messages[0])
        self.assertEqual(
            [len(p.ligand_point_ids) for p in scene.primitives.polyhedra], [6]
        )  # no ring: 6 C, no centroid

        (result,) = run([{"fn": "compileFixture", "args": ["POSCAR", poscar, "config.json", json.dumps(raw), {}]}])
        self.assertIn("ok", result, result.get("error"))
        self.assertEqual(result["ok"]["warnings"], python_messages)
        self.assertEqual(len(result["ok"]["scene"]["primitives"]["polyhedra"]), 1)

    def test_highlighted_centre_keeps_a_ring_cluster_solid(self) -> None:
        """With highlight.shell_of, a cluster is solid when one of its members is a highlighted centre (a ring atom),
        and a ghost when none is (an H, which is in no ring). Both: the same scene but for the highlight."""
        from gemmy.compile.pipeline import compile_scene_from_files

        directory = FIXTURES / "benzene"
        raw = json.loads((directory / "config.json").read_text(encoding="utf-8"))

        def ring_colour(highlight: dict | None) -> list[float]:
            config = dict(raw, highlight=highlight) if highlight is not None else raw
            with tempfile.TemporaryDirectory() as folder:
                Path(folder, "config.json").write_text(json.dumps(config), encoding="utf-8")
                scene = compile_scene_from_files(Path(folder, "config.json"), structure=directory / "POSCAR")
            (ring,) = scene.primitives.polyhedra
            return scene.materials[ring.material_id].base_color

        plain = ring_colour(None)
        self.assertEqual(ring_colour({"shell_of": 0}), plain)  # atom 0 is a ring carbon: solid
        self.assertNotEqual(ring_colour({"shell_of": 6}), plain)  # atom 6 is an H: the ring is a ghost

        from ts_bundle import available, run

        if not available():
            return
        poscar = (directory / "POSCAR").read_text(encoding="utf-8")
        jobs = [
            {
                "fn": "compileFixture",
                "args": ["POSCAR", poscar, "config.json", json.dumps(dict(raw, highlight=highlight)), {}],
            }
            for highlight in ({"shell_of": 0}, {"shell_of": 6})
        ]
        solid, ghost = run(jobs)
        for result in (solid, ghost):
            self.assertIn("ok", result, result.get("error"))

        def ring_base(result):
            scene = result["ok"]["scene"]
            return scene["materials"][scene["primitives"]["polyhedra"][0]["material_id"]]["base_color"]

        for got, want in zip(ring_base(solid), plain, strict=True):
            self.assertAlmostEqual(got, want, places=9)  # TypeScript: solid, as Python
        self.assertNotAlmostEqual(ring_base(ghost)[3], plain[3])  # TypeScript: a ghost, as Python


if __name__ == "__main__":
    unittest.main()
