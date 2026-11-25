"""The render runner: drives a backend from a scene document and a render plan.

`render_plan` loads the scene, recentres it (bounds computed once), builds every primitive through the
backend Protocols below, then renders each shot. All methods of the Protocols are mandatory; the runner
never probes a backend with `hasattr`.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Sequence
from pathlib import Path
from typing import TypeVar

from ..geom import arrow_span, bounds, cell_box_edges, cross, dash_segments, dot_centres, length, normalize, shrink
from ..scene import MaterialStyle, SceneDocument, Vec3, load_scene
from ..settings import Camera, RenderPlan
from .looks import ortho_scale
from .materials import resolve_shader, shade_bands
from .protocols import AxesSpec

T = TypeVar("T")
# The axis indicator's origin ball takes this material; the Cartesian axes are x, y and z.
AXES_HUB_MATERIAL = "PBB_Axes_Hub"
_CARTESIAN: tuple[Vec3, Vec3, Vec3] = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
# Dash and dot sizes, in bond radii, with a floor (Angstrom) so thin bonds still read as broken lines.
DASH_LENGTH, DASH_GAP, DASH_MIN = 6.0, 4.0, 0.1
DOT_RADIUS, DOT_SPACING, DOT_SPACING_MIN = 1.6, 8.0, 0.12


def _three(items: Sequence[T]) -> tuple[T, T, T]:
    """The items of an axis triple as a tuple; a list of another length is a bug and fails here."""
    first, second, third = items
    return first, second, third


def scene_bounds(scene: SceneDocument) -> tuple[Vec3, float]:
    """Centre and size (bounding-box diagonal) from scene data (points, displacement tips), computed once."""
    point_map = {point.id: point.position for point in scene.points}
    points = list(point_map.values())
    for disp in scene.primitives.displacements:
        atom = point_map.get(disp.start_point_id)
        if atom is not None:
            points.extend(arrow_span(atom, disp.vector, disp.anchor))
    return bounds(points)


def _polyhedron_material_ids(scene: SceneDocument) -> set[str]:
    return {poly.material_id for poly in scene.primitives.polyhedra}


def _plain_material(color, roughness: float) -> MaterialStyle:
    return MaterialStyle(type="principled", base_color=color, roughness=roughness, metallic=0.0, alpha=1.0)


def _add_materials(scene: SceneDocument, backend, plan: RenderPlan) -> tuple[str | None, str | None, set[str]]:
    """Create every material. The last result is the polyhedron materials that render see-through."""
    look = plan.look
    ghosts: set[str] = set()
    poly_ids = _polyhedron_material_ids(scene)
    bands = shade_bands(look.toon_bands, look.shadow)
    for name, style in scene.materials.items():
        poly = plan.polyhedron if name in poly_ids else None
        spec = resolve_shader(style, polyhedron=poly, srgb=look.srgb_colors, bands=bands)
        if spec.blended:
            ghosts.add(name)
        backend.ensure_material(name, spec)
    edge_material = arrow_material = None
    if plan.polyhedron.edge_color is not None:
        edge_material = "PBB_PolyEdge"
        edge = _plain_material(plan.polyhedron.edge_color, 0.4)
        backend.ensure_material(edge_material, resolve_shader(edge, srgb=look.srgb_colors))
    if plan.arrows.color is not None:
        arrow_material = "PBB_Arrow"
        arrow = _plain_material(plan.arrows.color, 0.35)
        backend.ensure_material(arrow_material, resolve_shader(arrow, srgb=look.srgb_colors, bands=bands))
    return edge_material, arrow_material, ghosts


def _local_camera(camera: Camera, center: tuple[float, float, float]) -> Camera:
    """Camera target in recentred coordinates (None means the centre, i.e. the origin)."""
    if camera.target is None:
        return dataclasses.replace(camera, target=(0.0, 0.0, 0.0))
    t = camera.target
    return dataclasses.replace(camera, target=(t[0] - center[0], t[1] - center[1], t[2] - center[2]))


def _add_atoms(scene: SceneDocument, backend, point_map, quality) -> None:
    """Linked duplicates by default; Geometry Nodes instancing above the threshold."""
    atoms = [a for a in scene.primitives.atoms if a.point_id in point_map]
    if len(atoms) > quality.instancing_threshold:
        grouped: dict[tuple[str, float, str], list[tuple[float, float, float]]] = {}
        for atom in atoms:
            grouped.setdefault((atom.element, atom.radius, atom.material_id), []).append(point_map[atom.point_id])
        for index, ((element, radius, material_id), centers) in enumerate(grouped.items()):
            backend.add_atom_instances(
                name=f"atoms_{index}_{element}",
                centers=centers,
                radius=radius,
                material=material_id,
                segments=quality.sphere_segments,
                ring_count=quality.sphere_rings,
            )
        return
    for atom in atoms:
        backend.add_atom(
            name=atom.id,
            center=point_map[atom.point_id],
            radius=atom.radius,
            material=atom.material_id,
            segments=quality.sphere_segments,
            ring_count=quality.sphere_rings,
        )


def _add_cell_box(scene: SceneDocument, backend, plan: RenderPlan, center, extent: float) -> None:
    style = plan.cell_box
    if not style.show or scene.cell is None:
        return
    backend.ensure_material(
        "PBB_CellBox",
        resolve_shader(_plain_material(style.color, 0.5), srgb=plan.look.srgb_colors, matte=True),
    )
    # Line width is a fraction of the image height; the frame is ortho_scale wide (square-ish images).
    radius = 0.5 * style.width * ortho_scale(extent, plan.shots[0].camera.zoom)
    for n, (a, b) in enumerate(cell_box_edges(scene.cell.origin, scene.cell.vectors)):
        local_a = tuple(a[i] - center[i] for i in range(3))
        local_b = tuple(b[i] - center[i] for i in range(3))
        backend.add_cylinder(
            name=f"cell_box_{n}", a=local_a, b=local_b, radius=radius, material="PBB_CellBox", outline=False
        )


def _lattice_directions(vectors) -> tuple[Vec3, Vec3, Vec3]:
    """Unit directions of the box vectors. A flat display box (e.g. one layer, z range [0, 0]) has a zero
    vector; that axis then takes the normal of the other two."""
    vecs = list(vectors)
    for i in range(3):
        if length(vecs[i]) < 1e-9:
            vecs[i] = cross(vecs[(i + 1) % 3], vecs[(i + 2) % 3])
    return _three([normalize(v) for v in vecs])


def _axes_spec(scene: SceneDocument, backend, plan: RenderPlan) -> AxesSpec | None:
    axes = plan.axes
    if not axes.enabled:
        return None
    if axes.kind == "xyz":
        labels, directions = ("x", "y", "z"), _CARTESIAN
    else:
        if scene.cell is None:
            raise ValueError("axes.kind 'abc' needs a cell in the scene; use 'xyz'")
        labels = ("a", "b", "c")
        directions = _lattice_directions(scene.cell.vectors)
    look = plan.look
    materials, shaders = [], []
    for label, color in zip(labels, look.axis_colors, strict=True):
        name = f"PBB_Axis_{label}"
        shader = resolve_shader(_plain_material((*color, 1.0), 1.0), matte=True, srgb=look.srgb_colors)
        backend.ensure_material(name, shader)
        materials.append(name)
        shaders.append(shader)
    # The origin ball takes the display box's colour, as the web viewer's ball takes the box colour.
    backend.ensure_material(
        AXES_HUB_MATERIAL,
        resolve_shader(_plain_material(plan.cell_box.color, 0.5), matte=True, srgb=look.srgb_colors),
    )
    background = tuple(channel * look.world_strength for channel in look.world_color)
    return AxesSpec(
        labels=labels,
        directions=directions,
        materials=_three(materials),
        size=axes.size,
        margin=axes.margin,
        shaders=_three(shaders),
        hub=AXES_HUB_MATERIAL,
        background=_three(background),
        font=axes.font,
    )


def build_scene_with_backend(scene: SceneDocument, backend, plan: RenderPlan) -> None:
    """Populate the backend. Points are recentred here, so the camera target is always the origin."""
    (cx, cy, cz), extent = scene_bounds(scene)
    point_map = {p.id: (p.position[0] - cx, p.position[1] - cy, p.position[2] - cz) for p in scene.points}
    topology_map = {t.id: t for t in scene.topologies}
    quality = plan.quality
    target = (0.0, 0.0, 0.0)

    backend.apply_look(plan.look)
    if plan.remove_default_cube:
        backend.remove_default_cube()
    edge_material, arrow_material, ghosts = _add_materials(scene, backend, plan)

    _add_atoms(scene, backend, point_map, quality)

    _add_pieces(backend, _bond_and_arrow_pieces(scene, point_map, plan, arrow_material), plan, quality)
    _add_polyhedra(scene, backend, point_map, topology_map, plan, edge_material, ghosts)

    _add_cell_box(scene, backend, plan, (cx, cy, cz), extent)

    backend.setup_soft_lighting(target, extent, plan.soft_lighting)
    backend.setup_backdrop(target, extent, plan.look.backdrop)
    backend.set_camera(_local_camera(plan.shots[0].camera, (cx, cy, cz)), extent)
    backend.set_axes_overlay(_axes_spec(scene, backend, plan))


@dataclasses.dataclass(frozen=True)
class Piece:
    """One drawn piece: a cylinder or arrow from `a` to `b`, or a dot at `a` (radius is the dot radius)."""

    kind: str  # "cylinder" | "dot" | "arrow"
    name: str
    a: Vec3
    b: Vec3
    radius: float
    material: str
    outline: bool = False


def _bond_pieces(bond, a: Vec3, b: Vec3) -> list[Piece]:
    r = bond.radius
    if bond.style == "dashed":
        dash = max(DASH_LENGTH * r, DASH_MIN)
        segments = dash_segments(a, b, dash, dash * DASH_GAP / DASH_LENGTH)
        return [Piece("cylinder", f"{bond.id}_{k}", s, e, r, bond.material_id) for k, (s, e) in enumerate(segments)]
    if bond.style == "dotted":
        centres = dot_centres(a, b, max(DOT_SPACING * r, DOT_SPACING_MIN))
        return [Piece("dot", f"{bond.id}_{k}", c, c, DOT_RADIUS * r, bond.material_id) for k, c in enumerate(centres)]
    return [Piece("cylinder", bond.id, a, b, r, bond.material_id, outline=True)]


def _bond_and_arrow_pieces(
    scene: SceneDocument, point_map, plan: RenderPlan, arrow_material: str | None
) -> list[Piece]:
    pieces: list[Piece] = []
    for bond in scene.primitives.bonds:
        a = point_map.get(bond.a_point_id)
        b = point_map.get(bond.b_point_id)
        if a is not None and b is not None:
            pieces.extend(_bond_pieces(bond, a, b))
    arrows = plan.arrows
    for disp in scene.primitives.displacements:
        atom = point_map.get(disp.start_point_id)
        if atom is None:
            continue
        start, end = arrow_span(atom, disp.vector, disp.anchor)
        radius = disp.radius if arrows.radius is None else arrows.radius
        material = arrow_material or disp.material_id
        if disp.mode.lower() == "arrow":
            pieces.append(Piece("arrow", disp.id, start, end, radius, material))
        else:
            pieces.append(Piece("cylinder", disp.id, start, end, radius * 0.7, material, outline=True))
    return pieces


def _add_pieces(backend, pieces: list[Piece], plan: RenderPlan, quality) -> None:
    """Bonds, dashes, dots and arrows: one object each, or one object per (kind, outline, material) above the
    threshold. Solid cylinders keep their outline; dashes, dots and arrows stay outline-free."""
    arrows = plan.arrows
    if len(pieces) <= quality.instancing_threshold:
        for p in pieces:
            if p.kind == "cylinder":
                backend.add_cylinder(p.name, p.a, p.b, p.radius, p.material, outline=p.outline)
            elif p.kind == "dot":
                backend.add_dot(p.name, p.a, p.radius, p.material)
            else:
                backend.add_arrow(
                    p.name,
                    p.a,
                    p.b,
                    p.radius,
                    p.material,
                    head_radius_ratio=arrows.head_radius_ratio,
                    head_length_ratio=arrows.head_length_ratio,
                )
        return
    groups: dict[tuple[str, bool, str], list[Piece]] = {}
    for p in pieces:
        groups.setdefault((p.kind, p.outline, p.material), []).append(p)
    for (kind, outline, material), group in groups.items():
        name = f"{kind}s_{material}" + ("" if outline or kind != "cylinder" else "_free")
        if kind == "cylinder":
            backend.add_cylinder_batch(name, [(p.a, p.b, p.radius) for p in group], material, outline=outline)
        elif kind == "dot":
            backend.add_dot_batch(name, [(p.a, p.radius) for p in group], material)
        else:
            backend.add_arrow_batch(
                name,
                [(p.a, p.b, p.radius) for p in group],
                material,
                head_radius_ratio=arrows.head_radius_ratio,
                head_length_ratio=arrows.head_length_ratio,
            )


def _add_polyhedra(scene: SceneDocument, backend, point_map, topology_map, plan: RenderPlan, edge_material, ghosts):
    """One object per polyhedron, or one merged mesh per material above the threshold."""
    shown = []
    for poly in scene.primitives.polyhedra:
        topology = topology_map.get(poly.topology_id)
        if topology is None:
            continue
        vertices = [point_map.get(pid) for pid in topology.point_ids]
        if any(v is None for v in vertices):
            continue
        shown.append((poly, shrink(vertices, plan.polyhedron.scale), topology.faces))
    style = {"edge_material": edge_material, "edge_width": plan.polyhedron.edge_width}
    if len(shown) <= plan.quality.instancing_threshold:
        for poly, vertices, faces in shown:
            backend.add_mesh(poly.id, vertices, faces, poly.material_id, ghost=poly.material_id in ghosts, **style)
        return
    groups: dict[str, list] = {}
    for poly, vertices, faces in shown:
        groups.setdefault(poly.material_id, []).append((vertices, faces))
    for material, parts in groups.items():
        backend.add_mesh_batch(f"polyhedra_{material}", parts, material, ghost=material in ghosts, **style)


def render_plan(plan: RenderPlan, backend) -> SceneDocument:
    """Load the scene named by the plan, build it, and render every requested view."""
    scene = load_scene(plan.scene)
    build_scene_with_backend(scene, backend, plan)
    backend.configure_renderer(plan.quality)
    center, extent = scene_bounds(scene)
    for shot in plan.shots:
        if shot.output is None:
            continue
        output = Path(shot.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        backend.set_camera(_local_camera(shot.camera, center), extent)
        backend.render_still(str(output))
    return scene
