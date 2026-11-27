"""Clusters (gemmy.compile.clusters): molecules and rings on the synthetic structures of tests/cluster_structures.py,
the cages of the c60 example (one per molecule copy, 63 at 2x2x2), and the warnings: a periodic network, a cluster with
no area, a search cut short. tests/test_ts_clusters.py compares the TypeScript side with these."""

from __future__ import annotations

import math
import time
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from cluster_structures import (
    C6,
    PERIODIC,
    benzene,
    c60_poscar,
    chain,
    chair_cyclohexane,
    collinear_triple,
    honeycomb_sheet,
    k23,
    molecule,
    naphthalene,
    ring,
    split_ring,
    stages,
)
from gemmy.compile import clusters
from gemmy.compile.clusters import find_clusters
from gemmy.compile.sites import point_key
from gemmy.config import MAX_RING_SIZE, ClusterRule

# A search that the bounds of these structures keep short finishes far inside this, even on a slow CI machine.
QUICK_SECONDS = 10.0


def clusters_of(tmp_path: Path, text: str, rules, supercell=(1, 1, 1), periodic=PERIODIC, box=None, eps=1e-4):
    """The clusters and the warnings find_clusters gives for `text`: (specs, warnings)."""
    cutoff = max(r.max_distance for r in rules)
    shown, by_index, graph, cell = stages(tmp_path, text, supercell, periodic, box, eps, cutoff)
    warnings: list[str] = []
    specs = find_clusters(shown, by_index, graph, rules, cell, box or {}, periodic, eps, warnings)
    return specs, warnings


def member_keys(spec) -> frozenset:
    return frozenset(point_key(m) for m in spec.members)


# ---- rings ----------------------------------------------------------------------------------------------------------


def test_benzene_is_one_flat_hexagon_with_h_excluded(tmp_path):
    specs, _ = clusters_of(tmp_path, benzene(), [ring()])
    assert len(specs) == 1
    spec = specs[0]
    assert len(spec.members) == 6
    assert {m.element for m in spec.members} == {C6}
    assert spec.name == "ring6"
    # fan from the centroid (index 6): 6 triangles, each emitted twice with the opposite winding
    assert len(spec.faces) == 12
    assert {f for f in spec.faces if 6 in f} == {(k, (k + 1) % 6, 6) for k in range(6)} | {
        (k, 6, (k + 1) % 6) for k in range(6)
    }
    assert spec.centroid == pytest.approx((10.0, 10.0, 10.0), abs=1e-9)
    assert spec.centroid_fractional == pytest.approx((0.5, 0.5, 0.5), abs=1e-9)


def test_naphthalene_gives_its_two_hexagons_never_the_ten_ring(tmp_path):
    specs, _ = clusters_of(tmp_path, naphthalene(), [ring()])
    assert sorted(len(s.members) for s in specs) == [6, 6]
    assert all(s.name == "ring6" for s in specs)
    assert len({member_keys(s) for s in specs}) == 2
    shared = member_keys(specs[0]) & member_keys(specs[1])
    assert len(shared) == 2  # the fused bond


def test_k23_gives_all_three_squares(tmp_path):
    """Every shortest cycle through a bond is kept: K2,3 has three 4-cycles, and each bond lies in two of them."""
    specs, warnings = clusters_of(tmp_path, k23(), [ring(min_size=4, max_size=4, min=0.99, max=1.01)])
    assert warnings == []
    assert len(specs) == 3
    assert all(len(s.members) == 4 for s in specs)
    assert len({member_keys(s) for s in specs}) == 3


def test_ring_split_by_the_cell_boundary_is_one_whole_ring(tmp_path):
    specs, _ = clusters_of(tmp_path, split_ring(), [ring()], box={}, eps=1e-4)
    assert len(specs) == 1
    spec = specs[0]
    assert len(member_keys(spec)) == 6
    # the members are whole: some sit at negative fractional x in the file, and the centroid is the ring's centre
    assert spec.centroid_fractional == pytest.approx((0.02, 0.5, 0.5), abs=1e-9)
    assert spec.centroid == pytest.approx((0.2, 5.0, 5.0), abs=1e-9)


def test_ring_centroid_on_a_box_face_keeps_both_translates(tmp_path):
    """The centroid rule is inclusive, as base_box is: a ring centred on x = 0 has a copy on x = 1."""
    specs, _ = clusters_of(tmp_path, split_ring(centre_x=0.0), [ring()])
    assert sorted(round(s.centroid_fractional[0], 6) for s in specs) == [0.0, 1.0]


def test_crop_slab_finds_a_ring_centred_on_the_slab_face(tmp_path):
    """A display box that is a thin slab around x = 0 crops every atom of a ring centred on x = 0 except a few; the
    ring is still found, because its centroid is in the box."""
    specs, warnings = clusters_of(tmp_path, split_ring(centre_x=0.0), [ring()], box={"x": [-0.02, 0.02]}, eps=1e-4)
    assert warnings == []
    assert len(specs) == 1
    assert len(member_keys(specs[0])) == 6


def test_cyclohexane_chair_is_one_puckered_ring_with_fan_faces(tmp_path):
    specs, _ = clusters_of(tmp_path, chair_cyclohexane(), [ring()])
    assert len(specs) == 1
    spec = specs[0]
    assert len(spec.members) == 6
    zs = sorted(round(m.position[2] - 10.0, 6) for m in spec.members)
    assert zs == [-0.25, -0.25, -0.25, 0.25, 0.25, 0.25]  # puckered, not flat
    assert len(spec.faces) == 12


def test_flat_ring_rule_keeps_the_flat_ring_and_drops_the_chair(tmp_path):
    flat_specs, _ = clusters_of(tmp_path, benzene(), [ring(flat=True)])
    assert [spec.name for spec in flat_specs] == ["ring6"]
    chair_specs, chair_warnings = clusters_of(tmp_path, chair_cyclohexane(), [ring(flat=True)])
    assert chair_specs == []
    assert chair_warnings == []  # a puckered ring is left out by the rule, not skipped with a warning


def test_flat_is_for_rings_only():
    with pytest.raises(ValidationError, match="flat applies to a ring only"):
        ClusterRule.model_validate({"kind": "molecule", "atoms": [C6], "min": 1.3, "max": 1.5, "flat": True})


# A unit square and a chair's corners (the same shape as the TypeScript twin's test in tests/test_ts_clusters.py).
SQUARE = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]]
CHAIR = [[0.0, 0.0, 0.25], [1.0, 0.0, -0.25], [1.5, 1.0, 0.25], [1.0, 2.0, -0.25], [0.0, 2.0, 0.25], [-0.5, 1.0, -0.25]]


@pytest.mark.parametrize("shift", [0.0, 2.0**40, -(2.0**40)])
def test_a_flat_ring_far_from_the_origin_is_flat(shift):
    moved = [[x + shift, y + shift, z + shift] for x, y, z in SQUARE]
    assert clusters.is_flat_ring(moved)


def test_a_puckered_ring_is_not_flat_at_any_place():
    assert not clusters.is_flat_ring(CHAIR)
    assert not clusters.is_flat_ring([[x + 2.0**40, y, z] for x, y, z in CHAIR])


def test_ring_size_window_and_visibility(tmp_path):
    assert clusters_of(tmp_path, benzene(), [ring(max_size=5)])[0] == []
    assert clusters_of(tmp_path, benzene(), [ring(min_size=7)])[0] == []
    assert clusters_of(tmp_path, benzene(), [ring(visible=False)])[0] == []


def test_ring_max_size_is_the_search_depth(tmp_path):
    """A hexagon is a 6-cycle: a search of max_size 5 never reaches it, a search of 6 does."""
    assert clusters_of(tmp_path, benzene(), [ring(min_size=4, max_size=5)])[0] == []
    assert len(clusters_of(tmp_path, benzene(), [ring(min_size=4, max_size=6)])[0]) == 1


def test_zero_area_ring_is_skipped_with_a_warning(tmp_path):
    """Three atoms on one line form a 3-cycle with no area: no face, so no cluster, and a message naming it."""
    specs, warnings = clusters_of(tmp_path, collinear_triple(), [ring(min=1.0, max=2.01, min_size=3, max_size=3)])
    assert specs == []
    assert len(warnings) == 1
    assert warnings[0].startswith("cluster ring3 skipped")


def test_graphene_primitive_cell_has_its_hexagon_with_default_max_size(tmp_path):
    """Two C in the primitive honeycomb, bonds 1.35-1.50 A: the hexagon is found with the default ring size."""
    specs, warnings = clusters_of(tmp_path, honeycomb_sheet(cells=1), [ring(min=1.35, max=1.5)])
    assert warnings == []
    assert specs
    assert all(len(s.members) == 6 for s in specs)


def test_pendant_on_a_sheet_finds_every_hexagon_quickly(tmp_path):
    """A 6x6 graphene sheet with one pendant atom: the pendant is no ring member, the hexagons are all found, and the
    search ends well inside the time bound."""
    start = time.perf_counter()
    specs, warnings = clusters_of(
        tmp_path, honeycomb_sheet(cells=6, pendant=True), [ring(max_size=MAX_RING_SIZE, min=1.3, max=1.5)], box={}
    )
    assert time.perf_counter() - start < QUICK_SECONDS
    assert warnings == []
    assert len(specs) == 36
    assert all(len(s.members) == 6 for s in specs)


def test_pendant_on_a_sheet_as_a_molecule_is_one_network_warning(tmp_path):
    """The sheet with its pendant is one periodic network: no molecule, one warning, and the walk ends quickly."""
    start = time.perf_counter()
    specs, warnings = clusters_of(tmp_path, honeycomb_sheet(cells=6, pendant=True), [molecule(min_size=4)], box={})
    assert time.perf_counter() - start < QUICK_SECONDS
    assert specs == []
    assert len(warnings) == 1
    assert "periodic network" in warnings[0]


def test_periodic_chain_of_2000_atoms_is_one_warning_and_quick(tmp_path):
    """A closed chain of 2000 atoms is one periodic network, not 2000 molecules, and no ring of it is in the size."""
    start = time.perf_counter()
    text = chain(2000)
    specs, warnings = clusters_of(tmp_path, text, [molecule(), ring()])
    assert time.perf_counter() - start < QUICK_SECONDS
    assert specs == []
    assert len(warnings) == 1
    assert "molecule of C" in warnings[0] and "periodic network" in warnings[0]


def test_a_search_over_its_budget_is_cut_short_with_a_warning(tmp_path, monkeypatch):
    """When a rule's searches exceed MAX_CLUSTER_SEARCH_STEPS, the rule gives no clusters and a warning names it."""
    monkeypatch.setattr(clusters, "MAX_CLUSTER_SEARCH_STEPS", 20)
    specs, warnings = clusters_of(tmp_path, benzene(), [ring()])
    assert specs == []
    assert len(warnings) == 1
    assert "ring of C" in warnings[0] and "cut short" in warnings[0]


# ---- molecules ------------------------------------------------------------------------------------------------------


def test_benzene_as_a_molecule_is_one_flat_polygon_drawn_from_both_sides(tmp_path):
    specs, _ = clusters_of(tmp_path, benzene(), [molecule()])
    assert len(specs) == 1
    spec = specs[0]
    assert spec.name == "C6"
    assert len(spec.faces) == 8  # 4 fan triangles of the hexagon, each twice
    assert len(member_keys(spec)) == 6


def test_molecule_size_window(tmp_path):
    assert clusters_of(tmp_path, benzene(), [molecule(min_size=7)])[0] == []
    assert clusters_of(tmp_path, benzene(), [molecule(max_size=5)])[0] == []


def test_periodic_network_is_not_a_molecule(tmp_path):
    """Two atoms bonded to each other and to their own images: one network, dropped with a warning."""
    from cluster_structures import poscar

    text = poscar(2.8, [(C6, (0.0, 0.0, 0.0)), (C6, (1.4, 0.0, 0.0))])
    specs, warnings = clusters_of(tmp_path, text, [molecule()])
    assert specs == []
    assert len(warnings) == 1 and "periodic network" in warnings[0]


def test_collinear_molecule_is_skipped_with_a_warning(tmp_path):
    specs, warnings = clusters_of(tmp_path, collinear_triple(), [molecule(min_size=3, min=1.0, max=2.01)])
    assert specs == []
    assert len(warnings) == 1 and warnings[0].startswith("cluster C3 skipped")


def test_rule_name_overrides_the_default(tmp_path):
    specs, _ = clusters_of(tmp_path, naphthalene(), [ring(name="fused")])
    assert {s.name for s in specs} == {"fused"}


# ---- the c60 example: one cage per molecule -------------------------------------------------------------------------


def _rounded(position) -> tuple[float, float, float]:
    return tuple(round(v, 3) for v in position)


@pytest.mark.parametrize(("supercell", "cages"), [((1, 1, 1), 14), ((2, 2, 2), 63)])
def test_c60_gives_one_cage_per_molecule_copy(tmp_path, supercell, cages):
    """One cage per molecule copy in the display box: a 1x1x1 cell has molecules across its faces (copies included), a
    2x2x2 cell has them across the cell edges too. Folded into the supercell, the copies are the 4 molecules of each
    conventional cell."""
    specs, warnings = clusters_of(tmp_path, c60_poscar(), [molecule()], supercell=supercell)
    assert warnings == []
    assert len(specs) == cages
    assert all(spec.name == "C60" for spec in specs)
    assert all(len(spec.members) == 60 for spec in specs)
    assert all(len(spec.faces) == 116 for spec in specs)  # 12 pentagons (3 each) and 20 hexagons (4 each)
    folded = {tuple(round(v, 6) % 1.0 for v in spec.centroid_fractional) for spec in specs}
    assert len(folded) == 4 * math.prod(supercell)


def test_c60_cage_members_are_equidistant_from_its_centroid(tmp_path):
    """A C60 cage: all 60 carbons sit at one distance from the molecule's centroid (3.51 A), so the centroid is the
    cage's centre."""
    specs, _ = clusters_of(tmp_path, c60_poscar(), [molecule()], supercell=(2, 2, 2))
    assert len(specs) == 63
    for spec in specs:
        radii = [np.linalg.norm(np.asarray(m.position) - np.asarray(spec.centroid)) for m in spec.members]
        assert float(np.ptp(radii)) < 0.05
        assert radii[0] == pytest.approx(3.51, abs=0.01)


def test_c60_split_molecule_is_whole_across_the_edge(tmp_path):
    """In a 1x1x1 cell some cages are split by the cell faces: their members sit outside [0, 1) in the cell."""
    specs, _ = clusters_of(tmp_path, c60_poscar(), [molecule()], supercell=(1, 1, 1))
    split = [s for s in specs if any(not (0 <= m.fractional[k] < 1) for m in s.members for k in range(3))]
    assert split, "no molecule crosses a cell face in this cell"
    assert all(len(s.members) == 60 for s in split)


# ---- the config contract ---------------------------------------------------------------------------------------------


def test_cluster_sizes_default_by_kind_and_a_ring_has_a_number():
    mol = ClusterRule.model_validate({"kind": "molecule", "atoms": ["C"], "min": 1.3, "max": 1.6})
    assert (mol.min_size, mol.max_size) == (4, None)
    ring_default = ClusterRule.model_validate({"kind": "ring", "atoms": ["C"], "min": 1.3, "max": 1.5})
    assert (ring_default.min_size, ring_default.max_size) == (5, 7)
    with pytest.raises(ValidationError):  # config refuses a ring without a limit
        ClusterRule.model_validate({"kind": "ring", "atoms": ["C"], "min": 1.3, "max": 1.5, "max_size": None})


def test_cluster_atoms_are_a_sorted_set_and_the_window_has_aliases():
    rule = ClusterRule.model_validate(
        {"kind": "ring", "atoms": ["N", "C", "N"], "min_distance": 1.3, "max_distance": 1.5}
    )
    assert rule.atoms == ["C", "N"]
    assert (rule.min_distance, rule.max_distance) == (1.3, 1.5)
    assert rule.color == (0.2, 0.6, 1.0, 1.0) and rule.material == "polyhedron" and rule.name is None
