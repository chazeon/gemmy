"""Everything the outer process validates with pydantic: the compile config (user-written, never enters
Blender; JSON aliases and RGB coercion) and, through TypeAdapter on the plain dataclasses, the scene
document and the render settings. JSON keys differ from field names via aliases."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, TypeAdapter, field_validator

from .datafile import read_data
from .scene import BondStyle, Color, MaterialStyle, SceneDocument, check_references
from .settings import RenderSettings, add_alpha, check_settings

_SCENE = TypeAdapter(SceneDocument)
_SETTINGS = TypeAdapter(RenderSettings)


class Frozen(BaseModel):
    """Base of the config models: unknown keys are errors, instances are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


def coerce_color(value: Any) -> Any:
    """Accept RGB (3 values) or RGBA (4 values); RGB gets alpha 1.0."""
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return (*value, 1.0)
    return value


DEFAULT_MATERIALS: dict[str, MaterialStyle] = {
    "matte": MaterialStyle(roughness=0.6),
    "bond": MaterialStyle(base_color=(0.7, 0.7, 0.7, 1.0)),
    "polyhedron": MaterialStyle(base_color=(0.2, 0.6, 1.0, 0.25), roughness=0.2, alpha=0.25),
    "metal": MaterialStyle(roughness=0.15, metallic=0.9),
    "glass": MaterialStyle(roughness=0.05, alpha=0.2),
}


class _Colored(Frozen):
    @field_validator("color", mode="before", check_fields=False)
    @classmethod
    def _rgb(cls, value: Any) -> Any:
        return coerce_color(value)


class ElementStyle(_Colored):
    visible: bool = True
    representation: str = "sphere"
    radius: float = 0.35
    color: Color = (0.8, 0.8, 0.8, 1.0)
    material: str = "matte"


class BondRule(_Colored):
    a: str
    b: str
    min_distance: float = Field(validation_alias=AliasChoices("min", "min_distance"), serialization_alias="min")
    max_distance: float = Field(validation_alias=AliasChoices("max", "max_distance"), serialization_alias="max")
    radius: float = 0.08
    color: Color = (0.7, 0.7, 0.7, 1.0)
    material: str = "bond"
    visible: bool = True
    style: BondStyle = "solid"  # dashed or dotted, e.g. for hydrogen bonds
    # none: add no atom for this bond. It is still drawn between two atoms that are shown.
    # ends: also show an end that falls outside the box (one hop).
    # polyhedra: ends, plus complete this bond for atoms pulled in as polyhedron ligands (one more hop).
    # Every mode draws the bond once both ends are shown (the bond-closing stage).
    complete: Literal["none", "ends", "polyhedra"] = "ends"

    def matches(self, e1: str, e2: str) -> bool:
        return (e1 == self.a and e2 == self.b) or (e1 == self.b and e2 == self.a)


class PolyhedronRule(_Colored):
    center: str
    ligands: frozenset[str] = Field(min_length=1)
    min_distance: float = Field(validation_alias=AliasChoices("min", "min_distance"), serialization_alias="min")
    max_distance: float = Field(validation_alias=AliasChoices("max", "max_distance"), serialization_alias="max")
    min_coordination: int = 4
    max_coordination: int | None = None
    visible: bool = True
    color: Color = (0.2, 0.6, 1.0, 0.25)
    material: str = "polyhedron"
    name: str | None = None
    # Reserved for animation (several frames). locked: faces computed once, only corners move per frame;
    # adaptive: faces recomputed every frame (coordination may change). Scenes are one frame today, so both
    # give the same result.
    topology_mode: str = "topology_locked"
    # Also build this polyhedron for centres that are boundary images (e.g. the 8 corner copies).
    image_centers: bool = False

    @field_validator("topology_mode", mode="before")
    @classmethod
    def _mode(cls, value: Any) -> Any:
        mode = str(value).lower()
        if mode not in {"topology_locked", "topology_adaptive"}:
            raise ValueError("topology_mode must be topology_locked or topology_adaptive.")
        return mode


class CellConfig(Frozen):
    supercell: tuple[int, int, int] = (1, 1, 1)
    periodic: tuple[bool, bool, bool] = (False, False, False)
    cartesian_limits: dict[str, tuple[float, float]] | None = Field(
        default=None, validation_alias=AliasChoices("limits", "cartesian_limits"), serialization_alias="limits"
    )

    @field_validator("cartesian_limits")
    @classmethod
    def _axes(cls, value: dict[str, tuple[float, float]] | None) -> dict[str, tuple[float, float]] | None:
        bad = sorted(set(value or {}) - {"x", "y", "z"})
        if bad:
            raise ValueError(f"limits axes must be x, y or z; got {bad}.")
        return value

    # Tolerance (fractional units) for wrapping (0.99999 -> 0) and for the inclusive display box.
    eps: float = Field(default=1e-4, ge=0)
    # Display box in fractional coordinates of the supercell, per axis; missing axes default to [0, 1].
    # Atoms on a box face, edge or corner are shown on every equivalent boundary (2, 4 or 8 copies).
    box: dict[str, tuple[float, float]] = Field(default_factory=dict)

    @field_validator("box")
    @classmethod
    def _box_axes(cls, value: dict[str, tuple[float, float]]) -> dict[str, tuple[float, float]]:
        bad = sorted(set(value) - {"x", "y", "z"})
        if bad:
            raise ValueError(f"box axes must be x, y or z; got {bad}.")
        if any(lo > hi for lo, hi in value.values()):
            raise ValueError("box ranges must be [low, high] with low <= high.")
        return value


class DisplacementConfig(Frozen):
    enabled: bool = False
    style: str = "arrow"
    scale: float = 1.0
    data_file: str | None = None
    # Draw arrows on hidden atoms too, e.g. O hidden behind polyhedron corners.
    include_hidden: bool = False
    # Only the corners of these polyhedra, e.g. one FeO6: a supercell index, "5+1_0_0" for the periodic
    # image of atom 5 shifted by +1 along a, or a list of them. Default: highlight.shell_of.
    shell_of: int | str | list[int | str] | None = None

    def refs(self) -> list[int | str]:
        return _as_refs(self.shell_of)

    # With shell_of: arrows pointing into the polyhedron are drawn outside, head touching the corner.
    inward: Literal["outside", "inside"] = "outside"

    @field_validator("data_file", mode="before")
    @classmethod
    def _empty_is_none(cls, value: Any) -> Any:
        return value or None


class LabelsConfig(Frozen):
    """Where site labels come from besides the POSCAR species line (compile side only)."""

    file: str | None = None  # .json or .toml mapping source-structure index -> label (compile/labels.py)
    labeler: str | None = None  # "path/to/file.py:func"; func(structure) -> dict[int, str] | list[str]


class SelectConfig(Frozen):
    """Restrict which atoms are shown. Empty means everything. Bonds/polyhedra only add what they need."""

    labels: list[str] = Field(default_factory=list)
    indices: list[int] = Field(default_factory=list)  # supercell atom indices
    shell_of: int | str | None = None  # this atom plus its polyhedron ligands: index, or "5+1_0_0" for an image

    def is_active(self) -> bool:
        return bool(self.labels or self.indices or self.shell_of is not None)


def _as_refs(value: int | str | list[int | str] | None) -> list[int | str]:
    if value is None:
        return []
    return list(value) if isinstance(value, list) else [value]


class HighlightConfig(Frozen):
    """Mark polyhedra: they stay solid and every other polyhedron is drawn as a ghost (tinted glass)."""

    # Centre atom(s): index, or "5+1_0_0" for an image, or a list of them; also marks displacements.
    shell_of: int | str | list[int | str] | None = None
    ghost_opacity: float = Field(default=0.35, ge=0.0, le=1.0)  # alpha of the other polyhedra
    ghost_saturation: float = Field(default=0.3, ge=0.0, le=1.0)  # their colour's saturation, as a fraction
    ghost_value: float = Field(default=0.95, ge=0.0, le=1.0)  # their colour's brightness (HSV value)

    def refs(self) -> list[int | str]:
        return _as_refs(self.shell_of)


class SceneConfig(Frozen):
    # The structure file (POSCAR), relative to the config file. `--poscar` overrides it.
    structure: str | None = None
    elements: dict[str, ElementStyle] = Field(default_factory=dict)
    materials: dict[str, MaterialStyle] = Field(default_factory=dict)
    cell: CellConfig = Field(
        default_factory=CellConfig, validation_alias=AliasChoices("cells", "cell"), serialization_alias="cells"
    )
    bonds: list[BondRule] = Field(default_factory=list)
    polyhedra: list[PolyhedronRule] = Field(default_factory=list)
    displacements: DisplacementConfig = Field(default_factory=DisplacementConfig)
    labels: LabelsConfig = Field(default_factory=LabelsConfig)
    select: SelectConfig = Field(default_factory=SelectConfig)
    highlight: HighlightConfig = Field(default_factory=HighlightConfig)

    @field_validator("materials", mode="before")
    @classmethod
    def _rgba(cls, value: Any) -> Any:
        """Accept RGB or RGBA `base_color` in user materials."""
        if not isinstance(value, dict):
            return value
        return {
            name: {**raw, "base_color": coerce_color(raw["base_color"])}
            if isinstance(raw, dict) and "base_color" in raw
            else raw
            for name, raw in value.items()
        }


def referenced_files(raw: Any, *, structure: bool = True) -> list[str]:
    """The file names a compile config names, as written (relative to the config's folder): its structure (unless
    `structure` is False, when another structure file is given), its label file and its displacement file. Works on
    the raw config, before validation, so a config that does not validate still names what it names."""
    if not isinstance(raw, dict):
        return []
    sections = [(raw, "structure")] if structure else []
    sections += [(raw.get("labels"), "file"), (raw.get("displacements"), "data_file")]
    names = [section.get(key) for section, key in sections if isinstance(section, dict)]
    return [name for name in names if isinstance(name, str) and name]


def scene_config_from_dict(data: dict[str, Any]) -> SceneConfig:
    """Validate a config dict (raises ``pydantic.ValidationError``, a ValueError, with key paths)."""
    cfg = SceneConfig.model_validate(data)
    materials: dict[str, MaterialStyle] = {**DEFAULT_MATERIALS, **cfg.materials}
    return cfg.model_copy(update={"materials": materials})


def load_scene_config(path: str | Path) -> SceneConfig:
    """A config file, JSON or TOML (by extension)."""
    raw = read_data(path)
    if not isinstance(raw, dict):
        raise ValueError(f"config file {path} must contain an object (a JSON object or a TOML table).")
    return scene_config_from_dict(raw)


def validate_scene(data: dict[str, Any]) -> SceneDocument:
    """Scene JSON -> SceneDocument; ValueError names the offending key or id."""
    if "schema_version" not in data:
        raise ValueError("Missing required field: schema_version.")
    scene = _SCENE.validate_python(data)
    check_references(scene)
    return scene


def scene_to_dict(scene: SceneDocument) -> dict[str, Any]:
    """The validated JSON form of a scene (re-validated: the lists in a frozen scene can still be mutated)."""
    return dataclasses.asdict(validate_scene(dataclasses.asdict(scene)))


def save_scene(scene: SceneDocument, path: str | Path) -> None:
    Path(path).write_text(json.dumps(scene_to_dict(scene), indent=2), encoding="utf-8")


def validate_settings(raw: dict[str, Any]) -> RenderSettings:
    """Render settings JSON (file merged with flags) -> RenderSettings; ValueError names the offending key."""
    settings = _SETTINGS.validate_python(add_alpha(raw))
    check_settings(settings)
    return settings
