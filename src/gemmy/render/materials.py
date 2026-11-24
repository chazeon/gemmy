"""Pure resolution of a scene material into concrete shader parameters (no bpy)."""

from __future__ import annotations

from dataclasses import dataclass, replace

from ..scene import Color, MaterialStyle
from ..settings import PolyhedronStyle


@dataclass(frozen=True)
class ShaderSpec:
    base_color: Color
    roughness: float
    metallic: float
    alpha: float  # Principled alpha input; 1.0 for solids and for transmissive shells
    transmission: float = 0.0
    ior: float = 1.45
    specular: float | None = None  # None keeps the Blender default
    absorption_density: float = 0.0
    hashed: bool = False  # alpha < 1 rendered through hashed blending
    emission: float = 0.0  # >0: flat fill, emission colour = base colour, no shading
    bands: tuple[tuple[float, float], ...] = ()  # toon shading: (threshold, brightness) on the lit value
    blended: bool = False  # toon fill mixed with a transparent BSDF by `alpha`: see-through, casts no shadow


def _clamp(value: float, lo: float, hi: float) -> float:
    return min(max(value, lo), hi)


def _linear(color: Color) -> Color:
    def f(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (f(color[0]), f(color[1]), f(color[2]), color[3])


def _resolve(
    style: MaterialStyle,
    *,
    polyhedron: PolyhedronStyle | None = None,
    matte: bool = False,
) -> ShaderSpec:
    """`polyhedron` is given only for materials used by polyhedra.

    Opacity comes from the override, else the material alpha. Fully opaque gives a solid shader;
    below that the shell transmits (1 - opacity) so atoms and bonds inside stay visible.
    """
    if polyhedron is not None:
        opacity = style.alpha if polyhedron.opacity is None else polyhedron.opacity
        if polyhedron.transmission is not None:
            transmission = polyhedron.transmission
        else:
            transmission = 0.0 if opacity >= 0.999 else _clamp(1.0 - opacity, 0.0, 0.95)
        roughness = polyhedron.roughness
        if roughness is None:
            roughness = _clamp(style.roughness, 0.28, 0.48) if transmission > 0 else style.roughness
        return ShaderSpec(
            base_color=style.base_color,
            roughness=roughness,
            metallic=style.metallic,
            alpha=1.0,
            transmission=transmission,
            ior=polyhedron.ior,
            specular=0.0 if transmission > 0 else None,
            absorption_density=polyhedron.absorption,
            emission=1.0 if matte and transmission == 0.0 else 0.0,
        )
    if matte:  # flat look: emission-only fill
        return ShaderSpec(
            base_color=style.base_color,
            roughness=1.0,
            metallic=0.0,
            alpha=style.alpha,
            specular=0.0,
            hashed=style.alpha < 1.0,
            emission=1.0,
        )
    return ShaderSpec(
        base_color=style.base_color,
        roughness=style.roughness,
        metallic=style.metallic,
        alpha=style.alpha,
        hashed=style.alpha < 1.0,
    )


def resolve_shader(
    style: MaterialStyle,
    *,
    polyhedron: PolyhedronStyle | None = None,
    matte: bool = False,
    srgb: bool = False,
    bands: tuple[tuple[float, float], ...] = (),
) -> ShaderSpec:
    """`bands` (toon shading) apply to solid shaders; transmissive and flat ones keep their own.

    A translucent polyhedron in a toon look is not transmissive: it keeps the toon fill and is blended
    with transparency by its opacity (unless the style sets `transmission` explicitly).
    """
    spec = _resolve(style, polyhedron=polyhedron, matte=matte)
    if bands and polyhedron is not None and polyhedron.transmission is None and spec.transmission > 0.0 and not matte:
        opacity = style.alpha if polyhedron.opacity is None else polyhedron.opacity
        spec = replace(
            spec, transmission=0.0, specular=None, alpha=opacity, absorption_density=0.0, blended=True, bands=bands
        )
    if bands and spec.emission == 0.0 and spec.transmission == 0.0 and not spec.hashed:
        spec = replace(spec, bands=bands)
    if not srgb:
        return spec
    return replace(spec, base_color=_linear(spec.base_color))


def shade_bands(bands: tuple[tuple[float, float], ...], shadow: float) -> tuple[tuple[float, float], ...]:
    """Scale how dark the shaded bands are: shadow 1 keeps them, 0 turns every band into the lit colour."""
    return tuple((threshold, 1.0 - (1.0 - brightness) * shadow) for threshold, brightness in bands)
