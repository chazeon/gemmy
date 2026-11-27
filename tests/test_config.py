from __future__ import annotations

import re
import unittest

import pytest

from gemmy.config import MAX_RING_SIZE, scene_config_from_dict


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

    def test_cell_values_must_be_finite_and_eps_a_fraction(self) -> None:
        """inf and nan are refused where the image loop reads them (the TypeScript schema says the same)."""
        bad = [
            ({"cells": {"eps": float("inf")}}, "cells.eps"),
            ({"cells": {"eps": 0.5}}, "cells.eps"),
            ({"cells": {"box": {"x": [0.0, float("inf")]}}}, "cells.box.x.1"),
            ({"cells": {"limits": {"z": [float("-inf"), 1.0]}}}, "cells.limits.z.0"),
        ]
        for raw, key in bad:
            with self.assertRaises(ValueError) as context:
                scene_config_from_dict(raw)
            self.assertIn(key, str(context.exception))
        self.assertEqual(scene_config_from_dict({"cells": {"eps": 0.49}}).cell.eps, 0.49)

    def test_cluster_bad_shapes_are_field_errors_not_crashes(self) -> None:
        """A kind or an atom that is not a string is a field error with its path, not a TypeError."""
        for raw, key in [
            ({"clusters": [{"kind": [], "atoms": ["C"], "min": 1, "max": 2}]}, "clusters.0.kind"),
            ({"clusters": [{"kind": "ring", "atoms": [{}], "min": 1, "max": 2}]}, "clusters.0.atoms.0"),
        ]:
            with self.assertRaises(ValueError) as context:
                scene_config_from_dict(raw)
            self.assertIn(key, str(context.exception))

    def test_radii_must_not_be_negative(self) -> None:
        """An element's or a bond's radius is refused below zero, as the TypeScript schema does; zero is allowed."""
        bad = [
            ({"elements": {"O": {"radius": -0.1}}}, "elements.O.radius"),
            ({"bonds": [{"a": "A", "b": "B", "min": 1, "max": 2, "radius": -0.01}]}, "bonds.0.radius"),
        ]
        for raw, key in bad:
            with self.assertRaises(ValueError) as context:
                scene_config_from_dict(raw)
            self.assertIn(key, str(context.exception))
        cfg = scene_config_from_dict(
            {
                "elements": {"O": {"radius": 0}},
                "bonds": [{"a": "A", "b": "B", "min": 1, "max": 2, "radius": 0}],
            }
        )
        self.assertEqual((cfg.elements["O"].radius, cfg.bonds[0].radius), (0, 0))

    def test_cluster_sizes_by_kind(self) -> None:
        """A molecule has no upper limit by default, a ring is 5 to 7, and a ring may reach MAX_RING_SIZE but not
        past it; a ring with no upper limit (null) is refused."""
        cfg = scene_config_from_dict(
            {
                "clusters": [
                    {"kind": "molecule", "atoms": ["C"], "min": 1, "max": 2},
                    {"kind": "ring", "atoms": ["C"], "min": 1, "max": 2},
                    {"kind": "ring", "atoms": ["C"], "min": 1, "max": 2, "max_size": MAX_RING_SIZE},
                ]
            }
        )
        self.assertEqual([(c.min_size, c.max_size) for c in cfg.clusters], [(4, None), (5, 7), (5, MAX_RING_SIZE)])
        for raw in [
            {"kind": "ring", "atoms": ["C"], "min": 1, "max": 2, "max_size": None},
            {"kind": "ring", "atoms": ["C"], "min": 1, "max": 2, "max_size": MAX_RING_SIZE + 1},
        ]:
            with self.assertRaises(ValueError):
                scene_config_from_dict({"clusters": [raw]})


class TestLammpsTypes(unittest.TestCase):
    def test_type_keys_are_numbers_from_one_and_labels_name_elements(self) -> None:
        cfg = scene_config_from_dict({"types": {"1": "Mg", 2: "Fe_pv", "10": "Xc"}})
        self.assertEqual(cfg.types, {1: "Mg", 2: "Fe_pv", 10: "Xc"})

    def test_the_largest_type_number_is_accepted_and_a_key_past_it_is_refused(self) -> None:
        self.assertEqual(scene_config_from_dict({"types": {"2147483647": "Mg"}}).types, {2147483647: "Mg"})
        with self.assertRaisesRegex(ValueError, r"types\.2147483648: a LAMMPS type is at most 2147483647"):
            scene_config_from_dict({"types": {"2147483648": "Mg"}})

    def test_types_default_to_none(self) -> None:
        self.assertEqual(scene_config_from_dict({}).types, {})

    def test_a_type_key_is_refused_at_its_key_unless_it_is_a_plain_number_from_one(self) -> None:
        for key in ["0", "x", "01", "+1", " 1 ", "1.0", "1_0", "-1"]:
            with self.subTest(key=key):
                with self.assertRaisesRegex(ValueError, rf"types\.{re.escape(key)}: a LAMMPS type is a plain number"):
                    scene_config_from_dict({"types": {key: "Mg"}})

    def test_a_label_that_names_no_element_is_refused_at_its_key(self) -> None:
        with self.assertRaisesRegex(ValueError, r"types\.1[\s\S]*Cannot tell which element the label 'Qq' names"):
            scene_config_from_dict({"types": {"1": "Qq"}})

    def test_a_label_that_is_a_bare_number_is_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, r"types\.1"):
            scene_config_from_dict({"types": {"1": "1"}})


if __name__ == "__main__":
    unittest.main()


def test_flat_is_a_strict_bool():
    # The TypeScript schema (z.boolean()) refuses 1, so Python refuses it too (pydantic's StrictBool).
    from pydantic import ValidationError

    from gemmy.config import ClusterRule

    ring = {"kind": "ring", "atoms": ["C"], "min": 1.3, "max": 1.5}
    assert ClusterRule.model_validate({**ring, "flat": True}).flat is True
    for bad in (1, 0, "true", "yes"):
        with pytest.raises(ValidationError, match="flat"):
            ClusterRule.model_validate({**ring, "flat": bad})
