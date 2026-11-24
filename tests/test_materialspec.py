from __future__ import annotations

from gemmy.render.materials import resolve_shader
from gemmy.render.runner import _polyhedron_material_ids
from gemmy.scene import AtomPrimitive, MaterialStyle, PolyhedronPrimitive, SceneDocument, ScenePrimitives
from gemmy.settings import PolyhedronStyle


def _poly(**kw):
    base = dict(
        transmission=None,
        opacity=None,
        roughness=None,
        ior=1.05,
        absorption=0.0,
        edge_color=None,
        edge_width=0.05,
        scale=1.0,
    )
    return PolyhedronStyle(**{**base, **kw})


def _mat(**kw):
    base = dict(type="principled", base_color=(0.8, 0.8, 0.8, 1.0), roughness=0.4, metallic=0.0, alpha=1.0)
    return MaterialStyle(**{**base, **kw})


def test_opaque_polyhedron_from_alpha() -> None:
    spec = resolve_shader(_mat(alpha=1.0), polyhedron=_poly())
    assert spec.transmission == 0.0 and spec.alpha == 1.0 and spec.absorption_density == 0.0


def test_translucent_polyhedron_transmits_by_alpha() -> None:
    spec = resolve_shader(_mat(alpha=0.2), polyhedron=_poly())
    assert abs(spec.transmission - 0.8) < 1e-9 and spec.alpha == 1.0


def test_overrides_win() -> None:
    style = _poly(transmission=0.92, opacity=1.0, roughness=0.1)
    spec = resolve_shader(_mat(alpha=0.2), polyhedron=style)
    assert spec.transmission == 0.92 and spec.roughness == 0.1


def test_opacity_override_makes_opaque() -> None:
    spec = resolve_shader(_mat(alpha=0.2), polyhedron=_poly(opacity=1.0))
    assert spec.transmission == 0.0


def test_plain_material_untouched_and_matte() -> None:
    assert resolve_shader(_mat(roughness=0.3)).roughness == 0.3
    assert resolve_shader(_mat(roughness=0.3), matte=True).emission == 1.0


def _scene(materials, poly_material=None, used_by_atom=None) -> SceneDocument:
    polys = []
    if poly_material:
        polys.append(PolyhedronPrimitive("p", "n", "c", [], "t", "topology_locked", poly_material, None))
    atoms = [AtomPrimitive("a", "X", "p", 1.0, used_by_atom)] if used_by_atom else []
    prim = ScenePrimitives(atoms=atoms, polyhedra=polys)
    return SceneDocument("x", {m: _mat() for m in materials}, [], [], prim, None, 2)


def test_polyhedron_materials_come_from_primitives_only() -> None:
    assert _polyhedron_material_ids(_scene(["glassy"], "glassy")) == {"glassy"}
    # No name-based detection: a "polyhedron*" material used by an atom is an ordinary material.
    assert _polyhedron_material_ids(_scene(["polyhedron_x"], used_by_atom="polyhedron_x")) == set()


def test_flat_materials_are_emission_fills() -> None:
    spec = resolve_shader(_mat(), matte=True)
    assert spec.emission == 1.0 and spec.specular == 0.0


def test_translucent_polyhedron_in_a_toon_look_is_blended_not_transmissive() -> None:
    bands = ((0.0, 0.7), (0.6, 1.0))
    spec = resolve_shader(_mat(alpha=0.2), polyhedron=_poly(), bands=bands)
    assert spec.blended and spec.alpha == 0.2 and spec.transmission == 0.0 and spec.bands == bands
    assert not resolve_shader(_mat(alpha=1.0), polyhedron=_poly(), bands=bands).blended
    assert not resolve_shader(_mat(alpha=0.2), polyhedron=_poly(), bands=()).blended  # other looks keep transmission
    assert not resolve_shader(_mat(alpha=0.2), polyhedron=_poly(transmission=0.5), bands=bands).blended
    assert not resolve_shader(_mat(alpha=0.2), bands=bands).blended  # atoms and bonds are never ghosts
