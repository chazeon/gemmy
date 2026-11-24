"""The real Blender backend driven in-process with bpy (`scripts/check.sh --blender`)."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from gemmy.config import validate_settings
from gemmy.geom import look_at
from gemmy.render.looks import camera_distance
from gemmy.render.runner import build_scene_with_backend, render_plan, scene_bounds
from gemmy.scene import from_dict, load_scene

pytestmark = pytest.mark.blender

FIXTURE = Path(__file__).parent / "fixtures" / "rocksalt" / "scene.golden.json"
PINNED_BPY = (5, 2, 3)


@pytest.fixture
def bpy():
    bpy = pytest.importorskip("bpy")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy


def _backend():
    from gemmy.render.blender import BlenderBackend

    return BlenderBackend()


def _plan(**settings):
    plan = validate_settings(settings).resolve(str(FIXTURE))
    return plan


def _build(settings=None, *, configure=False):
    backend = _backend()
    scene = load_scene(str(FIXTURE))
    plan = _plan(**(settings or {}))
    build_scene_with_backend(scene, backend, plan)
    if configure:
        backend.configure_renderer(plan.quality)
    return backend, scene, plan


def test_bpy_version_is_the_pinned_one(bpy) -> None:
    assert tuple(bpy.app.version) == PINNED_BPY


def test_atoms_share_one_mesh_per_kind_and_recolour_alone(bpy) -> None:
    _, scene, _ = _build()
    atoms = [bpy.data.objects[a.id] for a in scene.primitives.atoms]
    assert len(atoms) > 2
    kinds = {(a.element, a.radius, a.material_id) for a in scene.primitives.atoms}
    by_radius = {}
    for atom, obj in zip(scene.primitives.atoms, atoms, strict=True):
        by_radius.setdefault(atom.radius, set()).add(obj.data.name)
        assert obj.material_slots[0].link == "OBJECT"
        assert obj.material_slots[0].material.name == atom.material_id
        assert all(p.use_smooth for p in obj.data.polygons)  # no visible facets
    assert all(len(meshes) == 1 for meshes in by_radius.values())  # one shared mesh per radius
    assert len({m for meshes in by_radius.values() for m in meshes}) == len(by_radius)
    assert len(kinds) >= 2

    first = atoms[0]
    others = [o for o in atoms[1:]]
    before = [o.material_slots[0].material.name for o in others]
    recolour = bpy.data.materials.new("Recolour")
    first.material_slots[0].material = recolour
    assert first.material_slots[0].material is recolour
    assert [o.material_slots[0].material.name for o in others] == before


def test_instancing_above_threshold(bpy) -> None:
    _, scene, _ = _build({"quality": {"instancing_threshold": 1}})
    assert not any(a.id in bpy.data.objects for a in scene.primitives.atoms)  # no per-atom objects
    instancers = [o for o in bpy.data.objects if any(m.type == "NODES" for m in o.modifiers)]
    assert instancers
    depsgraph = bpy.context.evaluated_depsgraph_get()
    instances = [i for i in depsgraph.object_instances if i.is_instance]
    assert len(instances) == len(scene.primitives.atoms)


def test_no_instancing_below_threshold(bpy) -> None:
    _build({"quality": {"instancing_threshold": 100000}})
    assert not any(m.type == "NODES" for o in bpy.data.objects for m in o.modifiers)


def test_cell_box_has_twelve_edges(bpy) -> None:
    _build({"cell_box": {"show": True}})
    assert len([o for o in bpy.data.objects if o.name.startswith("cell_box_")]) == 12


@pytest.mark.parametrize(
    "settings",
    [
        {"views": ["front"]},
        {"views": ["isometric"]},
        {"camera": {"azimuth": 0.0, "elevation": 90.0}},
        {"camera": {"direction": (1.0, -1.0, 0.75), "up": (1.0, 1.0, 0.0)}},
    ],
    ids=["front", "isometric", "elevation90", "spun"],
)
def test_camera_matches_look_at(bpy, settings) -> None:
    _, scene, plan = _build(settings)
    camera = plan.shots[0].camera
    _, extent = scene_bounds(scene)
    location, quat = look_at((0.0, 0.0, 0.0), camera.direction, camera_distance(extent, camera.zoom), camera.up)
    obj = bpy.data.objects["PBB_Camera"]
    assert tuple(obj.location) == pytest.approx(location, abs=1e-4)
    assert tuple(obj.rotation_quaternion) == pytest.approx(quat, abs=1e-4)
    assert bpy.context.scene.camera is obj


def test_3to2d_has_toon_materials_and_outline(bpy) -> None:
    _, _, plan = _build({"look": {"preset": "3to2d"}, "cell_box": {"show": True}}, configure=True)
    box = bpy.data.materials["PBB_CellBox"].node_tree.nodes["Principled BSDF"]  # crisp flat lines
    assert box.inputs["Emission Strength"].default_value == 1.0
    render = bpy.context.scene.render
    assert render.use_freestyle
    layer = bpy.context.scene.view_layers[0]
    assert layer.use_freestyle
    style = layer.freestyle_settings.linesets[0].linestyle
    assert tuple(style.color) == pytest.approx(plan.look.outline_color)
    assert style.thickness == pytest.approx(plan.look.outline_width * plan.quality.resolution[1])


@pytest.mark.parametrize("polyhedron_shadows", [None, True])  # 3to2d default: polyhedra cast no shadow
def test_polyhedron_shadows_switch(bpy, polyhedron_shadows) -> None:
    look = {"preset": "3to2d", "polyhedron_shadows": polyhedron_shadows}
    _build({"look": look, "polyhedron": {"opacity": 1.0}})
    polys = [o for o in bpy.data.objects if o.name.startswith("poly_")]
    assert polys and {o.visible_shadow for o in polys} == {bool(polyhedron_shadows)}


@pytest.mark.parametrize("atom_shadows", [None, True])  # 3to2d default: atoms cast no shadow
def test_atom_shadows_switch(bpy, atom_shadows) -> None:
    _, scene, _ = _build({"look": {"preset": "3to2d", "atom_shadows": atom_shadows}})
    assert {bpy.data.objects[a.id].visible_shadow for a in scene.primitives.atoms} == {bool(atom_shadows)}


def test_dashed_and_dotted_bonds_are_outline_free_pieces(bpy) -> None:
    backend = _backend()
    backend.add_cylinder("dash", (0, 0, 0), (0, 0, 1), 0.05, "missing", outline=False)
    backend.add_cylinder("solid", (1, 0, 0), (1, 0, 1), 0.05, "missing", outline=True)
    backend.add_dot("dot", (2, 0, 0), 0.05, "missing")
    free = {o.name for o in backend._outline_free_collection().objects}
    assert {"dash", "dot"} <= free and "solid" not in free
    assert all(p.use_smooth for p in bpy.data.objects["dot"].data.polygons)


def test_tiny_render_writes_a_png(bpy, tmp_path: Path) -> None:
    out = tmp_path / "tiny.png"
    plan = validate_settings(
        {"quality": {"resolution": (64, 64), "samples": 4, "device": "CPU"}, "out": str(out)}
    ).resolve(str(FIXTURE))
    plan = from_dict(type(plan), json.loads(json.dumps(dataclasses.asdict(plan))))
    render_plan(plan, _backend())
    assert out.is_file() and out.stat().st_size > 100
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_outline_linesets_skip_extra_edge_types_and_keep_atom_circles_whole(bpy) -> None:
    _build({"look": {"preset": "3to2d"}, "polyhedron": {"opacity": 1.0}}, configure=True)  # no ghost line set
    linesets = {ls.name: ls for ls in bpy.context.scene.view_layers[0].freestyle_settings.linesets}
    assert set(linesets) == {"PBB_Outline", "PBB_AtomOutline"}
    for ls in linesets.values():
        assert ls.select_by_edge_types
        assert (ls.select_silhouette, ls.select_border, ls.select_crease) == (True, True, True)
        off = (ls.select_contour, ls.select_external_contour, ls.select_material_boundary, ls.select_edge_mark)
        assert off == (False, False, False, False)
        assert not (ls.select_ridge_valley or ls.select_suggestive_contour)
    assert linesets["PBB_Outline"].visibility == "VISIBLE"
    atoms = linesets["PBB_AtomOutline"]  # lines hidden behind one surface stay: spheres cut by faces stay whole
    assert atoms.visibility == "RANGE" and (atoms.qi_start, atoms.qi_end) == (0, 1)
    assert atoms.collection.name == "PBB_Atoms" and atoms.select_by_collection
    assert all(
        o.name in bpy.data.collections["PBB_Atoms"].objects for o in bpy.data.objects if o.name.startswith("atom_")
    )


def test_axes_indicator_has_three_arrows_and_the_right_labels(bpy) -> None:
    for kind, labels in (("abc", "abc"), ("xyz", "xyz")):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        _build({"axes": {"enabled": True, "kind": kind}})
        heads = [o for o in bpy.data.objects if o.name.startswith("PBB_Axis_") and o.name.endswith("_head")]
        texts = sorted((o for o in bpy.data.objects if o.type == "FONT"), key=lambda o: o.name)
        assert len(heads) == 3 and len(texts) == 3
        assert "".join(o.data.body for o in texts) == labels
        assert all(o.parent.name == "PBB_Axes_Anchor" for o in texts)
        assert bpy.data.objects["PBB_Axes_Anchor"].parent is bpy.data.objects["PBB_Camera"]


def _triad_screen_points(bpy):
    from bpy_extras.object_utils import world_to_camera_view

    bpy.context.view_layer.update()
    scene, camera = bpy.context.scene, bpy.context.scene.camera
    points = []
    for index in range(3):
        head = bpy.data.objects[f"PBB_Axis_{index}_head"]
        for vertex in head.data.vertices:
            points.append(world_to_camera_view(scene, camera, head.matrix_world @ vertex.co)[:2])
        label = bpy.data.objects[f"PBB_AxisLabel_{index}"]
        points.append(world_to_camera_view(scene, camera, label.matrix_world.translation)[:2])
    return points


def test_axes_triad_is_the_same_flat_picture_in_every_projection(bpy) -> None:
    views = {
        "ortho": {},
        "persp24": {"projection": "persp", "lens": 24},
        "persp50": {"projection": "persp", "lens": 50},
    }
    shots = {}
    for name, camera in views.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        _build({"axes": {"enabled": True}, "camera": {"direction": (1, -0.8, 0.5), **camera}})
        shots[name] = _triad_screen_points(bpy)
    assert len(shots["ortho"]) == 12
    for name in ("persp24", "persp50"):
        for got, want in zip(shots[name], shots["ortho"], strict=True):
            assert got == pytest.approx(want, abs=2e-3), name


def test_axis_labels_use_the_bundled_font(bpy) -> None:
    from gemmy.render.looks import BOLD_LABEL_FONT_CANDIDATES

    font = BOLD_LABEL_FONT_CANDIDATES[0]  # bold by default
    _build({"axes": {"enabled": True}})
    texts = [o for o in bpy.data.objects if o.type == "FONT"]
    assert texts and all(o.data.font.filepath == font and o.data.shear == 0 for o in texts)


def test_axes_off_leaves_no_indicator(bpy) -> None:
    _build({"look": {"preset": "default"}})
    assert not [o for o in bpy.data.objects if o.name.startswith(("PBB_Axis", "PBB_Axes"))]


def test_3to2d_ortho_camera_node_chain_and_sun_with_shadows(bpy) -> None:
    _, scene, plan = _build({"look": {"preset": "3to2d"}}, configure=True)
    assert bpy.data.objects["PBB_Camera"].data.type == "ORTHO"
    material = bpy.data.materials[scene.primitives.atoms[0].material_id]
    types = [n.bl_idname for n in material.node_tree.nodes]
    for needed in ("ShaderNodeBsdfDiffuse", "ShaderNodeShaderToRGB", "ShaderNodeValToRGB", "ShaderNodeEmission"):
        assert needed in types
    ramp = next(n for n in material.node_tree.nodes if n.bl_idname == "ShaderNodeValToRGB")
    assert ramp.color_ramp.interpolation == "CONSTANT" and len(ramp.color_ramp.elements) == 2
    suns = {name: bpy.data.objects[name].data for name, *_ in plan.look.suns}
    assert set(suns) == {"PBB_SunKey", "PBB_SunFill", "PBB_SunRim"} and all(d.type == "SUN" for d in suns.values())
    assert [n for n, d in suns.items() if d.use_shadow] == ["PBB_SunKey"] and suns["PBB_SunKey"].angle > 0
    assert bpy.context.scene.render.use_freestyle


def _toon_polyhedra(bpy, opacity: float):
    _build({"look": {"preset": "3to2d"}, "polyhedron": {"opacity": opacity}}, configure=True)
    objs = [o for o in bpy.data.objects if o.name.startswith("poly_")]
    assert objs
    return objs


def test_3to2d_ghost_polyhedron_is_blended_transparent_and_casts_no_shadow(bpy) -> None:
    for obj in _toon_polyhedra(bpy, 0.2):
        mat = obj.data.materials[0]
        assert mat.surface_render_method == "BLENDED"
        nodes = mat.node_tree.nodes
        mix = nodes["PBB_Toon_Mix"]
        assert mix.inputs["Fac"].default_value == pytest.approx(0.2)
        assert {link.from_node.name for link in mix.inputs[1].links} == {"PBB_Toon_Transparent"}
        assert {link.from_node.name for link in mix.inputs[2].links} == {"PBB_Toon_Emission"}
        assert not obj.visible_shadow
        assert "PBB_Ghosts" in {c.name for c in obj.users_collection}
    names = [ls.name for ls in bpy.context.scene.view_layers[0].freestyle_settings.linesets]
    assert "PBB_GhostOutline" in names


def test_3to2d_opaque_polyhedron_is_unchanged(bpy) -> None:
    for obj in _toon_polyhedra(bpy, 1.0):
        mat = obj.data.materials[0]
        assert mat.surface_render_method != "BLENDED"
        assert "PBB_Toon_Mix" not in mat.node_tree.nodes
        assert "PBB_Ghosts" not in {c.name for c in obj.users_collection}
    names = [ls.name for ls in bpy.context.scene.view_layers[0].freestyle_settings.linesets]
    assert "PBB_GhostOutline" not in names


CYLINDER_FACES, CONE_FACES = 34, 33  # 32 sides + 2 caps; 32 sides + 1 cap


def _named(bpy, prefix: str):
    return [o for o in bpy.data.objects if o.name.startswith(prefix)]


def test_below_threshold_bonds_and_polyhedra_are_separate_recolourable_objects(bpy) -> None:
    _, scene, _ = _build({"look": {"preset": "3to2d"}})
    prims = scene.primitives
    bonds = [bpy.data.objects[b.id] for b in prims.bonds]
    assert len({o.data.name for o in bonds}) == 1  # one shared unit mesh
    assert all(o.material_slots[0].link == "OBJECT" and o.material_slots[0].material for o in bonds)
    polys = [bpy.data.objects[p.id] for p in prims.polyhedra]
    assert len({o.data.name for o in polys}) == len(polys)
    assert all(o.data.materials[0] is not None for o in polys)
    assert not _named(bpy, "cylinders_") and not _named(bpy, "polyhedra_")


def test_above_threshold_bonds_arrows_and_polyhedra_merge_per_material(bpy) -> None:
    settings = {
        "look": {"preset": "3to2d"},
        "quality": {"instancing_threshold": 1},
        "polyhedron": {"edge_color": [0.1, 0.1, 0.1, 1.0]},
    }
    _, scene, _ = _build(settings, configure=True)
    prims = scene.primitives
    assert not any(b.id in bpy.data.objects for b in prims.bonds)
    assert not any(p.id in bpy.data.objects for p in prims.polyhedra)
    solid, arrows, polys = _named(bpy, "cylinders_"), _named(bpy, "arrows_"), _named(bpy, "polyhedra_")
    n_arrows = sum(d.mode.lower() == "arrow" for d in prims.displacements)
    n_cylinders = len(prims.bonds) + len(prims.displacements) - n_arrows
    assert sum(len(o.data.polygons) for o in solid) == CYLINDER_FACES * n_cylinders
    assert sum(len(o.data.polygons) for o in arrows) == (CYLINDER_FACES + CONE_FACES) * n_arrows
    topologies = {t.id: t for t in scene.topologies}
    assert sum(len(o.data.polygons) for o in polys) == sum(
        len(topologies[p.topology_id].faces) for p in prims.polyhedra
    )
    assert all(any(m.type == "WIREFRAME" for m in o.modifiers) for o in polys)
    assert len(solid) + len(arrows) + len(polys) < 20
    free = {o.name for o in bpy.data.collections["PBB_NoOutline"].objects}
    assert {o.name for o in arrows} <= free and not {o.name for o in solid} & free
    ghosts = {o.name for o in bpy.data.collections["PBB_Ghosts"].objects}
    assert ghosts and ghosts <= {o.name for o in polys} and ghosts <= free  # own line set, out of the main one
    linesets = {ls.name: ls for ls in bpy.context.scene.view_layers[0].freestyle_settings.linesets}
    assert {"PBB_Outline", "PBB_AtomOutline", "PBB_GhostOutline"} <= set(linesets)
    assert linesets["PBB_Outline"].collection.name == "PBB_NoOutline"
    assert linesets["PBB_Outline"].collection_negation == "EXCLUSIVE"


def test_batched_dashes_and_dots_are_outline_free_and_solid_bonds_are_not(bpy) -> None:
    backend = _backend()
    pieces = [((0, 0, 0), (0, 0, 1), 0.05), ((1, 0, 0), (1, 0, 1), 0.05), ((2, 0, 0), (2, 0, 0), 0.05)]
    backend.add_cylinder_batch("dashes", pieces, "missing", outline=False)
    backend.add_cylinder_batch("solid", pieces[:2], "missing", outline=True)
    backend.add_dot_batch("dots", [((0, 1, 0), 0.05), ((1, 1, 0), 0.05)], "missing")
    free = {o.name for o in backend._outline_free_collection().objects}
    assert free == {"dashes", "dots"}
    assert len(bpy.data.objects["dashes"].data.polygons) == 2 * CYLINDER_FACES  # zero-length piece skipped
    dots = bpy.data.objects["dots"].data
    assert len(dots.polygons) == 2 * 12 * 8 and all(p.use_smooth for p in dots.polygons)
    assert not any(p.use_smooth for p in bpy.data.objects["solid"].data.polygons)
