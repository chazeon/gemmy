from __future__ import annotations

import unittest

from gemmy.compile.pipeline import compile_scene
from gemmy.config import BondRule, CellConfig, ElementStyle, PolyhedronRule, SceneConfig, SelectConfig
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


def _c60_cell() -> Structure:
    """One C60 at the origin of a 14.17 A cube, He marker at its centre (fractional 0). The box is the whole
    cell, so the He sits on 8 corners and each cage reaches outside the box."""
    from ase.build import molecule

    c60 = molecule("C60")
    c60.positions -= c60.get_center_of_mass()
    atoms = [AtomRecord("He", (0.0, 0.0, 0.0))]
    atoms += [AtomRecord("C", tuple(float(x) / 14.17 for x in p)) for p in c60.positions]
    return Structure("c60", ((14.17, 0, 0), (0, 14.17, 0), (0, 0, 14.17)), atoms)


def _c60_config(
    complete: str, *, select: SelectConfig | None = None, extra_bonds: list[BondRule] | None = None
) -> SceneConfig:
    return SceneConfig(
        elements={"He": ElementStyle(visible=False)},
        cell=CellConfig(periodic=(True, True, True)),
        select=select or SelectConfig(),
        bonds=[BondRule(a="C", b="C", min_distance=1.3, max_distance=1.5, complete=complete), *(extra_bonds or [])],
        polyhedra=[
            PolyhedronRule(
                center="He",
                ligands={"C"},
                min_distance=3.4,
                max_distance=3.6,
                min_coordination=60,
                max_coordination=60,
                image_centers=True,
            )
        ],
    )


class TestClosingBonds(unittest.TestCase):
    """A bond between two shown atoms is drawn in every `complete` mode, even when both lie outside the box."""

    def test_every_carbon_of_every_cage_has_its_three_bonds(self) -> None:
        for complete in ("none", "ends", "polyhedra"):
            with self.subTest(complete=complete):
                scene = compile_scene(_c60_cell(), _c60_config(complete))
                self.assertEqual(len(scene.primitives.polyhedra), 8)  # one cage per He corner
                degree: dict[str, int] = {}
                for bond in scene.primitives.bonds:
                    degree[bond.a_point_id] = degree.get(bond.a_point_id, 0) + 1
                    degree[bond.b_point_id] = degree.get(bond.b_point_id, 0) + 1
                carbons = [p.id for p in scene.points if p.element == "C"]
                self.assertEqual(len(carbons), 480)
                self.assertEqual([c for c in carbons if degree.get(c, 0) != 3], [])
                self.assertEqual(len(scene.primitives.bonds), 8 * 90)  # C60 has 90 C-C bonds

    def test_none_adds_no_atoms_for_its_bonds(self) -> None:
        def points(complete: str) -> set[tuple[str, tuple[float, ...]]]:
            return {(p.element, p.position) for p in compile_scene(_c60_cell(), _c60_config(complete)).points}

        self.assertEqual(points("none"), points("ends"))
        self.assertEqual(points("none"), points("polyhedra"))

    def test_selected_centres_pull_in_ligands_whose_bonds_close(self) -> None:
        # Only the He centres are selected. The C ligands come in through the polyhedra alone, and their bonds
        # must still be drawn because both ends are shown.
        scene = compile_scene(_c60_cell(), _c60_config("ends", select=SelectConfig(labels=["He"])))
        self.assertEqual(len(scene.primitives.polyhedra), 8)
        self.assertEqual(sum(1 for p in scene.points if p.element == "C"), 480)
        self.assertEqual(len(scene.primitives.bonds), 8 * 90)
        degree: dict[str, int] = {}
        for bond in scene.primitives.bonds:
            degree[bond.a_point_id] = degree.get(bond.a_point_id, 0) + 1
            degree[bond.b_point_id] = degree.get(bond.b_point_id, 0) + 1
        self.assertEqual([p.id for p in scene.points if p.element == "C" and degree.get(p.id, 0) != 3], [])

    def test_hidden_atom_with_a_bond_rule_keeps_its_bonds(self) -> None:
        # He is hidden (no sphere) but has a He-C rule in the C60 window, so each He gets its 60 radial bonds.
        he_c = BondRule(a="He", b="C", min_distance=3.4, max_distance=3.6, complete="ends")
        scene = compile_scene(_c60_cell(), _c60_config("ends", extra_bonds=[he_c]))
        he_points = {p.id for p in scene.points if p.element == "He"}
        self.assertFalse([a for a in scene.primitives.atoms if a.element == "He"])  # no sphere
        he_bonds = [b for b in scene.primitives.bonds if b.a_point_id in he_points or b.b_point_id in he_points]
        self.assertEqual(len(he_bonds), 8 * 60)
        self.assertTrue(all(b.b_element == "C" or b.a_element == "C" for b in he_bonds))

    def test_hidden_centre_gets_no_bonds(self) -> None:
        scene = compile_scene(_c60_cell(), _c60_config("polyhedra"))
        he_points = {p.id for p in scene.points if p.element == "He"}
        self.assertEqual(len(he_points), 8)
        self.assertFalse([b for b in scene.primitives.bonds if b.a_point_id in he_points or b.b_point_id in he_points])


if __name__ == "__main__":
    unittest.main()
