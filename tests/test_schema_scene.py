"""Scene document validation (ported from the old reference_scene checks)."""

from __future__ import annotations

import copy
import unittest

from pydantic import ValidationError

from gemmy.config import validate_scene
from gemmy.scene import SCENE_SCHEMA_VERSION


def _valid_payload() -> dict:
    return {
        "schema_version": SCENE_SCHEMA_VERSION,
        "source_comment": "t",
        "points": [
            {"id": "p0", "element": "Si", "position": [0.0, 0.0, 0.0]},
            {"id": "p1", "element": "O", "position": [1.0, 0.0, 0.0]},
            {"id": "p2", "element": "O", "position": [0.0, 1.0, 0.0]},
            {"id": "p3", "element": "O", "position": [0.0, 0.0, 1.0]},
        ],
        "materials": {"mat_atom": {}, "mat_bond": {}, "mat_poly": {}},
        "topologies": [
            {"id": "t0", "point_ids": ["p1", "p2", "p3"], "faces": [[0, 1, 2]]},
            {"id": "t1", "point_ids": ["p0", "p1", "p2", "p3"], "faces": [[0, 1, 2], [1, 2, 3]]},
        ],
        "primitives": {
            "atoms": [{"id": "a0", "element": "Si", "point_id": "p0", "radius": 0.3, "material_id": "mat_atom"}],
            "bonds": [
                {
                    "id": "b0",
                    "a_point_id": "p0",
                    "b_point_id": "p1",
                    "radius": 0.1,
                    "material_id": "mat_bond",
                    "a_element": "Si",
                    "b_element": "O",
                }
            ],
            "polyhedra": [
                {
                    "id": "poly0",
                    "name": "SiO3",
                    "center_point_id": "p0",
                    "ligand_point_ids": ["p1", "p2", "p3"],
                    "topology_id": "t0",
                    "topology_mode": "topology_locked",
                    "material_id": "mat_poly",
                    "per_frame_topology": {"0": "t0", "1": "t0"},
                }
            ],
            "displacements": [
                {
                    "id": "d0",
                    "start_point_id": "p0",
                    "vector": [0.1, 0.0, 0.0],
                    "mode": "arrow",
                    "material_id": "mat_bond",
                }
            ],
        },
    }


class TestSceneDocument(unittest.TestCase):
    def assert_invalid(self, payload: dict) -> None:
        with self.assertRaises(ValueError):
            validate_scene(payload)

    def test_valid_payload_passes(self) -> None:
        validate_scene(_valid_payload())

    def test_schema_version_required_by_loader(self) -> None:
        payload = _valid_payload()
        del payload["schema_version"]
        with self.assertRaises(ValueError):
            validate_scene(payload)

    def test_wrong_schema_version(self) -> None:
        payload = _valid_payload()
        payload["schema_version"] = 99
        self.assert_invalid(payload)

    def test_atom_point_reference_must_exist(self) -> None:
        payload = _valid_payload()
        payload["primitives"]["atoms"][0]["point_id"] = "missing"
        self.assert_invalid(payload)

    def test_material_reference_must_exist(self) -> None:
        payload = _valid_payload()
        payload["primitives"]["bonds"][0]["material_id"] = "missing"
        self.assert_invalid(payload)

    def test_embedded_geometry_keys_rejected(self) -> None:
        payload = _valid_payload()
        payload["primitives"]["bonds"][0]["a_pos"] = [0.0, 0.0, 0.0]
        with self.assertRaises(ValidationError) as ctx:
            validate_scene(payload)
        self.assertIn("a_pos", str(ctx.exception))

    def test_duplicate_ids_rejected(self) -> None:
        payload = _valid_payload()
        payload["points"].append(copy.deepcopy(payload["points"][0]))
        self.assert_invalid(payload)

    def test_topology_locked_disallows_switch(self) -> None:
        payload = _valid_payload()
        payload["primitives"]["polyhedra"][0]["per_frame_topology"]["1"] = "t1"
        self.assert_invalid(payload)

    def test_topology_adaptive_allows_switch(self) -> None:
        payload = _valid_payload()
        poly = payload["primitives"]["polyhedra"][0]
        poly["topology_mode"] = "topology_adaptive"
        poly["per_frame_topology"] = {"0": "t0", "1": "t1"}
        validate_scene(payload)

    def test_topology_adaptive_requires_existing_topology(self) -> None:
        payload = _valid_payload()
        poly = payload["primitives"]["polyhedra"][0]
        poly["topology_mode"] = "topology_adaptive"
        poly["per_frame_topology"] = {"0": "missing"}
        self.assert_invalid(payload)

    def test_topology_mode_enum(self) -> None:
        payload = _valid_payload()
        payload["primitives"]["polyhedra"][0]["topology_mode"] = "other"
        self.assert_invalid(payload)

    def test_face_index_bounds(self) -> None:
        payload = _valid_payload()
        payload["topologies"][0]["faces"] = [[0, 1, 9]]
        self.assert_invalid(payload)

    def test_displacement_mode_enum(self) -> None:
        payload = _valid_payload()
        payload["primitives"]["displacements"][0]["mode"] = "unknown"
        self.assert_invalid(payload)

    def test_displacement_reference_must_exist(self) -> None:
        payload = _valid_payload()
        payload["primitives"]["displacements"][0]["start_point_id"] = "missing"
        self.assert_invalid(payload)

    def test_golden_scenes_load_the_same_on_both_sides(self) -> None:
        import json
        from pathlib import Path

        from gemmy.scene import load_scene

        for path in sorted((Path(__file__).parent / "fixtures").glob("*/scene.golden.json")):
            with self.subTest(path=path.parent.name):
                self.assertEqual(validate_scene(json.loads(path.read_text(encoding="utf-8"))), load_scene(path))


if __name__ == "__main__":
    unittest.main()
