from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from gemmy.config import save_scene
from gemmy.scene import (
    AtomPrimitive,
    BondPrimitive,
    DisplacementPrimitive,
    MaterialStyle,
    PointRecord,
    PolyhedronPrimitive,
    SceneDocument,
    ScenePrimitives,
    TopologyRecord,
    load_scene,
)


class TestSerialization(unittest.TestCase):
    def _scene(self) -> SceneDocument:
        return SceneDocument(
            source_comment="x",
            materials={
                "mat_atom": MaterialStyle(),
                "mat_bond": MaterialStyle(),
                "mat_poly": MaterialStyle(alpha=0.25),
            },
            points=[
                PointRecord(id="p0", element="Si", label="Si", position=(0.0, 0.0, 0.0)),
                PointRecord(id="p1", element="O", label="O", position=(1.0, 0.0, 0.0)),
                PointRecord(id="p2", element="O", label="O", position=(0.0, 1.0, 0.0)),
                PointRecord(id="p3", element="O", label="O", position=(0.0, 0.0, 1.0)),
            ],
            topologies=[
                TopologyRecord(
                    id="topo0",
                    point_ids=["p1", "p2", "p3"],
                    faces=[(0, 1, 2)],
                )
            ],
            primitives=ScenePrimitives(
                atoms=[
                    AtomPrimitive(
                        id="atom0",
                        element="Si",
                        label="Si",
                        point_id="p0",
                        radius=0.35,
                        material_id="mat_atom",
                    )
                ],
                bonds=[
                    BondPrimitive(
                        id="bond0",
                        a_point_id="p0",
                        b_point_id="p1",
                        radius=0.08,
                        material_id="mat_bond",
                        a_element="Si",
                        b_element="O",
                        a_label="Si",
                        b_label="O",
                    )
                ],
                polyhedra=[
                    PolyhedronPrimitive(
                        id="poly0",
                        name="SiO3",
                        center_point_id="p0",
                        ligand_point_ids=["p1", "p2", "p3"],
                        topology_id="topo0",
                        topology_mode="topology_locked",
                        material_id="mat_poly",
                        per_frame_topology={"0": "topo0"},
                    )
                ],
                displacements=[
                    DisplacementPrimitive(
                        id="disp0",
                        start_point_id="p0",
                        vector=(0.1, 0.0, 0.0),
                        mode="arrow",
                        radius=0.02,
                        material_id="mat_bond",
                    )
                ],
            ),
        )

    def test_save_and_load_scene(self) -> None:
        scene = self._scene()
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "scene.json"
            save_scene(scene, path)
            loaded = load_scene(path)
        self.assertEqual(loaded.source_comment, "x")
        self.assertEqual(len(loaded.points), 4)
        self.assertEqual(len(loaded.primitives.atoms), 1)
        self.assertEqual(len(loaded.primitives.bonds), 1)
        self.assertEqual(len(loaded.primitives.polyhedra), 1)


if __name__ == "__main__":
    unittest.main()
