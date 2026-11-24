"""Look presets, named camera views and camera framing: data, one registry entry each (stdlib only, no bpy).

Backend and builder never compare look names; they read fields of the resolved `Look`.
Add a look by adding one entry to LOOKS.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace

from ..geom import direction_from_angles

Vec3 = tuple[float, float, float]
Rgb = Vec3
LightSpec = tuple[str, tuple[float, float, float], float, float]  # name, direction, energy (W), size
# Sun lamp (parallel light): name, screen-relative direction (right, up, towards viewer), strength, casts shadow
SunSpec = tuple[str, tuple[float, float, float], float, bool]


@dataclass(frozen=True)
class Look:
    exposure: float = 0.0
    view_transform: str = "Standard"
    look: str = "None"
    world_color: Rgb = (1.0, 1.0, 1.0)
    world_strength: float = 1.0
    background: str = "world"  # "world" | "transparent"
    backdrop: bool = False
    lights: tuple[LightSpec, ...] = ()
    # Optional variants used when the background is transparent.
    exposure_transparent: float | None = None
    world_strength_transparent: float | None = None
    lights_transparent: tuple[LightSpec, ...] | None = None
    srgb_colors: bool = False  # treat config colours as sRGB (what you see in a colour picker)
    freestyle: bool = False  # outline pass
    outline_color: Rgb = (0.02, 0.02, 0.05)
    outline_width: float = 0.0022  # fraction of image height (3.5 px at 1600 px), so it scales with resolution
    cell_box: bool = False  # draw the display box edges unless overridden
    engine: str | None = None  # force an engine regardless of the requested one
    projection: str = "persp"  # default camera projection for this look
    view_direction: Vec3 | None = None  # default camera direction when none is given (None: the isometric view)
    # Toon shading (EEVEE): Diffuse -> Shader to RGB -> constant ColorRamp -> Emission. Bands are
    # (threshold, brightness) pairs on the lit value, ascending; brightness multiplies the base colour.
    toon_bands: tuple[tuple[float, float], ...] = ()
    suns: tuple[SunSpec, ...] = ()  # parallel lights placed relative to the camera
    shadow: float = 1.0  # 0 = no shadow tone, 1 = full darkening of the shaded bands
    shadow_softness: float = 3.0  # sun angular diameter in degrees (soft cast-shadow edge)
    atom_shadows: bool = True  # atoms cast shadows; False lets light through to the layers below
    polyhedron_shadows: bool = True  # solid polyhedra cast shadows (ghosts never do)
    axes: bool = False  # draw the axis indicator unless overridden
    axis_colors: tuple[Rgb, Rgb, Rgb] = ((0.80, 0.22, 0.20), (0.22, 0.62, 0.28), (0.22, 0.38, 0.80))


_SOFT_LIGHTS: tuple[LightSpec, ...] = (
    ("PBB_Key", (1.6, -1.6, 1.0), 1800.0, 8.0),
    ("PBB_Fill", (-1.5, -1.2, 0.7), 650.0, 10.0),
    ("PBB_Rim", (0.0, 2.0, 1.4), 1100.0, 7.5),
)

LOOKS: dict[str, Look] = {
    # Saturated, not washed out: Standard transform, neutral exposure, no backdrop, colours read as sRGB
    # (a linear reading turns 0.1 into a pale 0.35), white world.
    "default": Look(
        exposure=0.0,
        view_transform="Standard",
        world_strength=1.0,
        backdrop=False,
        srgb_colors=True,
        lights=_SOFT_LIGHTS,
    ),
    # The previous look: AgX, lifted exposure, dim world, grey backdrop wall and floor.
    "classic": Look(
        exposure=0.35,
        view_transform="AgX",
        world_strength=0.12,
        backdrop=True,
        lights=_SOFT_LIGHTS,
        exposure_transparent=0.45,
        world_strength_transparent=0.42,
        lights_transparent=(
            ("PBB_Key", (1.6, -1.6, 1.0), 1500.0, 12.5),
            ("PBB_Fill", (-1.5, -1.2, 0.7), 700.0, 14.0),
            ("PBB_Rim", (0.0, 2.0, 1.4), 1200.0, 11.0),
        ),
    ),
    # Flat saturated fills with two-tone toon shading, three parallel suns (key upper left), Freestyle outline,
    # the cell box and the abc axes, in a rotated orthographic view (EEVEE). Top-down: --camera.elevation 90.
    "3to2d": Look(
        exposure=0.0,
        view_transform="Standard",
        world_strength=0.4,
        backdrop=False,
        srgb_colors=True,
        freestyle=True,
        cell_box=True,
        engine="EEVEE",
        projection="ortho",
        view_direction=direction_from_angles(35.0, 28.0),
        toon_bands=((0.0, 0.72), (0.62, 1.0)),
        # Three-point, all parallel: the key casts the shadow, the fill lifts the dark side, the rim from
        # behind picks out edges. Only the key casts shadows, and atoms and polyhedra do not block it, so
        # objects are toon-shaded without dark patches from the layers above.
        suns=(
            ("PBB_SunKey", (-0.55, 0.6, 0.6), 3.0, True),
            ("PBB_SunFill", (0.7, -0.1, 0.7), 0.6, False),
            ("PBB_SunRim", (0.3, 0.5, -0.8), 1.5, False),
        ),
        atom_shadows=False,
        polyhedron_shadows=False,
        axes=True,
    ),
}


def get_look(name: str) -> Look:
    try:
        return LOOKS[name.lower().strip()]
    except KeyError:
        raise ValueError(f"unknown look {name!r}; choose from {', '.join(LOOKS)}") from None


def resolved_for_background(look: Look, transparent: bool) -> Look:
    """Collapse the transparent-variant fields into the primary ones."""
    if not transparent:
        return look
    return replace(
        look,
        exposure=look.exposure if look.exposure_transparent is None else look.exposure_transparent,
        world_strength=(
            look.world_strength if look.world_strength_transparent is None else look.world_strength_transparent
        ),
        lights=look.lights if look.lights_transparent is None else look.lights_transparent,
    )


# Named views are just viewing directions. Add a view by adding an entry.
VIEW_DIRECTIONS: dict[str, Vec3] = {
    "isometric": (1.0, -1.0, 0.75),
    "front": (0.0, -1.0, 0.0),
    "top": (0.0, 0.0, 1.0),
    "right": (1.0, 0.0, 0.0),
    "back": (0.0, 1.0, 0.0),
    "left": (-1.0, 0.0, 0.0),
    "bottom": (0.0, 0.0, -1.0),
    "isometric_111": (1.0, 1.0, 1.0),
}

DEFAULT_LENS = 70.0
LENS_CHOICES = (24.0, 35.0, 50.0, DEFAULT_LENS, 85.0)
"""The focal lengths the web viewer offers."""
SENSOR_WIDTH = 36.0
"""Camera sensor width in millimetres (Blender's default). With sensor fit AUTO it spans the LARGER image side."""

# Camera framing: distance = max(DISTANCE_FACTOR * extent, DISTANCE_MIN) / zoom, ortho frame width =
# max(ORTHO_FACTOR * extent, ORTHO_MIN) / zoom. The web viewer embeds these numbers.
DISTANCE_FACTOR = 2.2
DISTANCE_MIN = 4.0
ORTHO_FACTOR = 1.1
ORTHO_MIN = 3.0

# Axis indicator proportions (fractions of the triad size, which is `Axes.size` of the frame's shorter side).
AXES_ARROW_RADIUS = 0.037
AXES_LABEL_PAD = 0.15  # gap from arrow tip to label centre
AXES_LABEL_SIZE = 0.5  # label font size
AXES_LABEL_REACH = 2.2  # labels sit this many arrow radii beyond the tip
AXES_HEAD_RADIUS_RATIO = 2.2  # arrow head radius over shaft radius
AXES_HEAD_LENGTH_RATIO = 0.22  # arrow head length over arrow length


def camera_distance(extent: float, zoom: float) -> float:
    """Perspective distance; zoom > 1 moves closer."""
    return max(DISTANCE_FACTOR * extent, DISTANCE_MIN) / zoom


def ortho_scale(extent: float, zoom: float) -> float:
    """Orthographic frame width for a scene of size `extent` (bounding diagonal); zoom > 1 shows less."""
    return max(ORTHO_FACTOR * extent, ORTHO_MIN) / zoom


# Axis labels are set like math variables, in a sans italic with a single-storey a: Source Sans 3 (SIL OFL 1.1),
# subset to "abc" and renamed "Gemmy Axis Labels" as the licence asks for a modified font (fonts/OFL.txt). The web
# viewer embeds the same bold face, so both draw the same glyphs.
_FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
LABEL_FONT_CANDIDATES = (os.path.join(_FONTS, "GemmyAxisLabels-Italic.ttf"),)
BOLD_LABEL_FONT_CANDIDATES = (os.path.join(_FONTS, "GemmyAxisLabels-BoldItalic.ttf"),)


def label_font(explicit: str | None, candidates: tuple[str, ...] = LABEL_FONT_CANDIDATES) -> str | None:
    """Font file for axis labels: `explicit` if given (must exist), else the first candidate found, else None
    (Blender's built-in font)."""
    if explicit is not None:
        if not os.path.isfile(explicit):
            raise FileNotFoundError(f"axes.font: no such font file: {explicit}")
        return explicit
    return next((path for path in candidates if os.path.isfile(path)), None)
