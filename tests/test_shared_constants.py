"""Constants that the Python compiler and the TypeScript viewer both use are written in both languages. These tests
read the two files and fail when a value disagrees, or when a constant is missing from one of them.

Python values are read with ast (the one module-level assignment of the name, literal_eval'd). TypeScript values are
read from the declaration `const NAME[: type] = value;`: the value text up to its `;` is taken whole (it may span
lines), its `null`, `true`, `false` and bare object keys are written as Python literals, and ast.literal_eval reads it.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

from gemmy.config import CLUSTER_SIZES
from gemmy.scene import SCENE_SCHEMA_VERSION

ROOT = Path(__file__).resolve().parents[1]
LATTICE = ROOT / "src/gemmy/compile/lattice.py"
PIPELINE = ROOT / "src/gemmy/compile/pipeline.py"
PIPELINE_TS = ROOT / "web/src/compile/pipeline.ts"
FLATNESS = ROOT / "web/src/geom/flatness.ts"
HULL = ROOT / "web/src/compile/hull.ts"
CLUSTERS = ROOT / "src/gemmy/compile/clusters.py"
CLUSTERS_TS = ROOT / "web/src/compile/clusters.ts"
LATTICE_TS = ROOT / "web/src/compile/lattice.ts"
CONFIG = ROOT / "src/gemmy/config.py"
CONFIG_TS = ROOT / "web/src/compile/config.ts"
INSTANCING = ROOT / "web/src/render/instancing.ts"


def _python_constant(path: Path, name: str) -> Any:
    """The value of the module-level assignment of `name` (exactly one), as a literal. Tuples are lists."""
    values = [
        node.value
        for node in ast.parse(path.read_text(encoding="utf-8")).body
        if isinstance(node, (ast.Assign, ast.AnnAssign))
        and any(isinstance(t, ast.Name) and t.id == name for t in _targets(node))
        and node.value is not None
    ]
    assert len(values) == 1, f"{name} is assigned {len(values)} times in {path}"
    return _listed(ast.literal_eval(values[0]))


def _targets(node: ast.Assign | ast.AnnAssign) -> list[ast.expr]:
    return node.targets if isinstance(node, ast.Assign) else [node.target]


def _ts_constant(path: Path, name: str) -> Any:
    """The value of `const NAME[: type] = value;` in a TypeScript file, as a literal. Arrays are lists."""
    text = path.read_text(encoding="utf-8")
    declaration = re.search(rf"\bconst\s+{name}\b\s*(?::[^=;]*)?=", text)
    assert declaration, f"{name} is not declared in {path}"
    value = _statement_value(text, declaration.end())
    return _listed(ast.literal_eval(_python_spelling(value)))


def _statement_value(text: str, start: int) -> str:
    """The source from `start` to the `;` that ends the statement at bracket depth 0."""
    depth = 0
    for end in range(start, len(text)):
        char = text[end]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == ";" and depth == 0:
            return text[start:end]
    raise AssertionError("the declaration has no ';'")


def _python_spelling(value: str) -> str:
    """A TypeScript literal written as a Python one: null, true and false, and object keys in quotes."""
    spelled = re.sub(r"\bnull\b", "None", value)
    spelled = re.sub(r"\btrue\b", "True", spelled)
    spelled = re.sub(r"\bfalse\b", "False", spelled)
    return re.sub(r"(?<=[{,])(\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', spelled)


def _listed(value: Any) -> Any:
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, dict):
        return {key: _listed(item) for key, item in value.items()}
    return value


def test_flat_tolerance_matches_the_viewer() -> None:
    assert _python_constant(LATTICE, "FLAT_TOLERANCE") == _ts_constant(FLATNESS, "FLAT_TOLERANCE")


def test_ring_flat_tolerance_matches_the_viewer() -> None:
    assert _python_constant(CLUSTERS, "RING_FLAT_TOLERANCE") == _ts_constant(CLUSTERS_TS, "RING_FLAT_TOLERANCE")


def test_min_polygon_corners_matches_the_viewer() -> None:
    assert _python_constant(LATTICE, "MIN_POLYGON_CORNERS") == _ts_constant(HULL, "MIN_POLYGON_CORNERS")


def test_max_images_per_axis_matches_the_viewer() -> None:
    assert _python_constant(LATTICE, "MAX_IMAGES_PER_AXIS") == _ts_constant(LATTICE_TS, "MAX_IMAGES_PER_AXIS")


def test_max_box_sites_matches_the_viewer() -> None:
    assert _python_constant(LATTICE, "MAX_BOX_SITES") == _ts_constant(LATTICE_TS, "MAX_BOX_SITES")


def test_max_ring_size_matches_the_viewer() -> None:
    assert _python_constant(CONFIG, "MAX_RING_SIZE") == _ts_constant(CONFIG_TS, "MAX_RING_SIZE")


def test_cluster_sizes_match_the_viewer() -> None:
    """A cluster rule that leaves its sizes out takes its kind's sizes: config.py CLUSTER_SIZES (SizeWindow records)
    and config.ts CLUSTER_SIZES (the same fields, in snake case) hold the same numbers."""
    python = {kind: {"min_size": w.min_size, "max_size": w.max_size} for kind, w in CLUSTER_SIZES.items()}
    assert python == _ts_constant(CONFIG_TS, "CLUSTER_SIZES")


def test_polyhedron_colour_and_material_match_the_viewer() -> None:
    """A cluster is drawn with its polyhedron's colour and material, on both sides."""
    assert _python_constant(CONFIG, "POLYHEDRON_COLOR") == _ts_constant(CONFIG_TS, "DEFAULT_POLYHEDRON_COLOUR")
    assert _python_constant(CONFIG, "POLYHEDRON_MATERIAL") == _ts_constant(CONFIG_TS, "POLYHEDRON_MATERIAL")


def test_neighbor_cutoff_margin_matches_the_viewer() -> None:
    assert _python_constant(PIPELINE, "NEIGHBOR_CUTOFF_MARGIN") == _ts_constant(PIPELINE_TS, "NEIGHBOR_CUTOFF_MARGIN")


def test_scene_schema_version_matches_the_viewer() -> None:
    """The viewer writes the scene it reads: pipeline.ts hardcodes the version gemmy.scene defines."""
    assert _ts_constant(PIPELINE_TS, "SCENE_SCHEMA_VERSION") == SCENE_SCHEMA_VERSION


def test_displacement_and_arrow_constants_match_the_viewer() -> None:
    """pipeline.py and pipeline.ts draw the displacement arrows and the clusters from the same constants."""
    names = ("DISPLACEMENT_RADIUS", "DISPLACEMENT_COLOR", "ARROW_MATERIAL", "FIRST_FRAME", "COMPUTED_ELEMENT")
    for name in (*names, "TOPOLOGY_LOCKED"):
        assert _python_constant(PIPELINE, name) == _ts_constant(PIPELINE_TS, name), name


def test_instancing_takes_flatness_from_geom_and_keeps_no_copy() -> None:
    text = INSTANCING.read_text(encoding="utf-8")
    assert "const FLAT_TOLERANCE" not in text
    assert 'from "../geom/flatness"' in text
    assert "compile/hull" not in text
