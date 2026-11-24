"""Config model strictness: unknown keys raise with a path; shipped configs still load."""

from __future__ import annotations

import unittest
from pathlib import Path

from pydantic import ValidationError

from gemmy.config import load_scene_config, scene_config_from_dict

ROOT = Path(__file__).resolve().parents[1]


class TestConfigSchema(unittest.TestCase):
    def test_shipped_configs_load(self) -> None:
        paths = [ROOT / "configs" / "default.json", *sorted((ROOT / "tests" / "fixtures").glob("*/config.json"))]
        for path in paths:
            with self.subTest(path=path.name):
                load_scene_config(path)

    def test_unknown_top_level_key_raises(self) -> None:
        with self.assertRaisesRegex(ValidationError, "bondz"):
            scene_config_from_dict({"bondz": []})

    def test_nested_typo_reports_path(self) -> None:
        with self.assertRaises(ValidationError) as ctx:
            scene_config_from_dict({"bonds": [{"a": "Si", "b": "O", "min": 1, "max": 2, "radiu": 0.1}]})
        self.assertEqual(ctx.exception.errors()[0]["loc"], ("bonds", 0, "radiu"))

    def test_aliases_and_defaults(self) -> None:
        cfg = scene_config_from_dict(
            {"cells": {"limits": {"x": [0, 1]}}, "bonds": [{"a": "A", "b": "B", "min": 1, "max": 2}]}
        )
        self.assertEqual(cfg.cell.cartesian_limits, {"x": (0.0, 1.0)})
        self.assertEqual(cfg.bonds[0].min_distance, 1.0)
        self.assertEqual(cfg.bonds[0].color, (0.7, 0.7, 0.7, 1.0))

    def test_frozen(self) -> None:
        cfg = scene_config_from_dict({})
        with self.assertRaises(ValidationError):
            cfg.cell = cfg.cell  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
