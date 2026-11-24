from __future__ import annotations

import unittest

from gemmy.config import scene_config_from_dict


class TestConfig(unittest.TestCase):
    def test_config_parsing_defaults(self) -> None:
        cfg = scene_config_from_dict(
            {
                "elements": {
                    "default": {
                        "representation": "sphere",
                        "radius": 0.31,
                        "color": [1, 0, 0],
                    }
                },
                "bonds": [{"a": "Si", "b": "O", "min": 1.5, "max": 2.0}],
                "polyhedra": [
                    {
                        "center": "Si",
                        "ligands": ["O"],
                        "min": 1.5,
                        "max": 2.3,
                    }
                ],
            }
        )
        self.assertIn("matte", cfg.materials)
        self.assertEqual(cfg.cell.supercell, (1, 1, 1))
        self.assertEqual(cfg.cell.periodic, (False, False, False))
        self.assertEqual(cfg.elements["default"].color[3], 1.0)
        self.assertEqual(cfg.bonds[0].a, "Si")
        self.assertEqual(cfg.polyhedra[0].center, "Si")

    def test_invalid_topology_mode_raises(self) -> None:
        with self.assertRaises(ValueError):
            scene_config_from_dict(
                {
                    "elements": {"default": {"representation": "sphere"}},
                    "polyhedra": [
                        {
                            "center": "Si",
                            "ligands": ["O"],
                            "min": 1.5,
                            "max": 2.3,
                            "topology_mode": "invalid",
                        }
                    ],
                }
            )


if __name__ == "__main__":
    unittest.main()
