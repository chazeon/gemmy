from __future__ import annotations

import colorsys
import json
import unittest

from pydantic import ValidationError

from gemmy.compile.pipeline import compile_scene
from gemmy.config import load_scene_config, scene_config_from_dict
from gemmy.readers import load_structure
from golden import FIXTURES

DIR = FIXTURES / "rocksalt"


def _compile(highlight: dict | None, displacements: dict | None = None):
    raw = json.loads((DIR / "config.json").read_text())
    if highlight is not None:
        raw["highlight"] = highlight
    raw["displacements"] = displacements or {"enabled": False}
    return compile_scene(load_structure(DIR / "POSCAR"), scene_config_from_dict(raw), base_dir=DIR)


class TestHighlightConfig(unittest.TestCase):
    def test_defaults(self) -> None:
        cfg = scene_config_from_dict({})
        self.assertIsNone(cfg.highlight.shell_of)
        self.assertEqual(cfg.highlight.ghost_opacity, 0.35)
        self.assertEqual(cfg.highlight.refs(), [])

    def test_unknown_key_and_bad_opacity_raise(self) -> None:
        with self.assertRaisesRegex(ValidationError, "ghost_opacty"):
            scene_config_from_dict({"highlight": {"ghost_opacty": 0.1}})
        with self.assertRaises(ValidationError):
            scene_config_from_dict({"highlight": {"ghost_opacity": 1.5}})

    def test_shipped_default_has_no_highlight(self) -> None:
        self.assertIsNone(load_scene_config(DIR / "config.json").highlight.shell_of)


class TestHighlightCompile(unittest.TestCase):
    def test_no_highlight_leaves_every_polyhedron_alone(self) -> None:
        scene = _compile(None)
        self.assertEqual(len(scene.primitives.polyhedra), 4)
        self.assertEqual(len({p.material_id for p in scene.primitives.polyhedra}), 1)

    def test_one_solid_and_the_rest_ghosts(self) -> None:
        scene = _compile({"shell_of": 0, "ghost_opacity": 0.1, "ghost_saturation": 0.3, "ghost_value": 0.95})
        polys = scene.primitives.polyhedra
        self.assertEqual(len(polys), 4)
        solid = [p for p in polys if scene.materials[p.material_id].alpha == 0.2]
        ghosts = [p for p in polys if scene.materials[p.material_id].alpha == 0.1]
        self.assertEqual((len(solid), len(ghosts)), (1, 3))
        self.assertEqual(len({p.material_id for p in ghosts}), 1)
        points = {pt.id: pt for pt in scene.points}
        self.assertEqual(points[solid[0].center_point_id].position, (0.0, 0.0, 0.0))
        r, g, b, _ = scene.materials[ghosts[0].material_id].base_color
        h, s, v = colorsys.rgb_to_hsv(r, g, b)  # rule colour [0.2, 0.6, 1.0]: hue kept, saturation x0.3
        h0, s0, _ = colorsys.rgb_to_hsv(0.2, 0.6, 1.0)
        self.assertAlmostEqual(h, h0)
        self.assertAlmostEqual(s, s0 * 0.3)
        self.assertAlmostEqual(v, 0.95)

    def test_several_marked_polyhedra(self) -> None:
        scene = _compile({"shell_of": [0, "0+1_0_0"], "ghost_opacity": 0.1})
        alphas = sorted(scene.materials[p.material_id].alpha for p in scene.primitives.polyhedra)
        self.assertEqual(alphas, [0.1] * 3 + [0.2] * 2)

    def test_atoms_are_untouched(self) -> None:
        plain, marked = _compile(None), _compile({"shell_of": 0})
        self.assertEqual(
            [(a.id, a.material_id) for a in plain.primitives.atoms],
            [(a.id, a.material_id) for a in marked.primitives.atoms],
        )

    def test_displacements_default_to_the_highlighted_shell(self) -> None:
        disp = {"enabled": True, "style": "arrow", "scale": 5.0, "data_file": "disp.json", "include_hidden": True}
        scene = _compile({"shell_of": 0}, disp)
        everything = _compile(None, disp)
        self.assertLess(len(scene.primitives.displacements), len(everything.primitives.displacements))
        explicit = _compile({"shell_of": 0}, {**disp, "shell_of": 0})
        self.assertEqual(scene.primitives.displacements, explicit.primitives.displacements)

    def test_highlighted_image_outside_the_cell_is_still_drawn_solid(self) -> None:
        scene = _compile({"shell_of": "0+1_0_0", "ghost_opacity": 0.1})
        alphas = sorted(scene.materials[p.material_id].alpha for p in scene.primitives.polyhedra)
        self.assertEqual(alphas, [0.1] * 4 + [0.2])  # the four in the cell are ghosts, the image is solid


if __name__ == "__main__":
    unittest.main()
