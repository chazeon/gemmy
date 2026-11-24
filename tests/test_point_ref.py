from __future__ import annotations

import unittest

import numpy as np

from gemmy.compile.bonds import cell_array
from gemmy.compile.pipeline import compile_scene
from gemmy.compile.selection import resolve_centre
from gemmy.compile.sites import base_box, build_sites, repeat_structure, snap_sites, wrap_sites
from gemmy.config import load_scene_config
from gemmy.structure import load_structure
from golden import FIXTURES


def _round_trip(poscar, config_path):
    """Compile, then resolve every point's ref the way a config would and compare positions."""
    structure = load_structure(poscar)
    cfg = load_scene_config(config_path)
    scene = compile_scene(structure, cfg, base_dir=config_path.parent)
    atoms = repeat_structure(structure, cfg.cell.supercell, cfg.cell.periodic)
    cell = cell_array(atoms)
    base = snap_sites(build_sites(structure, atoms), cell, cfg.cell.eps)
    by_index = {s.index: s for s in base}
    shown = base_box(wrap_sites(base, cell, cfg.cell.periodic), cell, cfg.cell.box, cfg.cell.periodic, cfg.cell.eps)
    for point in scene.points:
        assert point.ref is not None
        site = resolve_centre(point.ref, shown, by_index, cell)
        np.testing.assert_allclose(site.position, point.position, atol=1e-9, err_msg=point.ref)
    return scene


class TestPointRef(unittest.TestCase):
    def test_rocksalt_round_trip(self) -> None:
        d = FIXTURES / "rocksalt"
        scene = _round_trip(d / "POSCAR", d / "config.json")
        refs = [p.ref for p in scene.points]
        self.assertEqual(len(refs), len(set(refs)))

    def test_wrap_round_trip_and_boundary_copies(self) -> None:
        d = FIXTURES / "wrap"
        scene = _round_trip(d / "POSCAR", d / "config.json")
        mg = [p.ref for p in scene.points if p.element == "Mg"]
        self.assertEqual(len(mg), 8)  # corner atom shown 8 times
        self.assertEqual(len(set(mg)), 8)
        self.assertIn("0", mg)
        self.assertIn("0+1_1_1", mg)

    def test_raw_coordinate_below_one_is_relative_to_the_wrapped_atom(self) -> None:
        d = FIXTURES / "wrap"
        scene = _round_trip(d / "POSCAR.alt", d / "config.json")
        mg = {p.ref for p in scene.points if p.element == "Mg"}
        same = compile_scene(load_structure(d / "POSCAR"), load_scene_config(d / "config.json"))
        self.assertEqual(mg, {p.ref for p in same.points if p.element == "Mg"})
