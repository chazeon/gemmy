from __future__ import annotations

import unittest

import numpy as np

from gemmy.compile.bonds import build_neighbor_graph, cell_array, complete_ligand, completion_rules, find_bonds
from gemmy.compile.displacements import make_displacements
from gemmy.compile.materials import MaterialTable, style_for
from gemmy.compile.pipeline import PointTable, SceneAssembler
from gemmy.compile.polyhedra import find_polyhedra
from gemmy.compile.sites import Site, build_sites, repeat_structure, select_sites
from gemmy.config import BondRule, ElementStyle, PolyhedronRule, SceneConfig
from gemmy.readers.record import AtomRecord, Structure
from gemmy.scene import MaterialStyle


def _site(index: int, element: str, pos: tuple[float, float, float], key: str | None = None) -> Site:
    return Site(index=index, element=element, label=key or element, fractional=pos, position=pos)


def _water() -> Structure:
    # O at origin, two H at ~0.96 A, in a 10 A box.
    return Structure(
        comment="w",
        lattice=((10.0, 0, 0), (0, 10.0, 0), (0, 0, 10.0)),
        atoms=[
            AtomRecord("O", (0.0, 0.0, 0.0)),
            AtomRecord("H", (0.096, 0.0, 0.0), style_key="H1"),
            AtomRecord("H", (0.0, 0.096, 0.0)),
        ],
    )


class TestStages(unittest.TestCase):
    def test_point_table_identity_is_index_and_shift(self) -> None:
        t = PointTable()
        base = _site(0, "O", (1.0, 2.0, 3.0))
        a = t.id_for(base)
        self.assertEqual(a, t.id_for(base))
        # same position, different identity: separate points
        self.assertNotEqual(a, t.id_for(_site(5, "O", (1.0, 2.0, 3.0))))
        cell = np.eye(3) * 10.0
        self.assertNotEqual(a, t.id_for(base.image((1, 0, 0), cell)))
        self.assertEqual(t.id_for(base.image((1, 0, 0), cell)), t.id_for(base.image((1, 0, 0), cell)))
        self.assertEqual(len(t.records), 3)

    def test_build_sites_supercell_and_style_keys(self) -> None:
        s = _water()
        atoms = repeat_structure(s, (2, 1, 1), (True, True, True))
        sites = build_sites(s, atoms)
        self.assertEqual(len(sites), 6)
        self.assertEqual(sites[1].label, "H1")
        self.assertEqual(sites[4].label, "H1")  # second cell repeats base labels

    def test_select_sites_limits(self) -> None:
        sites = [_site(0, "O", (0, 0, 0)), _site(1, "O", (5, 0, 0))]
        self.assertEqual(len(select_sites(sites, None)), 2)
        self.assertEqual([x.index for x in select_sites(sites, {"x": (-1, 1)})], [0])

    def test_style_lookup_order(self) -> None:
        cfg = SceneConfig(
            elements={
                "H1": ElementStyle(radius=1.0),
                "H": ElementStyle(radius=2.0),
                "default": ElementStyle(radius=3.0),
            }
        )
        self.assertEqual(style_for(cfg, _site(0, "H", (0, 0, 0), "H1")).radius, 1.0)
        self.assertEqual(style_for(cfg, _site(0, "H", (0, 0, 0))).radius, 2.0)
        # labels only: an H2 atom does not take the H1 style, nor does an H1 atom take the H style
        self.assertEqual(style_for(cfg, _site(0, "H", (0, 0, 0), "H2")).radius, 3.0)
        self.assertEqual(style_for(cfg, _site(0, "C", (0, 0, 0))).radius, 3.0)

    def test_material_variants(self) -> None:
        m = MaterialTable({"bond": MaterialStyle(base_color=(1, 0, 0, 1))})
        self.assertEqual(m.resolve("bond", (1, 0, 0, 1)), "bond")
        variant = m.resolve("bond", (0, 1, 0, 1))
        self.assertNotEqual(variant, "bond")
        self.assertEqual(variant, m.resolve("bond", (0, 1, 0, 1)))

    def test_bonds_and_completion(self) -> None:
        s = _water()
        atoms = repeat_structure(s, (1, 1, 1), (True, True, True))
        sites = build_sites(s, atoms)
        by_index = {x.index: x for x in sites}
        cell = cell_array(atoms)
        rules = [BondRule(a="O", b="H", min_distance=0.8, max_distance=1.2, complete="polyhedra")]
        graph = build_neighbor_graph(atoms, 1.2)
        # The rule names the label "H" only: the H1 atom (sites[1]) is not bonded by it.
        bonds = find_bonds(sites, by_index, graph, rules, cell)
        self.assertEqual([b.b.index for b in bonds], [2])
        sec = completion_rules(rules)
        self.assertEqual(len(sec), 1)  # complete=polyhedra
        done = complete_ligand(sites[0], by_index, graph, sec, cell)
        self.assertEqual([(d.partner.element, d.partner.label) for d in done], [("H", "H")])
        # the H ligand completes to its O; the H1 ligand matches no rule, so it completes to nothing
        self.assertEqual([d.partner.element for d in complete_ligand(sites[2], by_index, graph, sec, cell)], ["O"])
        self.assertEqual(complete_ligand(sites[1], by_index, graph, sec, cell), [])
        self.assertEqual(
            completion_rules([BondRule(a="O", b="H", min_distance=0.8, max_distance=1.2, complete="ends")]), []
        )
        self.assertEqual(build_neighbor_graph(atoms, 0.0), {})

    def test_polyhedra_octahedron(self) -> None:
        pts = [(2, 0, 0), (-2, 0, 0), (0, 2, 0), (0, -2, 0), (0, 0, 2), (0, 0, -2)]
        s = Structure(
            comment="oct",
            lattice=((20.0, 0, 0), (0, 20.0, 0), (0, 0, 20.0)),
            atoms=[AtomRecord("Al", (0.5, 0.5, 0.5))]
            + [AtomRecord("O", (0.5 + x / 20, 0.5 + y / 20, 0.5 + z / 20)) for x, y, z in pts],
        )
        atoms = repeat_structure(s, (1, 1, 1), (True, True, True))
        sites = build_sites(s, atoms)
        by_index = {x.index: x for x in sites}
        rule = PolyhedronRule(center="Al", ligands={"O"}, min_distance=1.5, max_distance=2.5, min_coordination=6)
        graph = build_neighbor_graph(atoms, 2.5)
        specs = find_polyhedra(sites, by_index, graph, [rule], cell_array(atoms))
        self.assertEqual(len(specs), 1)
        self.assertEqual(len(specs[0].ligands), 6)
        self.assertEqual(len(specs[0].faces), 8)
        self.assertEqual(specs[0].name, "AlO6")
        rule_strict = PolyhedronRule(center="Al", ligands={"O"}, min_distance=1.5, max_distance=2.5, min_coordination=7)
        self.assertEqual(find_polyhedra(sites, by_index, graph, [rule_strict], cell_array(atoms)), [])

    def test_displacements_scale_zero_and_index_fallback(self) -> None:
        sites = [_site(0, "O", (0, 0, 0)), _site(3, "O", (1, 0, 0)), _site(4, "O", (2, 0, 0))]
        arrows = make_displacements(sites, {0: (0.1, 0, 0), 1: (0, 0, 0)}, 3, 2.0, "weird")
        # site 3 falls back to index 0; site 4 to index 1 (zero vector, skipped)
        self.assertEqual([a.site.index for a in arrows], [0, 3])
        self.assertAlmostEqual(arrows[0].vector[0], 0.2)
        self.assertEqual(arrows[0].mode, "arrow")

    def test_assembler_hidden_atom_gets_no_primitive(self) -> None:
        cfg = SceneConfig(elements={"H": ElementStyle(visible=False)})
        asm = SceneAssembler(cfg)
        asm.add_atom(_site(0, "H", (0, 0, 0)))
        asm.add_atom(_site(1, "O", (1, 0, 0)))
        asm.add_atom(_site(1, "O", (1, 0, 0)))
        self.assertEqual(len(asm.points.records), 2)
        self.assertEqual(len(asm.primitives.atoms), 1)
        self.assertTrue(np.isfinite(asm.primitives.atoms[0].radius))


if __name__ == "__main__":
    unittest.main()


class TestWrap(unittest.TestCase):
    def test_snap_and_wrap(self) -> None:
        from gemmy.compile.sites import snap_sites, wrap_sites

        cell = np.eye(3) * 10.0
        near = Site(0, "O", "O", (0.99999, -0.00003, 1.25), (9.9999, -0.0003, 12.5))
        snapped = snap_sites([near], cell, 1e-4)[0]
        self.assertEqual(snapped.fractional, (1.0, 0.0, 1.25))
        wrapped = wrap_sites([snapped], cell, (True, True, False))[0]
        self.assertEqual(wrapped.fractional, (0.0, 0.0, 1.25))  # z not periodic: untouched
        self.assertEqual(wrapped.shift, (-1, 0, 0))
        self.assertAlmostEqual(wrapped.position[0], 0.0)
        # eps = 0 does not snap
        self.assertEqual(snap_sites([near], cell, 0.0)[0].fractional, near.fractional)


def test_cell_box_is_display_box_of_supercell():
    import numpy as np

    from gemmy.compile.lattice import cell_box

    cell = np.diag([8.0, 6.0, 4.0])  # a 2x2x2 supercell of a 4x3x2 cell
    assert cell_box(cell, {}) == ((0.0, 0.0, 0.0), ((8.0, 0.0, 0.0), (0.0, 6.0, 0.0), (0.0, 0.0, 4.0)))
    origin, vectors = cell_box(cell, {"z": (0.25, 0.75)})
    assert origin == (0.0, 0.0, 1.0) and vectors[2] == (0.0, 0.0, 2.0)
