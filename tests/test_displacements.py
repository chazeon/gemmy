from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from gemmy.compile.displacements import DisplacementFileError, load_displacement_file
from gemmy.compile.pipeline import compile_scene
from gemmy.config import DisplacementConfig, ElementStyle, PolyhedronRule, SceneConfig
from gemmy.structure import AtomRecord, Structure


def _structure() -> Structure:
    return Structure(
        comment="d",
        lattice=((10.0, 0, 0), (0, 10.0, 0), (0, 0, 10.0)),
        atoms=[AtomRecord("O", (0.1, 0.1, 0.1)), AtomRecord("H", (0.5, 0.5, 0.5))],
    )


def _config(**kw) -> SceneConfig:
    return SceneConfig(
        displacements=DisplacementConfig(
            enabled=kw.pop("enabled", True),
            data_file=kw.pop("data_file", "d.json"),
            include_hidden=kw.pop("include_hidden", False),
        ),
        **kw,
    )


class TestDisplacementErrors(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def _write(self, payload: object) -> None:
        (self.dir / "d.json").write_text(json.dumps(payload), encoding="utf-8")

    def test_missing_file_names_path(self) -> None:
        with self.assertRaises(DisplacementFileError) as ctx:
            compile_scene(_structure(), _config(), base_dir=self.dir)
        self.assertIn(str(self.dir / "d.json"), str(ctx.exception))

    def test_invalid_json_and_shape_name_path(self) -> None:
        (self.dir / "d.json").write_text("{nope", encoding="utf-8")
        with self.assertRaisesRegex(DisplacementFileError, "d.json"):
            load_displacement_file(self.dir / "d.json")
        self._write({"vectors": "x"})
        with self.assertRaisesRegex(DisplacementFileError, "vectors"):
            load_displacement_file(self.dir / "d.json")
        self._write({"vectors": [{"index": 0, "dx": 1}]})
        with self.assertRaisesRegex(DisplacementFileError, r"vectors\[0\]"):
            load_displacement_file(self.dir / "d.json")

    def test_enabled_without_data_file_raises(self) -> None:
        with self.assertRaises(DisplacementFileError):
            compile_scene(_structure(), _config(data_file=None))

    def test_disabled_ignores_file_and_makes_no_material(self) -> None:
        scene = compile_scene(_structure(), _config(enabled=False), base_dir=self.dir)
        self.assertEqual(scene.primitives.displacements, [])
        self.assertFalse([m for m in scene.materials if m.startswith("bond")])

    def test_hidden_atoms_get_no_arrows(self) -> None:
        self._write({"vectors": [{"index": 0, "dx": 0.1, "dy": 0, "dz": 0}, {"index": 1, "dx": 0.1, "dy": 0, "dz": 0}]})
        cfg = _config(elements={"H": ElementStyle(visible=False)})
        scene = compile_scene(_structure(), cfg, base_dir=self.dir)
        self.assertEqual(len(scene.primitives.displacements), 1)
        start = scene.primitives.displacements[0].start_point_id
        self.assertEqual([p.element for p in scene.points if p.id == start], ["O"])

    def test_include_hidden_draws_arrows_on_hidden_atoms(self) -> None:
        self._write({"vectors": [{"index": 0, "dx": 0.1, "dy": 0, "dz": 0}, {"index": 1, "dx": 0.1, "dy": 0, "dz": 0}]})
        cfg = _config(elements={"H": ElementStyle(visible=False)}, include_hidden=True)
        scene = compile_scene(_structure(), cfg, base_dir=self.dir)
        self.assertEqual(len(scene.primitives.displacements), 2)
        starts = {d.start_point_id for d in scene.primitives.displacements}
        self.assertEqual(sorted(p.element for p in scene.points if p.id in starts), ["H", "O"])

    def test_config_not_mutated(self) -> None:
        self._write({"vectors": []})
        cfg = _config()
        compile_scene(_structure(), cfg, base_dir=self.dir)
        self.assertEqual(cfg.displacements.data_file, "d.json")


class TestShellArrows(unittest.TestCase):
    """Arrows on one polyhedron's corners; inward ones sit outside with the head on the corner."""

    def test_inward_arrows_are_anchored_at_the_tip(self) -> None:
        corners = [(2, 0, 0), (-2, 0, 0), (0, 2, 0), (0, -2, 0), (0, 0, 2), (0, 0, -2)]
        structure = Structure(
            comment="oct",
            lattice=((20.0, 0, 0), (0, 20.0, 0), (0, 0, 20.0)),
            atoms=[AtomRecord("Al", (0.5, 0.5, 0.5))]
            + [AtomRecord("O", (0.5 + x / 20, 0.5 + y / 20, 0.5 + z / 20)) for x, y, z in corners],
        )
        # +-x corners move out, +-y corners move in, z corners do not move.
        moves = {1: (0.1, 0, 0), 2: (-0.1, 0, 0), 3: (0, -0.1, 0), 4: (0, 0.1, 0)}
        with tempfile.TemporaryDirectory() as d:
            Path(d, "d.json").write_text(
                json.dumps({"vectors": [{"index": i, "dx": v[0], "dy": v[1], "dz": v[2]} for i, v in moves.items()]})
            )
            config = SceneConfig(
                elements={"O": ElementStyle(visible=False)},
                polyhedra=[PolyhedronRule(center="Al", ligands={"O"}, min_distance=1.5, max_distance=2.5)],
                displacements=DisplacementConfig(enabled=True, data_file="d.json", include_hidden=True, shell_of=0),
            )
            scene = compile_scene(structure, config, base_dir=Path(d))
        points = {p.id: p.position for p in scene.points}
        by_axis: dict[str, set[str]] = {"x": set(), "y": set()}
        for arrow in scene.primitives.displacements:
            x = points[arrow.start_point_id][0]
            by_axis["x" if abs(x - 10.0) > 1 else "y"].add(arrow.anchor)
        self.assertEqual(len(scene.primitives.displacements), 4)
        self.assertEqual(by_axis, {"x": {"tail"}, "y": {"tip"}})


if __name__ == "__main__":
    unittest.main()
