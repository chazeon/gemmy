from __future__ import annotations

import unittest

from gemmy.config import scene_config_from_dict


class TestCompileConfigKeys(unittest.TestCase):
    def test_defaults(self) -> None:
        cfg = scene_config_from_dict({})
        self.assertEqual(cfg.cell.eps, 1e-4)
        self.assertEqual(cfg.cell.box, {})
        self.assertFalse(cfg.select.is_active())
        self.assertIsNone(cfg.labels.file)

    def test_bond_complete_default_is_ends(self) -> None:
        cfg = scene_config_from_dict(
            {
                "bonds": [
                    {"a": "Al", "b": "O", "min": 1, "max": 2},
                    {"a": "O", "b": "H", "min": 0.8, "max": 1.2, "complete": "polyhedra"},
                    {"a": "O", "b": "H", "min": 0.8, "max": 1.2, "complete": "none"},
                ]
            }
        )
        self.assertEqual([b.complete for b in cfg.bonds], ["ends", "polyhedra", "none"])

    def test_bad_values_raise(self) -> None:
        with self.assertRaises(ValueError):
            scene_config_from_dict({"bonds": [{"a": "A", "b": "B", "min": 1, "max": 2, "complete": "all"}]})
        with self.assertRaises(ValueError):
            scene_config_from_dict({"cells": {"box": {"w": [0, 1]}}})
        with self.assertRaises(ValueError):
            scene_config_from_dict({"cells": {"box": {"x": [1, 0]}}})
        with self.assertRaises(ValueError):
            scene_config_from_dict({"select": {"shell": 3}})


if __name__ == "__main__":
    unittest.main()
