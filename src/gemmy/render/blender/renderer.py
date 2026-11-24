"""Renderer configuration and still output."""

from __future__ import annotations

import warnings
from collections.abc import Iterable
from typing import NamedTuple

from ...settings import Quality

GPU_BACKENDS = ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI")


class DeviceChoice(NamedTuple):
    device: str  # "CPU" or "GPU" for scene.cycles.device
    compute_type: str | None  # value for compute_device_type, None to leave unchanged
    use_gpu_devices: bool  # enable every non-CPU device when True


def choose_device(requested: str, backend_keys: Iterable[str], device_types: Iterable[str]) -> DeviceChoice:
    """Pick the Cycles device.

    `backend_keys`: compute_device_type enum identifiers Blender offers.
    `device_types`: `type` of every device Cycles reports (e.g. "CPU", "METAL").
    AUTO and GPU use a GPU when a backend is offered and a non-CPU device exists, else CPU.
    """
    requested = requested.upper()
    if requested not in ("AUTO", "CPU", "GPU"):
        raise ValueError(f"Unsupported device: {requested}")
    if requested == "CPU":
        return DeviceChoice("CPU", None, False)
    keys = list(backend_keys)
    gpu_types = {t for t in device_types if t != "CPU"}
    for name in GPU_BACKENDS:
        if name in keys and name in gpu_types:
            return DeviceChoice("GPU", name, True)
    return DeviceChoice("CPU", None, False)


# EEVEE was BLENDER_EEVEE until 4.1, BLENDER_EEVEE_NEXT in 4.2-4.5, and BLENDER_EEVEE again in 5.x.
_CANDIDATES = {
    "CYCLES": ("CYCLES",),
    "EEVEE": ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"),
    "WORKBENCH": ("BLENDER_WORKBENCH",),
}


def engine_candidates(name: str) -> tuple[str, ...]:
    try:
        return _CANDIDATES[name.upper()]
    except KeyError:
        raise ValueError(f"Unsupported engine: {name}") from None


def pick_engine_id(name: str, accepts) -> str:
    """Return the first candidate for which `accepts(identifier)` is true."""
    for candidate in engine_candidates(name):
        if accepts(candidate):
            return candidate
    raise ValueError(f"Engine {name} is not available in this Blender (tried {', '.join(engine_candidates(name))})")


GHOST_OUTLINE_LIGHTEN = 0.6  # ghost polyhedra: outline colour mixed this far toward white
GHOST_OUTLINE_THICKNESS = 0.5  # and this fraction of the normal width


class RendererMixin:
    def configure_renderer(self, quality: Quality) -> None:
        """Configure engine, look, sampling, device and output size. Call once before rendering."""
        bpy = self._bpy
        scene = bpy.context.scene
        samples, device = quality.samples, quality.device
        transparent_background = self._transparent_background
        look = self._look
        engine_norm = (look.engine or quality.engine).upper()

        def accepts(identifier: str) -> bool:
            try:
                scene.render.engine = identifier
            except TypeError:
                return False
            return True

        pick_engine_id(engine_norm, accepts)
        scene.render.image_settings.file_format = quality.image_format
        scene.render.resolution_x, scene.render.resolution_y = quality.resolution
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = bool(transparent_background)

        view = scene.view_settings
        view.view_transform = self._enum_or_default(view, "view_transform", look.view_transform)
        view.look = self._enum_or_default(view, "look", look.look)
        view.exposure = look.exposure
        view.gamma = 1.0

        scene.render.use_freestyle = look.freestyle
        for layer in scene.view_layers:
            layer.use_freestyle = look.freestyle
            if look.freestyle:
                self._configure_outline(layer, quality.resolution[1])

        if engine_norm == "EEVEE":
            if hasattr(scene, "eevee"):
                eevee_settings = scene.eevee
                sample_count = max(1, int(samples))
                for attr in ("taa_render_samples", "taa_samples"):
                    if hasattr(eevee_settings, attr):
                        setattr(eevee_settings, attr, sample_count)
                for attr in ("use_raytracing", "use_taa_reprojection"):
                    if hasattr(eevee_settings, attr):
                        setattr(eevee_settings, attr, True)
            return

        if engine_norm != "CYCLES":
            return

        scene.cycles.samples = int(samples)
        if hasattr(scene.cycles, "use_adaptive_sampling"):
            scene.cycles.use_adaptive_sampling = True
        if hasattr(scene.cycles, "use_denoising"):
            scene.cycles.use_denoising = True
        requested = device.upper()
        if requested == "CPU":
            scene.cycles.device = "CPU"
            return
        if requested not in ("AUTO", "GPU"):
            raise ValueError(f"Unsupported device: {device}")

        cycles_addon = bpy.context.preferences.addons.get("cycles")
        if cycles_addon is None:
            scene.cycles.device = "CPU"
            return
        cprefs = cycles_addon.preferences
        # enum_items can be empty in background mode, and a device is only listed after its backend is
        # selected, so probe each backend in preference order (assignment fails for unsupported ones).
        choice = DeviceChoice("CPU", None, False)
        for name in GPU_BACKENDS:
            try:
                cprefs.compute_device_type = name
                cprefs.get_devices()
            except Exception:
                continue
            choice = choose_device(requested, [name], [d.type for d in getattr(cprefs, "devices", [])])
            if choice.compute_type == name:
                break
        if choice.use_gpu_devices:
            for dev in getattr(cprefs, "devices", []):
                dev.use = dev.type != "CPU"
        scene.cycles.device = choice.device

    def _configure_outline(self, layer, image_height: int) -> None:
        """Freestyle outline: colour and thickness (relative to image height); arrows are not outlined.

        Two line sets share one style. Blender has no intersection edge type, so the edge types are listed
        explicitly (silhouette, border, crease; contour, material boundary and the rest stay off). The
        main set draws visible lines. Visible-only lines break the outline of a sphere that a polyhedron
        face cuts into (true-size polyhedra), so atoms get a second set that also keeps lines hidden
        behind a single surface (quantitative invisibility 0..1): the vertex spheres stay whole, while
        atoms behind a whole polyhedron or another atom (two or more surfaces) stay hidden.
        """
        settings = layer.freestyle_settings
        while len(settings.linesets):
            settings.linesets.remove(settings.linesets[0])
        style = self._bpy.data.linestyles.get("PBB_Outline") or self._bpy.data.linestyles.new("PBB_Outline")
        style.color = self._look.outline_color
        style.thickness = max(0.1, self._look.outline_width * image_height)

        def lineset(name: str, linestyle=style):
            ls = settings.linesets.new(name)
            ls.linestyle = linestyle
            ls.select_by_visibility = True
            ls.select_by_edge_types = True
            ls.select_by_image_border = True
            ls.visibility = "VISIBLE"
            for kind in ("silhouette", "border", "crease"):
                setattr(ls, f"select_{kind}", True)
            for kind in ("contour", "external_contour", "material_boundary", "edge_mark", "ridge_valley"):
                setattr(ls, f"select_{kind}", False)
            ls.select_suggestive_contour = False
            return ls

        main = lineset("PBB_Outline")
        outline_free = self._outline_free_collection()
        if len(outline_free.objects):
            main.select_by_collection = True
            main.collection = outline_free
            main.collection_negation = "EXCLUSIVE"  # outline everything except this collection
        if len(self._atom_collection().objects):  # an empty line set makes Freestyle report an error
            atoms = lineset("PBB_AtomOutline")
            atoms.visibility = "RANGE"
            atoms.qi_start, atoms.qi_end = 0, 1
            atoms.select_by_collection = True
            atoms.collection = self._atom_collection()
            atoms.collection_negation = "INCLUSIVE"

        if len(self._ghost_collection().objects):  # see-through polyhedra: thinner, lighter lines
            faint = self._bpy.data.linestyles.get("PBB_GhostOutline") or self._bpy.data.linestyles.new(
                "PBB_GhostOutline"
            )
            faint.color = tuple(c + (1.0 - c) * GHOST_OUTLINE_LIGHTEN for c in self._look.outline_color)
            faint.thickness = style.thickness * GHOST_OUTLINE_THICKNESS
            ghosts = lineset("PBB_GhostOutline", faint)
            ghosts.select_by_collection = True
            ghosts.collection = self._ghost_collection()
            ghosts.collection_negation = "INCLUSIVE"

    @staticmethod
    def _enum_or_default(owner, prop: str, wanted: str) -> str:
        """Return `wanted` if the enum has it, else the current value (names differ across versions)."""
        # Dynamic enums (OCIO) are not listed in bl_rna, so try the assignment.
        try:
            setattr(owner, prop, wanted)
        except TypeError:
            warnings.warn(
                f"{prop} {wanted!r} not available in this Blender; keeping {getattr(owner, prop)!r}.",
                stacklevel=2,
            )
        return getattr(owner, prop)

    def get_render_settings(self) -> dict[str, str | int]:
        bpy = self._bpy
        scene = bpy.context.scene
        settings: dict[str, str | int] = {
            "engine": str(scene.render.engine),
            "resolution_x": int(scene.render.resolution_x),
            "resolution_y": int(scene.render.resolution_y),
        }
        if scene.render.engine == "CYCLES":
            settings["device"] = str(scene.cycles.device)
            settings["samples"] = int(scene.cycles.samples)
        else:
            settings["device"] = "N/A"
            settings["samples"] = 0
        return settings

    def render_still(self, filepath: str) -> None:
        bpy = self._bpy
        bpy.context.scene.render.filepath = filepath
        self._update_axes_overlay_transform()
        bpy.ops.render.render(write_still=True)
