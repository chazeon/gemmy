"""Material resolution and element style lookup."""

from __future__ import annotations

from ..config import ElementStyle, SceneConfig
from ..scene import Color, MaterialStyle
from .sites import Site


def style_for(config: SceneConfig, site: Site) -> ElementStyle:
    for key in (site.label, site.element, "default"):
        if key in config.elements:
            return config.elements[key]
    return ElementStyle()


def is_hidden(style: ElementStyle) -> bool:
    return not style.visible or style.representation == "hidden"


def _variant_id(base_material: str, color: Color) -> str:
    return f"{base_material}_{color[0]:.4f}_{color[1]:.4f}_{color[2]:.4f}_{color[3]:.4f}".replace("-", "m").replace(
        ".", "p"
    )


def ghost_color(color: Color, opacity: float, saturation: float, value: float) -> Color:
    """Tinted glass: same hue, saturation scaled by `saturation`, brightness `value`, alpha `opacity`."""
    import colorsys

    h, s, _ = colorsys.rgb_to_hsv(color[0], color[1], color[2])
    r, g, b = colorsys.hsv_to_rgb(h, s * saturation, value)
    return (r, g, b, opacity)


class MaterialTable:
    """Config materials plus colour variants created on demand."""

    def __init__(self, base: dict[str, MaterialStyle]) -> None:
        self.materials: dict[str, MaterialStyle] = dict(base)
        self._variants: dict[tuple[str, Color], str] = {}

    def resolve(self, base_material: str, color: Color) -> str:
        key = (base_material, color)
        if key in self._variants:
            return self._variants[key]
        base = self.materials.get(base_material)
        if base is None:
            base = MaterialStyle()
            self.materials[base_material] = base
        if base.base_color == color and abs(base.alpha - color[3]) <= 1e-8:
            material_id = base_material
        else:
            candidate = _variant_id(base_material, color)
            suffix = 1
            while candidate in self.materials:
                candidate = f"{_variant_id(base_material, color)}_{suffix}"
                suffix += 1
            self.materials[candidate] = MaterialStyle(
                type=base.type,
                base_color=color,
                roughness=base.roughness,
                metallic=base.metallic,
                alpha=color[3],
            )
            material_id = candidate
        self._variants[key] = material_id
        return material_id


def visible_sites(config: SceneConfig, sites: list[Site]) -> list[Site]:
    """Sites that may get a sphere or arrow (hidden elements/labels are dropped)."""
    return [site for site in sites if not is_hidden(style_for(config, site))]
