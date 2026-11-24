"""Blender implementation of the scene backend, split by concern (one mixin per module)."""

from __future__ import annotations

from ..looks import Look, get_look
from .atoms import AtomsMixin
from .materials import MaterialsMixin
from .overlay import AxesOverlayMixin
from .primitives import PrimitivesMixin
from .renderer import RendererMixin
from .world import WorldMixin


class BlenderBackend(
    AtomsMixin,
    AxesOverlayMixin,
    MaterialsMixin,
    PrimitivesMixin,
    WorldMixin,
    RendererMixin,
):
    def __init__(self, collection_name: str = "POSCAR_Model") -> None:
        try:
            import bpy  # type: ignore
            import mathutils  # type: ignore
        except ImportError as exc:
            raise RuntimeError("Blender backend requires bpy, run this inside Blender.") from exc
        self._bpy = bpy
        self._mathutils = mathutils
        self._collection = self._ensure_collection(collection_name)
        self._look = get_look("default")
        self._transparent_background = False
        self._lighting_enabled = True
        self._axes = None
        self._atom_mesh_cache: dict[tuple[float, int, int], object] = {}
        self._unit_mesh_cache: dict[str, object] = {}
        self._sphere_mesh_cache: dict[tuple[float, int, int, str], object] = {}
        self._sphere_prototype_cache: dict[tuple[float, int, int, str], object] = {}
        self._sphere_instancer_group_cache: dict[tuple[float, int, int, str], object] = {}

    def apply_look(self, look: Look) -> None:
        """Select the look (data) and push its world settings into the scene."""
        self._look = look
        self._transparent_background = look.background == "transparent"
        self._apply_world()
