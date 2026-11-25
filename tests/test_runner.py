"""Runner (builder.py) driven through the RecordingBackend: order, recentring, options."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from gemmy.config import validate_settings
from gemmy.render.runner import build_scene_with_backend, render_plan, scene_bounds
from gemmy.scene import SceneDocument, from_dict
from gemmy.settings import RenderPlan, RenderSettings
from recording import RecordingBackend

FIXTURE = Path(__file__).parent / "fixtures" / "rocksalt" / "scene.golden.json"


def _plan(tmp_path: Path, **overrides):
    plan = validate_settings(overrides).resolve(str(FIXTURE))
    return from_dict(RenderPlan, json.loads(json.dumps(dataclasses.asdict(plan))))  # prove it survives JSON


def _scene():
    return from_dict(SceneDocument, json.loads(FIXTURE.read_text(encoding="utf-8")))


def test_runner_order_and_counts(tmp_path: Path) -> None:
    backend = RecordingBackend()
    plan = _plan(tmp_path, out_dir=str(tmp_path / "r"), views=["front", "top"])
    scene = render_plan(plan, backend)
    names = backend.names()
    assert names[0] == "apply_look"
    assert names.index("ensure_material") < names.index("add_atom")
    order = ["setup_soft_lighting", "setup_backdrop", "set_camera", "set_axes_overlay", "configure_renderer"]
    assert [n for n in names if n in order][:5] == order
    assert names.count("configure_renderer") == 1  # configured once
    directions = [a[0].direction for a, _ in backend.of("set_camera")]
    assert directions == [(0.0, -1.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, 1.0)]
    assert len(backend.of("render_still")) == 2
    assert backend.of("render_still")[0][0][0].endswith("front.png")
    assert len(backend.of("add_cylinder")) == len(scene.primitives.bonds)
    assert len(backend.of("add_mesh")) == len(scene.primitives.polyhedra)


def test_points_are_recentred_and_bounds_computed_once(tmp_path: Path) -> None:
    scene = _scene()
    center, extent = scene_bounds(scene)
    backend = RecordingBackend()
    build_scene_with_backend(scene, backend, _plan(tmp_path))
    positions = [args[1] for (args, _) in backend.of("add_atom")]
    for axis in range(3):
        lo = min(p[axis] for p in positions)
        hi = max(p[axis] for p in positions)
        assert lo == pytest.approx(-hi, abs=extent)  # centred about the origin within the disp margin
    camera, cam_extent = backend.of("set_camera")[0][0]
    assert camera.target == (0.0, 0.0, 0.0) and cam_extent == extent
    assert backend.of("setup_soft_lighting")[0][0][:2] == ((0.0, 0.0, 0.0), extent)


def test_arrow_and_polyhedron_options_reach_backend(tmp_path: Path) -> None:
    backend = RecordingBackend()
    plan = _plan(
        tmp_path,
        arrows={"radius": 0.2, "color": [1, 0, 0]},
        polyhedron={"opacity": 1.0, "edge_color": [0, 0, 0]},
    )
    build_scene_with_backend(_scene(), backend, plan)
    (args, kwargs) = backend.of("add_arrow")[0]
    assert args[3] == 0.2 and args[4] == "PBB_Arrow"
    assert backend.of("add_mesh")[0][1]["edge_material"] == "PBB_PolyEdge"
    spec = dict((a[0], a[1]) for a, _ in backend.of("ensure_material"))
    poly_ids = {p.material_id for p in _scene().primitives.polyhedra}
    assert all(spec[m].transmission == 0.0 for m in poly_ids)


def test_polyhedron_scale_shrinks_about_centroid(tmp_path: Path) -> None:
    full, small = RecordingBackend(), RecordingBackend()
    build_scene_with_backend(_scene(), full, _plan(tmp_path))
    build_scene_with_backend(_scene(), small, _plan(tmp_path, polyhedron={"scale": 0.5}))
    a = full.of("add_mesh")[0][0][1]
    b = small.of("add_mesh")[0][0][1]
    c = [sum(v[i] for v in a) / len(a) for i in range(3)]
    for va, vb in zip(a, b, strict=True):
        assert vb == pytest.approx(tuple(c[i] + (va[i] - c[i]) * 0.5 for i in range(3)))


def test_flat_slab_and_top_down_camera(tmp_path: Path) -> None:
    from gemmy.geom import look_at, rotate

    doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for p in doc["points"]:
        p["position"][2] = 0.0  # z-slab
    scene = from_dict(SceneDocument, doc)
    center, extent = scene_bounds(scene)
    assert abs(center[2]) < 0.2 and extent >= 1.0  # displacement tips add a little z
    plan = _plan(tmp_path, camera={"azimuth": 0, "elevation": 90})
    backend = RecordingBackend()
    build_scene_with_backend(scene, backend, plan)
    camera, _ = backend.of("set_camera")[0][0]
    _, q = look_at(camera.target, camera.direction, 5.0)
    up = rotate(q, (0, 1, 0))
    assert up[1] > 0.99  # top-down keeps +y up, no degenerate basis


def test_custom_camera_target_is_recentred_and_out_names_the_file(tmp_path: Path) -> None:
    scene = _scene()
    center, _ = scene_bounds(scene)
    out = tmp_path / "sub" / "x.png"
    plan = _plan(
        tmp_path,
        camera={"azimuth": 30, "elevation": 20, "projection": "ortho", "zoom": 2, "target": [1, 1, 1], "lens": 50},
        out=str(out),
    )
    backend = RecordingBackend()
    from gemmy.render.runner import render_plan

    render_plan(plan, backend)
    camera = backend.of("set_camera")[-1][0][0]
    assert camera.projection == "ortho" and camera.zoom == 2 and camera.lens == 50
    assert camera.target == pytest.approx((1 - center[0], 1 - center[1], 1 - center[2]))
    assert backend.of("render_still")[0][0][0] == str(out) and out.parent.is_dir()


def test_atoms_are_linked_duplicates_below_threshold_and_instanced_above(tmp_path: Path) -> None:
    scene = _scene()
    n = len(scene.primitives.atoms)
    low = RecordingBackend()
    build_scene_with_backend(scene, low, _plan(tmp_path))
    assert len(low.of("add_atom")) == n and not low.of("add_atom_instances")
    high = RecordingBackend()
    build_scene_with_backend(scene, high, _plan(tmp_path, quality={"instancing_threshold": n - 1}))
    assert not high.of("add_atom") and high.of("add_atom_instances")
    assert sum(len(a[1]) for a, _ in high.of("add_atom_instances")) == n
    at_threshold = RecordingBackend()
    build_scene_with_backend(scene, at_threshold, _plan(tmp_path, quality={"instancing_threshold": n}))
    assert at_threshold.of("add_atom")


def test_default_threshold_is_2000() -> None:
    assert RenderSettings().quality.instancing_threshold == 2000


def test_cell_box_off_by_default_and_on_in_3to2d(tmp_path: Path) -> None:
    scene = _scene()
    off = RecordingBackend()
    build_scene_with_backend(scene, off, _plan(tmp_path))
    assert not [c for c in off.of("add_cylinder") if c[0][0].startswith("cell_box")]

    on = RecordingBackend()
    build_scene_with_backend(scene, on, _plan(tmp_path, look={"preset": "3to2d"}))
    edges = [c for c in on.of("add_cylinder") if c[0][0].startswith("cell_box")]
    assert len(edges) == 12
    lengths = sorted(round(sum((p - q) ** 2 for p, q in zip(a[1], a[2], strict=True)) ** 0.5, 6) for a, _ in edges)
    cell = scene.cell
    expected = sorted(round(sum(x * x for x in v) ** 0.5, 6) for v in cell.vectors for _ in range(4))
    assert lengths == expected


def test_cell_box_flags_override_look(tmp_path: Path) -> None:
    scene = _scene()
    backend = RecordingBackend()
    build_scene_with_backend(scene, backend, _plan(tmp_path, look={"preset": "3to2d"}, cell_box={"show": False}))
    assert not [c for c in backend.of("add_cylinder") if c[0][0].startswith("cell_box")]
    backend = RecordingBackend()
    build_scene_with_backend(
        scene, backend, _plan(tmp_path, cell_box={"show": True, "color": (1, 0, 0), "width": 0.01})
    )
    edges = [c for c in backend.of("add_cylinder") if c[0][0].startswith("cell_box")]
    assert len(edges) == 12
    assert not any(k["outline"] for _, k in edges)  # an outline around a line would draw it twice as thick
    spec = [a for (a, _) in backend.of("ensure_material") if a[0] == "PBB_CellBox"]
    assert spec


def test_cell_box_cli_flags() -> None:
    from gemmy.cli import resolve_settings
    from gemmy.cli_args import parse

    args = parse(["render", "--scene", "s.json", "--cell-box.show", "True", "--cell-box.width", "0.004"])
    s = resolve_settings(args)
    assert s.cell_box.show is True and s.cell_box.width == 0.004
    args = parse(["render", "--scene", "s.json", "--look.preset", "3to2d", "--cell-box.show", "False"])
    assert resolve_settings(args).cell_box.show is False


def test_axes_default_follows_the_look_and_flags_override(tmp_path: Path) -> None:
    for preset, expected in (("default", False), ("classic", False), ("3to2d", True)):
        assert _plan(tmp_path, look={"preset": preset}).axes.enabled is expected
    assert _plan(tmp_path, look={"preset": "3to2d"}, axes={"enabled": False}).axes.enabled is False
    assert _plan(tmp_path, axes={"enabled": True}).axes.enabled is True


def test_axes_spec_abc_uses_the_cell_vectors_and_xyz_the_cartesian_axes(tmp_path: Path) -> None:
    from gemmy.geom import normalize

    scene = _scene()
    backend = RecordingBackend()
    build_scene_with_backend(scene, backend, _plan(tmp_path, axes={"enabled": True}))
    spec = backend.of("set_axes_overlay")[0][0][0]
    assert spec.labels == ("a", "b", "c")
    assert spec.directions == tuple(normalize(v) for v in scene.cell.vectors)
    assert [a[0] for a, _ in backend.of("ensure_material") if a[0].startswith("PBB_Axis_")] == [
        "PBB_Axis_a",
        "PBB_Axis_b",
        "PBB_Axis_c",
    ]
    backend = RecordingBackend()
    build_scene_with_backend(scene, backend, _plan(tmp_path, axes={"enabled": True, "kind": "xyz"}))
    spec = backend.of("set_axes_overlay")[0][0][0]
    assert spec.labels == ("x", "y", "z") and spec.directions[2] == (0.0, 0.0, 1.0)
    backend = RecordingBackend()
    build_scene_with_backend(scene, backend, _plan(tmp_path))
    assert backend.of("set_axes_overlay")[0][0] == (None,)


def test_axes_spec_carries_the_shaders_the_depth_fade_mixes_and_the_origin_ball(tmp_path: Path) -> None:
    plan = _plan(tmp_path, axes={"enabled": True})
    backend = RecordingBackend()
    build_scene_with_backend(_scene(), backend, plan)
    spec = backend.of("set_axes_overlay")[0][0][0]
    made = {args[0]: args[1] for args, _ in backend.of("ensure_material")}
    assert spec.hub == "PBB_Axes_Hub" and "PBB_Axes_Hub" in made
    assert spec.shaders == tuple(made[name] for name in spec.materials)
    assert spec.background == pytest.approx(tuple(c * plan.look.world_strength for c in plan.look.world_color))


def test_3to2d_resolves_ortho_rotated_view_with_bands(tmp_path: Path) -> None:
    plan = _plan(tmp_path, look={"preset": "3to2d", "shadow": 0.5})
    shot = plan.shots[0]
    assert shot.camera.projection == "ortho" and shot.camera.direction[2] > 0 and shot.camera.direction[0] > 0
    assert plan.look.freestyle and len(plan.look.suns) == 3 and plan.look.shadow == 0.5
    assert not plan.look.atom_shadows and not plan.look.polyhedron_shadows
    backend = RecordingBackend()
    build_scene_with_backend(_scene(), backend, plan)
    banded = [a[1] for a, _ in backend.of("ensure_material") if a[1].bands]
    assert banded
    assert banded[0].bands[0][1] == pytest.approx(1 - (1 - 0.72) * 0.5)  # shadow scales the shaded tone
    assert banded[0].bands[-1][1] == 1.0


def test_flat_display_box_still_gives_three_axis_directions() -> None:
    from gemmy.render.runner import _lattice_directions

    a, b, c = _lattice_directions(((4.0, 0.0, 0.0), (0.0, 4.0, 0.0), (0.0, 0.0, 0.0)))
    assert (a, b) == ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0)) and c == (0.0, 0.0, 1.0)


def test_translucent_polyhedra_are_ghosts_only_in_a_toon_look(tmp_path: Path) -> None:
    flags = {}
    for preset in ("3to2d", "default"):
        backend = RecordingBackend()
        build_scene_with_backend(_scene(), backend, _plan(tmp_path, look={"preset": preset}))
        flags[preset] = {kw["ghost"] for _, kw in backend.of("add_mesh")}
    assert flags == {"3to2d": {True}, "default": {False}}


def _style_bonds(scene, style: str):
    bonds = [dataclasses.replace(b, style=style) for b in scene.primitives.bonds]
    return dataclasses.replace(scene, primitives=dataclasses.replace(scene.primitives, bonds=bonds))


@pytest.mark.parametrize("style", ["solid", "dashed", "dotted"])
def test_bond_pieces_batch_per_material_above_the_threshold(tmp_path: Path, style: str) -> None:
    scene = _style_bonds(_scene(), style)
    each = RecordingBackend()
    build_scene_with_backend(scene, each, _plan(tmp_path))
    n = len(each.of("add_cylinder")) + len(each.of("add_dot")) + len(each.of("add_arrow"))
    bond_pieces = [c for c in each.of("add_cylinder") if c[0][0].startswith("bond_")]
    assert n > 0 and not each.of("add_cylinder_batch") and not each.of("add_dot_batch")
    batched = RecordingBackend()
    build_scene_with_backend(scene, batched, _plan(tmp_path, quality={"instancing_threshold": n - 1}))
    assert not [c for c in batched.of("add_cylinder") if c[0][0].startswith("bond_")] and not batched.of("add_dot")
    cylinders, dots = batched.of("add_cylinder_batch"), batched.of("add_dot_batch")
    assert sum(len(a[1]) for a, _ in cylinders) == len(bond_pieces)
    assert sum(len(a[1]) for a, _ in dots) == len(each.of("add_dot"))
    assert all(k["outline"] == (style == "solid") for _, k in cylinders)
    names = [a[0] for a, _ in cylinders + dots]
    assert len(names) == len(set(names))  # one object per material and kind
    at_threshold = RecordingBackend()
    build_scene_with_backend(scene, at_threshold, _plan(tmp_path, quality={"instancing_threshold": n}))
    assert not at_threshold.of("add_cylinder_batch") and not at_threshold.of("add_dot_batch")


def test_polyhedra_merge_per_material_above_the_threshold(tmp_path: Path) -> None:
    scene = _scene()
    n = len(scene.primitives.polyhedra)
    assert n > 0
    low = RecordingBackend()
    build_scene_with_backend(scene, low, _plan(tmp_path, quality={"instancing_threshold": n}))
    assert len(low.of("add_mesh")) == n and not low.of("add_mesh_batch")
    high = RecordingBackend()
    build_scene_with_backend(scene, high, _plan(tmp_path, quality={"instancing_threshold": n - 1}))
    assert not high.of("add_mesh")
    batches = high.of("add_mesh_batch")
    assert sum(len(a[1]) for a, _ in batches) == n
    assert len({a[2] for a, _ in batches}) == len(batches)
    assert {k["ghost"] for _, k in batches} == {k["ghost"] for _, k in low.of("add_mesh")}


@pytest.mark.parametrize("style", ["solid", "dashed", "dotted"])
def test_bond_style_picks_cylinders_dashes_or_dots(tmp_path: Path, style: str) -> None:
    scene = _scene()
    bonds = [dataclasses.replace(b, style=style) for b in scene.primitives.bonds]
    scene = dataclasses.replace(scene, primitives=dataclasses.replace(scene.primitives, bonds=bonds))
    backend = RecordingBackend()
    build_scene_with_backend(scene, backend, _plan(tmp_path))
    pieces = [c for c in backend.of("add_cylinder") if c[0][0].startswith("bond_")]
    dots = backend.of("add_dot")
    if style == "solid":
        assert len(pieces) == len(bonds) and not dots and all(k["outline"] for _, k in pieces)
    elif style == "dashed":
        assert len(pieces) > len(bonds) and not dots and not any(k["outline"] for _, k in pieces)
    else:
        assert not pieces and len(dots) > len(bonds)
        assert sorted({a[2] for a, _ in dots}) == pytest.approx(sorted({1.6 * b.radius for b in bonds}))
