"""The backend contract: the Protocols a render backend implements (render/blender is the Blender one). The runner
(render/runner.py) calls them in order; all methods are mandatory, and the runner never probes a backend with
`hasattr`. `AxesSpec` is what the Stage gets for the axis indicator: the data, not the Blender objects."""

from __future__ import annotations

import dataclasses
from typing import Protocol

from ..scene import Vec3
from ..settings import Camera, Quality
from .looks import Look
from .materials import ShaderSpec


@dataclasses.dataclass(frozen=True)
class AxesSpec:
    """The axis indicator: label, world direction (unit) and material name for each of three axes, each axis's
    shader before any depth fade, the origin ball's material, and the colour the depth fade mixes toward."""

    labels: tuple[str, str, str]
    directions: tuple[Vec3, Vec3, Vec3]
    materials: tuple[str, str, str]
    size: float
    margin: float
    shaders: tuple[ShaderSpec, ShaderSpec, ShaderSpec]
    hub: str  # material of the origin ball
    background: Vec3  # the world colour as the frame shows it: an axis fades toward it
    font: str | None = None  # label font file; None = Blender's built-in font


class Geometry(Protocol):
    """Everything that creates scene content. All methods are mandatory."""

    def ensure_material(self, name: str, spec: ShaderSpec) -> None: ...

    def add_atom(
        self,
        name: str,
        center: Vec3,
        radius: float,
        material: str,
        *,
        segments: int,
        ring_count: int,
    ) -> None: ...

    def add_atom_instances(
        self,
        name: str,
        centers: list[Vec3],
        radius: float,
        material: str,
        *,
        segments: int,
        ring_count: int,
    ) -> None: ...

    def add_cylinder(self, name: str, a: Vec3, b: Vec3, radius: float, material: str, *, outline: bool) -> None: ...

    def add_dot(self, name: str, center: Vec3, radius: float, material: str) -> None:
        """A small sphere with no outline (dotted bonds)."""

    def add_arrow(
        self,
        name: str,
        a: Vec3,
        b: Vec3,
        radius: float,
        material: str,
        *,
        head_radius_ratio: float,
        head_length_ratio: float,
    ) -> None: ...

    def add_cylinder_batch(
        self, name: str, pieces: list[tuple[Vec3, Vec3, float]], material: str, *, outline: bool
    ) -> None:
        """Many cylinders (a, b, radius) of one material as one object (large scenes)."""

    def add_dot_batch(self, name: str, dots: list[tuple[Vec3, float]], material: str) -> None:
        """Many outline-free dots (centre, radius) of one material as one object."""

    def add_arrow_batch(
        self,
        name: str,
        arrows: list[tuple[Vec3, Vec3, float]],
        material: str,
        *,
        head_radius_ratio: float,
        head_length_ratio: float,
    ) -> None:
        """Many outline-free arrows (a, b, radius) of one material as one object."""

    def add_mesh(
        self,
        name: str,
        vertices: list[Vec3],
        faces: list[tuple[int, int, int]],
        material: str,
        *,
        edge_material: str | None,
        edge_width: float,
        ghost: bool,
    ) -> None: ...

    def add_mesh_batch(
        self,
        name: str,
        parts: list[tuple[list[Vec3], list[tuple[int, int, int]]]],
        material: str,
        *,
        edge_material: str | None,
        edge_width: float,
        ghost: bool,
    ) -> None:
        """Many polyhedra (vertices, faces) of one material as one flat-shaded mesh (large scenes)."""


class Stage(Protocol):
    """Look, lighting, camera and output. All methods are mandatory."""

    def apply_look(self, look: Look) -> None: ...

    def remove_default_cube(self) -> None: ...

    def setup_soft_lighting(self, target: Vec3, extent: float, enabled: bool) -> None: ...

    def setup_backdrop(self, target: Vec3, extent: float, enabled: bool) -> None: ...

    def set_camera(self, camera: Camera, extent: float) -> None: ...

    def set_axes_overlay(self, axes: AxesSpec | None) -> None: ...

    def configure_renderer(self, quality: Quality) -> None: ...

    def render_still(self, filepath: str) -> None: ...

    def get_render_settings(self) -> dict[str, str | int]: ...


class SceneBackend(Geometry, Stage, Protocol):
    """The full backend contract the runner drives."""
