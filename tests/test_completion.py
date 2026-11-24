from __future__ import annotations

import unittest

from gemmy.compile.pipeline import compile_scene
from gemmy.config import BondRule, CellConfig, ElementStyle, PolyhedronRule, SceneConfig
from gemmy.structure import AtomRecord, Structure


def _structure() -> Structure:
    atoms = [AtomRecord("Al", (0.0, 0.0, 0.0))]
    for axis in range(3):
        for sign in (1, -1):
            o = [0.0, 0.0, 0.0]
            o[axis] = sign * 0.1
            atoms.append(AtomRecord("O", (o[0], o[1], o[2])))
    for axis in range(3):
        for sign in (1, -1):
            n = [0.0, 0.0, 0.0]
            n[axis] = sign * 0.17
            atoms.append(AtomRecord("N", (n[0], n[1], n[2])))
    return Structure("c", ((20.0, 0, 0), (0, 20.0, 0), (0, 0, 20.0)), atoms)


def _config(complete: str, image_centers: bool = False) -> SceneConfig:
    return SceneConfig(
        elements={"default": ElementStyle()},
        cell=CellConfig(periodic=(True, True, True)),
        bonds=[BondRule(a="O", b="N", min_distance=1.2, max_distance=1.6, complete=complete)],
        polyhedra=[
            PolyhedronRule(
                center="Al",
                ligands={"O"},
                min_distance=1.8,
                max_distance=2.2,
                min_coordination=6,
                image_centers=image_centers,
            )
        ],
    )


def _count(scene, element: str) -> int:
    return sum(1 for p in scene.points if p.element == element)


class TestBondCompletion(unittest.TestCase):
    def test_polyhedra_completion_pulls_partners_of_outside_ligands(self) -> None:
        # 6 N on box edges (4 copies each = 24); 3 ligand O images outside the box pull in 3 more.
        self.assertEqual(_count(compile_scene(_structure(), _config("polyhedra")), "N"), 27)

    def test_ends_and_none_do_not(self) -> None:
        self.assertEqual(_count(compile_scene(_structure(), _config("ends")), "N"), 24)
        self.assertEqual(_count(compile_scene(_structure(), _config("none")), "N"), 24)

    def test_none_drops_bonds_leaving_the_box(self) -> None:
        # Al at the corner has 8 copies; with `none` only O-N bonds inside the box remain.
        ends = compile_scene(_structure(), _config("ends"))
        none = compile_scene(_structure(), _config("none"))
        self.assertLessEqual(len(none.primitives.bonds), len(ends.primitives.bonds))

    def test_image_centers_option(self) -> None:
        base = compile_scene(_structure(), _config("ends"))
        copies = compile_scene(_structure(), _config("ends", image_centers=True))
        self.assertEqual(len(base.primitives.polyhedra), 1)
        self.assertEqual(len(copies.primitives.polyhedra), 8)  # one per corner copy of Al


if __name__ == "__main__":
    unittest.main()
