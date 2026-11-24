from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from gemmy.config import BondRule, CellConfig, DisplacementConfig, ElementStyle, PolyhedronRule, SceneConfig
from gemmy.structure import AtomRecord, Structure

SCENE_DEPS_AVAILABLE = importlib.util.find_spec("ase") is not None and importlib.util.find_spec("scipy") is not None
if SCENE_DEPS_AVAILABLE:
    from gemmy.compile.pipeline import compile_scene


def _point_map(scene):
    return {point.id: point.position for point in scene.points}


def _topology_map(scene):
    return {topology.id: topology for topology in scene.topologies}


@unittest.skipUnless(SCENE_DEPS_AVAILABLE, "ASE and SciPy are required for scene tests.")
class TestSceneCompilation(unittest.TestCase):
    def _assert_reference_integrity(self, scene) -> None:
        point_ids = {point.id for point in scene.points}
        topology_ids = {topology.id for topology in scene.topologies}
        material_ids = set(scene.materials.keys())
        self.assertEqual(len(point_ids), len(scene.points))
        self.assertEqual(len(topology_ids), len(scene.topologies))
        for atom in scene.primitives.atoms:
            self.assertIn(atom.point_id, point_ids)
            self.assertIn(atom.material_id, material_ids)
        for bond in scene.primitives.bonds:
            self.assertIn(bond.a_point_id, point_ids)
            self.assertIn(bond.b_point_id, point_ids)
            self.assertIn(bond.material_id, material_ids)
        for poly in scene.primitives.polyhedra:
            self.assertIn(poly.center_point_id, point_ids)
            self.assertIn(poly.topology_id, topology_ids)
            self.assertIn(poly.material_id, material_ids)
        for disp in scene.primitives.displacements:
            self.assertIn(disp.start_point_id, point_ids)
            self.assertIn(disp.material_id, material_ids)

    def test_bonds_and_polyhedron_from_octahedron(self) -> None:
        structure = Structure(
            comment="AlO6 test",
            lattice=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
            atoms=[
                AtomRecord("Al", (0.0, 0.0, 0.0)),
                AtomRecord("O", (1.0, 0.0, 0.0)),
                AtomRecord("O", (-1.0, 0.0, 0.0)),
                AtomRecord("O", (0.0, 1.0, 0.0)),
                AtomRecord("O", (0.0, -1.0, 0.0)),
                AtomRecord("O", (0.0, 0.0, 1.0)),
                AtomRecord("O", (0.0, 0.0, -1.0)),
            ],
        )
        config = SceneConfig(
            elements={
                "default": ElementStyle(),
                "Al": ElementStyle(radius=0.35),
                "O": ElementStyle(radius=0.3),
            },
            cell=CellConfig(supercell=(1, 1, 1)),
            bonds=[BondRule(a="Al", b="O", min_distance=0.99, max_distance=1.01)],
            polyhedra=[
                PolyhedronRule(
                    name="AlO6",
                    center="Al",
                    ligands={"O"},
                    min_distance=0.99,
                    max_distance=1.01,
                    min_coordination=6,
                    max_coordination=6,
                )
            ],
        )
        scene = compile_scene(structure, config)
        self.assertEqual(scene.schema_version, 2)
        self._assert_reference_integrity(scene)
        self.assertEqual(len(scene.primitives.atoms), 7)
        self.assertEqual(len(scene.primitives.bonds), 6)
        self.assertEqual(len(scene.primitives.polyhedra), 1)
        self.assertEqual(scene.primitives.polyhedra[0].name, "AlO6")

        topo_by_id = _topology_map(scene)
        poly = scene.primitives.polyhedra[0]
        topo = topo_by_id[poly.topology_id]
        self.assertEqual(len({tuple(sorted(f)) for f in topo.faces}), 8)

    def test_limits_clip_atoms(self) -> None:
        structure = Structure(
            comment="limits",
            lattice=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
            atoms=[AtomRecord("Si", (0.0, 0.0, 0.0)), AtomRecord("Si", (2.0, 0.0, 0.0))],
        )
        config = SceneConfig(
            elements={"default": ElementStyle()},
            cell=CellConfig(supercell=(1, 1, 1), cartesian_limits={"x": (-0.1, 1.0)}),
        )
        scene = compile_scene(structure, config)
        self._assert_reference_integrity(scene)
        self.assertEqual(len(scene.primitives.atoms), 1)

    def test_minimum_image_periodic_bond(self) -> None:
        structure = Structure(
            comment="periodic bond",
            lattice=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
            atoms=[AtomRecord("Si", (0.05, 0.0, 0.0)), AtomRecord("O", (0.95, 0.0, 0.0))],
        )
        config_non_periodic = SceneConfig(
            elements={"default": ElementStyle()},
            cell=CellConfig(supercell=(1, 1, 1), periodic=(False, False, False)),
            bonds=[BondRule(a="Si", b="O", min_distance=0.0, max_distance=0.2)],
        )
        non_periodic = compile_scene(structure, config_non_periodic)
        self._assert_reference_integrity(non_periodic)
        self.assertEqual(len(non_periodic.primitives.bonds), 0)

        config_periodic = SceneConfig(
            elements={"default": ElementStyle()},
            cell=CellConfig(supercell=(1, 1, 1), periodic=(True, False, False)),
            bonds=[BondRule(a="Si", b="O", min_distance=0.0, max_distance=0.2)],
        )
        periodic = compile_scene(structure, config_periodic)
        self._assert_reference_integrity(periodic)
        # Both atoms start a bond across x=0/1, each showing its far end outside the box.
        self.assertEqual(len(periodic.primitives.bonds), 2)

    def test_periodic_bond_forces_endpoint_atom_visibility(self) -> None:
        structure = Structure(
            comment="periodic bond endpoints",
            lattice=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
            atoms=[AtomRecord("Si", (0.05, 0.0, 0.0)), AtomRecord("O", (0.95, 0.0, 0.0))],
        )
        config = SceneConfig(
            elements={"default": ElementStyle(), "Si": ElementStyle(), "O": ElementStyle()},
            cell=CellConfig(supercell=(1, 1, 1), periodic=(True, False, False)),
            bonds=[BondRule(a="Si", b="O", min_distance=0.0, max_distance=0.2)],
        )
        scene = compile_scene(structure, config)
        self._assert_reference_integrity(scene)
        # Si(0.05)-O(-0.05) and O(0.95)-Si(1.05): one hop beyond the box each, nothing further.
        self.assertEqual(len(scene.primitives.bonds), 2)
        self.assertEqual(len(scene.primitives.atoms), 4)

        point_by_id = _point_map(scene)
        xs = sorted(point_by_id[a.point_id][0] for a in scene.primitives.atoms)
        self.assertLess(xs[0], 0.0)
        self.assertGreater(xs[-1], 1.0)

        atom_elements = [atom.element for atom in scene.primitives.atoms]
        self.assertEqual(atom_elements.count("Si"), 2)
        self.assertEqual(atom_elements.count("O"), 2)

    def test_polyhedron_forces_corner_atom_visibility_when_clipped(self) -> None:
        structure = Structure(
            comment="clipped corners",
            lattice=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
            atoms=[
                AtomRecord("Al", (0.0, 0.0, 0.0)),
                AtomRecord("O", (1.0, 0.0, 0.0)),
                AtomRecord("O", (-1.0, 0.0, 0.0)),
                AtomRecord("O", (0.0, 1.0, 0.0)),
                AtomRecord("O", (0.0, -1.0, 0.0)),
                AtomRecord("O", (0.0, 0.0, 1.0)),
                AtomRecord("O", (0.0, 0.0, -1.0)),
            ],
        )
        config = SceneConfig(
            elements={"default": ElementStyle(), "Al": ElementStyle(), "O": ElementStyle()},
            cell=CellConfig(
                supercell=(1, 1, 1),
                periodic=(False, False, False),
                cartesian_limits={"x": (-0.1, 0.1), "y": (-0.1, 0.1), "z": (-0.1, 0.1)},
            ),
            polyhedra=[
                PolyhedronRule(
                    name="AlO6",
                    center="Al",
                    ligands={"O"},
                    min_distance=0.99,
                    max_distance=1.01,
                    min_coordination=6,
                    max_coordination=6,
                )
            ],
        )
        scene = compile_scene(structure, config)
        self._assert_reference_integrity(scene)
        self.assertEqual(len(scene.primitives.polyhedra), 1)
        self.assertEqual(len(scene.primitives.atoms), 7)
        self.assertEqual(sum(1 for atom in scene.primitives.atoms if atom.element == "O"), 6)

    def test_polyhedron_uses_periodic_image_multiplicity_in_1x1x1(self) -> None:
        structure = Structure(
            comment="periodic multiplicity",
            lattice=((2.0, 0.0, 0.0), (0.0, 2.0, 0.0), (0.0, 0.0, 2.0)),
            atoms=[
                AtomRecord("Al", (0.0, 0.0, 0.0)),
                AtomRecord("O", (0.5, 0.0, 0.0)),
                AtomRecord("O", (0.0, 0.5, 0.0)),
                AtomRecord("O", (0.0, 0.0, 0.5)),
            ],
        )
        config = SceneConfig(
            elements={"default": ElementStyle(), "Al": ElementStyle(), "O": ElementStyle()},
            cell=CellConfig(supercell=(1, 1, 1), periodic=(True, True, True)),
            polyhedra=[
                PolyhedronRule(
                    name="AlO6",
                    center="Al",
                    ligands={"O"},
                    min_distance=0.99,
                    max_distance=1.01,
                    min_coordination=6,
                    max_coordination=6,
                )
            ],
        )
        scene = compile_scene(structure, config)
        self._assert_reference_integrity(scene)
        self.assertEqual(len(scene.primitives.polyhedra), 1)
        # Al on a corner: 8 copies; each O on a cell edge: 4 copies (12 total); plus the 3 ligands
        # of the base Al that lie outside the box.
        self.assertEqual(sum(1 for atom in scene.primitives.atoms if atom.element == "Al"), 8)
        self.assertEqual(sum(1 for atom in scene.primitives.atoms if atom.element == "O"), 15)

    def test_displacement_vectors_loaded(self) -> None:
        structure = Structure(
            comment="disp",
            lattice=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
            atoms=[AtomRecord("Si", (0.0, 0.0, 0.0))],
        )
        with tempfile.TemporaryDirectory() as td:
            disp_path = Path(td) / "disp.json"
            disp_path.write_text(
                json.dumps({"vectors": [{"index": 0, "dx": 0.1, "dy": 0.0, "dz": 0.0}]}),
                encoding="utf-8",
            )
            config = SceneConfig(
                elements={"default": ElementStyle()},
                cell=CellConfig(supercell=(1, 1, 1)),
                displacements=DisplacementConfig(
                    enabled=True,
                    style="arrow",
                    scale=2.0,
                    data_file=str(disp_path),
                ),
            )
            scene = compile_scene(structure, config)
        self._assert_reference_integrity(scene)
        self.assertEqual(len(scene.primitives.displacements), 1)
        vector = scene.primitives.displacements[0].vector
        self.assertAlmostEqual(vector[0], 0.2)


if __name__ == "__main__":
    unittest.main()
