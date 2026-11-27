"""The scene document: the compiled, reference-based contract between compile and render.

One definition, plain frozen stdlib dataclasses with defaults, importable inside Blender. The outer
process validates JSON against them with `pydantic.TypeAdapter` (see `gemmy.config`); `Strict` makes
that reject unknown keys without this module importing pydantic. Reference integrity (dangling ids,
face indices, duplicates) is `check_references`. Blender reads a scene with `load_scene`.
"""

from __future__ import annotations

import dataclasses
import json
import types
import typing
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

Vec3 = tuple[float, float, float]
Color = tuple[float, float, float, float]
SCENE_SCHEMA_VERSION = 3
TopologyMode = Literal["topology_locked", "topology_adaptive"]
DisplacementMode = Literal["arrow", "line"]
ArrowAnchor = Literal["tail", "tip"]
BondStyle = Literal["solid", "dashed", "dotted"]


class Strict:
    """Base of every validated dataclass: pydantic rejects unknown keys (the dict is only data here)."""

    __slots__ = ()
    __pydantic_config__ = {"extra": "forbid"}


@dataclass(frozen=True, slots=True)
class MaterialStyle(Strict):
    type: str = "principled"
    base_color: Color = (0.8, 0.8, 0.8, 1.0)
    roughness: float = 0.4
    metallic: float = 0.0
    alpha: float = 1.0


@dataclass(frozen=True, slots=True)
class PointRecord(Strict):
    id: str
    element: str
    label: str  # the species label as written in the structure file ("C_dna"); the element for computed points
    position: Vec3
    fractional: Vec3 | None = None
    ref: str | None = None  # atom reference as typed in configs: "5" or "5+1_0_0" (compile.selection.parse_site_ref)


@dataclass(frozen=True, slots=True)
class TopologyRecord(Strict):
    id: str
    point_ids: list[str]
    faces: list[tuple[int, int, int]]


@dataclass(frozen=True, slots=True)
class AtomPrimitive(Strict):
    id: str
    element: str
    label: str
    point_id: str
    radius: float
    material_id: str


@dataclass(frozen=True, slots=True)
class BondPrimitive(Strict):
    id: str
    a_point_id: str
    b_point_id: str
    radius: float
    material_id: str
    a_element: str
    b_element: str
    a_label: str
    b_label: str
    style: BondStyle = "solid"  # dashed / dotted: e.g. hydrogen bonds


@dataclass(frozen=True, slots=True)
class PolyhedronPrimitive(Strict):
    id: str
    name: str
    center_point_id: str
    ligand_point_ids: list[str]
    topology_id: str
    topology_mode: TopologyMode  # reserved for animation; see PolyhedronRule.topology_mode
    material_id: str
    per_frame_topology: dict[str, str] | None = None  # frame -> topology id; reserved for animation (only "0" today)


@dataclass(frozen=True, slots=True)
class DisplacementPrimitive(Strict):
    id: str
    start_point_id: str
    vector: Vec3
    mode: DisplacementMode = "arrow"
    anchor: ArrowAnchor = "tail"  # tail: arrow starts at the atom; tip: arrow ends at the atom
    radius: float = 0.022
    material_id: str = "bond"


@dataclass(frozen=True, slots=True)
class ScenePrimitives(Strict):
    atoms: list[AtomPrimitive] = field(default_factory=list)
    bonds: list[BondPrimitive] = field(default_factory=list)
    polyhedra: list[PolyhedronPrimitive] = field(default_factory=list)
    displacements: list[DisplacementPrimitive] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class CellBox(Strict):
    """Display box as a parallelepiped: Cartesian origin plus the three edge vectors."""

    origin: Vec3
    vectors: tuple[Vec3, Vec3, Vec3]


@dataclass(frozen=True, slots=True)
class SceneDocument(Strict):
    source_comment: str
    materials: dict[str, MaterialStyle]
    points: list[PointRecord] = field(default_factory=list)
    topologies: list[TopologyRecord] = field(default_factory=list)
    primitives: ScenePrimitives = field(default_factory=ScenePrimitives)
    cell: CellBox | None = None
    schema_version: int = SCENE_SCHEMA_VERSION


def check_version(version: object) -> None:
    """Raise ValueError unless `version` is this gemmy's scene version. Run before the scene is parsed."""
    if version != SCENE_SCHEMA_VERSION:
        raise ValueError(
            f"This scene has schema_version {version}; this gemmy reads version {SCENE_SCHEMA_VERSION}. "
            "Recompile the scene from its config."
        )


def check_references(scene: SceneDocument) -> None:
    """Raise ValueError for empty or duplicate ids, dangling references or bad face indices."""
    prim = scene.primitives
    points = _unique_ids(scene.points, "points")
    topologies = _unique_ids(scene.topologies, "topologies")
    for kind in ("atoms", "bonds", "polyhedra", "displacements"):
        _unique_ids(getattr(prim, kind), f"primitives.{kind}")

    def need(ids: object, ref: str, where: str, label: str) -> None:
        if ref not in ids:  # type: ignore[operator]
            raise ValueError(f"{where} references unknown {label} '{ref}'.")

    for topo in scene.topologies:
        for pid in topo.point_ids:
            need(points, pid, f"topologies[{topo.id}]", "point_id")
        for fi, face in enumerate(topo.faces):
            if any(c < 0 or c >= len(topo.point_ids) for c in face):
                raise ValueError(f"topologies[{topo.id}].faces[{fi}] has an index out of bounds.")
    for i, atom in enumerate(prim.atoms):
        where = f"primitives.atoms[{i}]"
        need(points, atom.point_id, where, "point_id")
        need(scene.materials, atom.material_id, where, "material_id")
    for i, bond in enumerate(prim.bonds):
        where = f"primitives.bonds[{i}]"
        need(points, bond.a_point_id, where, "point_id")
        need(points, bond.b_point_id, where, "point_id")
        need(scene.materials, bond.material_id, where, "material_id")
    for i, poly in enumerate(prim.polyhedra):
        where = f"primitives.polyhedra[{i}]"
        need(points, poly.center_point_id, where, "center point")
        for pid in poly.ligand_point_ids:
            need(points, pid, where, "ligand point")
        need(topologies, poly.topology_id, where, "topology_id")
        need(scene.materials, poly.material_id, where, "material_id")
        for frame, topo_id in (poly.per_frame_topology or {}).items():
            if poly.topology_mode == "topology_locked" and topo_id != poly.topology_id:
                raise ValueError(
                    f"{where} is topology_locked but frame {frame} uses '{topo_id}', not '{poly.topology_id}'."
                )
            need(topologies, topo_id, f"{where} frame {frame}", "topology_id")
    for i, disp in enumerate(prim.displacements):
        where = f"primitives.displacements[{i}]"
        need(points, disp.start_point_id, where, "point_id")
        need(scene.materials, disp.material_id, where, "material_id")


def _unique_ids(items: list, field_name: str) -> dict[str, object]:
    out: dict[str, object] = {}
    for item in items:
        if not item.id:
            raise ValueError(f"Empty id in {field_name}.")
        if item.id in out:
            raise ValueError(f"Duplicate id '{item.id}' in {field_name}.")
        out[item.id] = item
    return out


def from_dict(tp: Any, data: Any) -> Any:
    """Build dataclass `tp` (or a list/tuple/dict/Optional of them) from JSON data. No validation:
    the JSON was validated by the outer process. Unknown keys are a TypeError."""
    origin = typing.get_origin(tp)
    if data is None:
        return None
    if dataclasses.is_dataclass(tp):
        hints = typing.get_type_hints(tp)
        return tp(**{key: from_dict(hints[key], value) for key, value in data.items()})
    if origin in (typing.Union, types.UnionType):
        (inner,) = (a for a in typing.get_args(tp) if a is not type(None))
        return from_dict(inner, data)
    args = typing.get_args(tp)
    if origin is list:
        return [from_dict(args[0], v) for v in data]
    if origin is tuple:
        if len(args) == 2 and args[1] is Ellipsis:
            return tuple(from_dict(args[0], v) for v in data)
        return tuple(from_dict(a, v) for a, v in zip(args, data, strict=True))
    if origin is dict:
        return {k: from_dict(args[1], v) for k, v in data.items()}
    return data


def load_scene(path: str | Path) -> SceneDocument:
    return from_dict(SceneDocument, json.loads(Path(path).read_text(encoding="utf-8")))
