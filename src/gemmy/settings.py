"""Render settings and the resolved render plan: plain frozen dataclasses, one definition each.

`RenderSettings` is what the user writes (JSON file and CLI flags). `RenderSettings.resolve` applies the
look preset and overrides and returns a `RenderPlan`, which is written as JSON and read back inside
Blender (`load_plan`). The sub-structures shared by both (`Quality`, `Axes`, `PolyhedronStyle`,
`ArrowStyle`) are defined once. The outer process validates settings with `pydantic.TypeAdapter`
(`gemmy.config.validate_settings`); this module never imports pydantic. Field `metadata` carries the
numeric bounds (`gt`, `ge`, `lt`, `le`, checked by `check_settings`). The CLI (`cli_args.py`) is generated from these
dataclasses by tyro; attribute docstrings become the `--help` text.
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from .geom import direction_from_angles
from .render.looks import (
    BOLD_LABEL_FONT_CANDIDATES,
    DEFAULT_LENS,
    LABEL_FONT_CANDIDATES,
    VIEW_DIRECTIONS,
    Look,
    get_look,
    label_font,
    resolved_for_background,
)
from .scene import Color, Strict, Vec3, from_dict


def opt(default: Any, **meta: Any) -> Any:
    """A dataclass field with metadata (numeric bounds)."""
    return field(default=default, metadata=meta)


# ---- structures shared by settings and plan -------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Quality(Strict):
    samples: int = opt(128, ge=1)
    resolution: tuple[int, int] = opt((1920, 1920))
    engine: Literal["CYCLES", "EEVEE", "WORKBENCH"] = "CYCLES"
    device: Literal["AUTO", "CPU", "GPU"] = "AUTO"
    sphere_segments: int = opt(64, ge=3)
    sphere_rings: int = opt(32, ge=3)
    instancing_threshold: int = opt(2000, ge=0)
    """Above this count, big scenes are batched: atoms use Geometry Nodes instancing; bond, dash, dot and arrow
    pieces (counted together) and polyhedra (counted alone) are merged into one mesh per material. Below it
    every atom, bond piece and polyhedron is its own object, so each can be recoloured by hand."""
    image_format: Literal["PNG", "JPEG", "TIFF"] = "PNG"


@dataclass(frozen=True, slots=True)
class Axes(Strict):
    """XYZ triad drawn in a corner of the frame."""

    enabled: bool | None = None
    """Default: the look's setting."""
    kind: Literal["abc", "xyz"] = "abc"
    """abc: the lattice vectors of the display box; xyz: the Cartesian axes."""
    size: float = opt(0.11, gt=0.0)
    margin: float = opt(0.14, ge=0.0, lt=0.5)
    font: str | None = None
    """Font file for the labels (any TTF or OTF, e.g. a serif italic). Default: the bundled Source Sans 3 italic."""
    bold: bool = True
    """Bold labels (when `font` is not given)."""


@dataclass(frozen=True, slots=True)
class PolyhedronStyle(Strict):
    """Polyhedron overrides. `None` means: derive from the scene material."""

    transmission: float | None = opt(None, ge=0.0, le=1.0)
    opacity: float | None = opt(None, ge=0.0, le=1.0)
    roughness: float | None = opt(None, ge=0.0, le=1.0)
    ior: float = opt(1.05, ge=1.0)
    absorption: float = opt(0.0, ge=0.0)
    edge_color: Color | None = None
    edge_width: float = opt(0.05, gt=0.0)
    scale: float = opt(1.0, gt=0.0, le=1.0)
    """Shrink about the centroid, e.g. 0.85 (1.0 = true size)."""


@dataclass(frozen=True, slots=True)
class ArrowStyle(Strict):
    """Displacement arrows. `radius=None` keeps the radius stored in the scene."""

    radius: float | None = opt(0.05, gt=0.0)
    color: Color | None = (0.04, 0.04, 0.05, 1.0)
    head_radius_ratio: float = opt(2.8, gt=0.0)
    head_length_ratio: float = opt(0.6, gt=0.0, lt=1.0)  # long head, short tail; total length = displacement


# ---- what the user writes ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class LookSettings(Strict):
    """Preset name plus optional overrides; `None` keeps the preset's value."""

    preset: str = "default"
    """One of: default, classic, 3to2d."""
    exposure: float | None = None
    view_transform: str | None = None
    world_strength: float | None = opt(None, ge=0.0)
    background: Literal["world", "transparent"] | None = None
    backdrop: bool | None = None
    outline_color: tuple[float, float, float] | None = None
    outline_width: float | None = opt(None, gt=0.0)
    """Fraction of image height."""
    shadow: float | None = opt(None, ge=0.0, le=1.0)
    """Toon looks: strength of the shaded tone and cast shadows (0 = none)."""
    shadow_softness: float | None = opt(None, ge=0.0, le=30.0)
    """Toon looks: sun angular diameter in degrees (softer shadow edges when larger)."""
    atom_shadows: bool | None = None
    """Atoms cast shadows. False: they are still shaded but do not darken the atoms and polyhedra below."""
    polyhedron_shadows: bool | None = None
    """Solid polyhedra cast shadows. False: no cast shadows from polyhedra; their faces stay toon-shaded."""
    axis_colors: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]] | None = None
    """Colours of the a/x, b/y, c/z axis arrows and labels (sRGB)."""


@dataclass(frozen=True, slots=True)
class CellBoxSettings(Strict):
    """Edges of the display box (`cells.box` of the supercell). `None` takes the look preset's value."""

    show: bool | None = None
    """Draw the box (default: the look's setting)."""
    color: Color | None = None
    """Default: the look's outline colour."""
    width: float | None = opt(None, gt=0.0)
    """Line width, fraction of image height (default: the look's outline width)."""


@dataclass(frozen=True, slots=True)
class CameraSettings(Strict):
    """Camera: a named view (RenderSettings.views) or an explicit direction / azimuth+elevation."""

    direction: Vec3 | None = None
    azimuth: float | None = None
    """Degrees from +x towards +y."""
    elevation: float | None = opt(None, ge=-90.0, le=90.0)
    projection: Literal["persp", "ortho"] | None = None
    zoom: float = opt(1.0, gt=0.0)
    """Greater than 1: closer / smaller frame."""
    target: Vec3 | None = None
    """Scene coordinates."""
    lens: float = opt(DEFAULT_LENS, gt=0.0)
    """Millimetres, perspective only."""
    up: Vec3 | None = None
    """World direction that points up on screen (default: +z, or +y when looking along z). Sets the in-plane spin."""

    def explicit_direction(self) -> Vec3 | None:
        if self.direction is not None:
            return self.direction
        if self.azimuth is not None and self.elevation is not None:
            return direction_from_angles(self.azimuth, self.elevation)
        return None


@dataclass(frozen=True, slots=True)
class RenderSettings(Strict):
    look: LookSettings = LookSettings()
    quality: Quality = Quality()
    axes: Axes = Axes()
    polyhedron: PolyhedronStyle = PolyhedronStyle()
    arrows: ArrowStyle = ArrowStyle()
    cell_box: CellBoxSettings = CellBoxSettings()
    soft_lighting: bool = True
    remove_default_cube: bool = True
    camera: CameraSettings = CameraSettings()
    views: tuple[str, ...] | None = None
    """Named views to render, one image each."""
    out_dir: str | None = None
    """Render here as <view>.<ext>."""
    out: str | None = None
    """Output image path (single image)."""

    def resolve(self, scene_path: str) -> RenderPlan:
        """Apply the look preset and overrides; scene and output paths become absolute (Blender
        resolves relative paths against its own working directory)."""
        spec = self.look
        base = get_look(spec.preset)
        transparent = (spec.background or base.background) == "transparent"
        look = dataclasses.replace(
            resolved_for_background(base, transparent),
            exposure_transparent=None,
            world_strength_transparent=None,
            lights_transparent=None,
            background="transparent" if transparent else "world",
        )
        overrides = {
            f.name: getattr(spec, f.name)
            for f in dataclasses.fields(spec)
            if f.name not in ("preset", "background") and getattr(spec, f.name) is not None
        }
        look = dataclasses.replace(look, **overrides)
        box = self.cell_box
        cell_box = CellBoxStyle(
            show=look.cell_box if box.show is None else box.show,
            color=box.color if box.color is not None else (*look.outline_color, 1.0),
            width=look.outline_width if box.width is None else box.width,
        )
        return RenderPlan(
            scene=str(Path(scene_path).resolve()),
            look=look,
            quality=self.quality,
            axes=dataclasses.replace(
                self.axes,
                enabled=look.axes if self.axes.enabled is None else self.axes.enabled,
                font=label_font(
                    self.axes.font, BOLD_LABEL_FONT_CANDIDATES if self.axes.bold else LABEL_FONT_CANDIDATES
                ),
            ),
            polyhedron=self.polyhedron,
            arrows=self.arrows,
            cell_box=cell_box,
            soft_lighting=self.soft_lighting,
            remove_default_cube=self.remove_default_cube,
            shots=self._shots(look),
        )

    def _shots(self, look: Look) -> tuple[Shot, ...]:
        cam = self.camera
        look_projection = look.projection
        custom = cam.explicit_direction()
        if custom is not None:
            named = [("custom", custom)]
        elif self.views is None and look.view_direction is not None:
            named = [("view", look.view_direction)]
        else:
            named = [(v, VIEW_DIRECTIONS[v]) for v in self.views or ("isometric",)]
        ext = self.quality.image_format.lower()
        shots = []
        for name, direction in named:
            if self.out is not None:
                output = str(Path(self.out).resolve())
            elif self.out_dir is not None:
                output = str((Path(self.out_dir) / f"{name}.{ext}").resolve())
            else:
                output = None
            camera = Camera(direction, cam.projection or look_projection, cam.zoom, cam.target, cam.lens, cam.up)
            shots.append(Shot(name, camera, output))
        return tuple(shots)


# ---- what the Blender side reads --------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CellBoxStyle:
    show: bool
    color: Color
    width: float  # fraction of image height


@dataclass(frozen=True, slots=True)
class Camera:
    direction: Vec3  # from the target towards the camera, not necessarily normalised
    projection: str  # "persp" | "ortho"
    zoom: float
    target: Vec3 | None  # scene coordinates; None = centre of the structure
    lens: float
    up: Vec3 | None = None  # world direction shown up on screen; None = geom.default_up


@dataclass(frozen=True, slots=True)
class Shot:
    """One image: a name, a camera and where to write it (None = build only)."""

    name: str
    camera: Camera
    output: str | None


@dataclass(frozen=True, slots=True)
class RenderPlan:
    """Everything the Blender side needs, fully resolved."""

    scene: str
    look: Look
    quality: Quality
    axes: Axes
    polyhedron: PolyhedronStyle
    arrows: ArrowStyle
    cell_box: CellBoxStyle
    soft_lighting: bool
    remove_default_cube: bool
    shots: tuple[Shot, ...]


def load_plan(path: str | Path) -> RenderPlan:
    return from_dict(RenderPlan, json.loads(Path(path).read_text(encoding="utf-8")))


# ---- validation that pydantic cannot express on plain dataclasses -------------------------------------

_RGB_FIELDS = (("polyhedron", "edge_color"), ("arrows", "color"), ("cell_box", "color"))


def add_alpha(raw: dict[str, Any]) -> dict[str, Any]:
    """Settings accept RGB or RGBA colours; give RGB an alpha of 1.0 (before validation)."""
    out = dict(raw)
    for section, key in _RGB_FIELDS:
        sub = out.get(section)
        if isinstance(sub, dict) and isinstance(sub.get(key), (list, tuple)) and len(sub[key]) == 3:
            out[section] = {**sub, key: (*sub[key], 1.0)}
    return out


def _check_bounds(obj: Any, path: str) -> None:
    for f in dataclasses.fields(obj):
        value = getattr(obj, f.name)
        where = f"{path}{f.name}"
        if dataclasses.is_dataclass(value):
            _check_bounds(value, where + ".")
        elif value is not None:
            meta = f.metadata
            for key, ok, text in (
                ("gt", lambda v, b: v > b, ">"),
                ("ge", lambda v, b: v >= b, ">="),
                ("lt", lambda v, b: v < b, "<"),
                ("le", lambda v, b: v <= b, "<="),
            ):
                if key in meta and not ok(value, meta[key]):
                    raise ValueError(f"{where}: must be {text} {meta[key]}, got {value}")


def check_settings(s: RenderSettings) -> None:
    """Bounds, known names and cross-field rules; raises ValueError naming the setting."""
    _check_bounds(s, "")
    get_look(s.look.preset)  # raises ValueError listing the choices
    if min(s.quality.resolution) <= 0:
        raise ValueError("quality.resolution: width/height must be > 0")
    cam = s.camera
    if (cam.azimuth is None) != (cam.elevation is None):
        raise ValueError("camera: azimuth and elevation must be given together")
    if cam.direction is not None and cam.azimuth is not None:
        raise ValueError("camera: give either direction or azimuth/elevation, not both")
    if cam.direction is not None and not any(cam.direction):
        raise ValueError("camera.direction: must not be the zero vector")
    if s.views is not None:
        if not s.views:
            raise ValueError("views: must include at least one view")
        bad = [v for v in s.views if v not in VIEW_DIRECTIONS]
        if bad:
            raise ValueError(f"views: unsupported {', '.join(bad)}; choose from {', '.join(VIEW_DIRECTIONS)}")
    if cam.explicit_direction() is not None and s.views is not None:
        raise ValueError("views cannot be combined with an explicit camera direction")
    if s.out is not None and s.out_dir is not None:
        raise ValueError("give either out or out_dir, not both")
    if s.out is not None and s.views is not None and len(s.views) > 1:
        raise ValueError("out names a single image; use out_dir for several views")
