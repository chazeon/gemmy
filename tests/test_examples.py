"""Committed examples must keep compiling (no Blender) and keep showing what their READMEs claim."""

from __future__ import annotations

import re
import shlex
from collections import Counter
from pathlib import Path

import pytest

from gemmy.compile.pipeline import compile_scene_from_files
from gemmy.config import load_scene_config
from slow_examples import example_param

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
CONFIGS = sorted((p.parent.name, p.name) for p in [*EXAMPLES.glob("*/config*.json"), *EXAMPLES.glob("*/config*.toml")])


def _compile(name: str, config: str):
    return compile_scene_from_files(EXAMPLES / name / config)  # each config names its own POSCAR


@pytest.mark.parametrize(("name", "config"), [example_param(name, config) for name, config in CONFIGS])
def test_example_compiles(name: str, config: str) -> None:
    scene = _compile(name, config)
    assert scene.primitives.atoms or scene.primitives.polyhedra
    assert scene.cell is not None


@pytest.mark.parametrize("toml", sorted(EXAMPLES.glob("*/*.toml")), ids=lambda p: f"{p.parent.name}/{p.name}")
def test_toml_copy_matches_its_json(toml: Path) -> None:
    assert load_scene_config(toml) == load_scene_config(toml.with_suffix(".json"))


def test_there_are_examples() -> None:
    assert {n for n, _ in CONFIGS} >= {"nacl", "ice-ih", "stishovite"}


def test_nacl_boundary_copies_make_the_27_atom_cube() -> None:
    scene = _compile("nacl", "config.json")
    assert Counter(a.element for a in scene.primitives.atoms) == {"Na": 14, "Cl": 13}


def test_ice_has_no_detached_hydrogen() -> None:
    scene = _compile("ice-ih", "config.json")
    point = {p.id: p for p in scene.points}
    bonded = set()
    for b in scene.primitives.bonds:
        if b.radius > 0.05:  # covalent O-H; H-bonds are thin
            bonded |= {b.a_point_id, b.b_point_id}
    hydrogens = [a.point_id for a in scene.primitives.atoms if point[a.point_id].element == "H"]
    assert hydrogens and all(h in bonded for h in hydrogens)


def test_stishovite_is_octahedra_only() -> None:
    scene = _compile("stishovite", "config.json")
    assert not scene.primitives.bonds
    assert scene.primitives.polyhedra and all(len(p.ligand_point_ids) == 6 for p in scene.primitives.polyhedra)
    assert {a.element for a in scene.primitives.atoms} == {"O"}  # Si centres hidden


@pytest.mark.parametrize("script", sorted(EXAMPLES.glob("*/render.sh")), ids=lambda p: p.parent.name)
def test_render_script_uses_the_cli(script: Path) -> None:
    from gemmy.cli_args import parse

    text = script.read_text(encoding="utf-8")
    assert "GEMMY_ROOT" not in text and "PYTHONPATH" not in text
    commands = re.findall(r"^\$GEMMY (compile|render) (.*?)(?<!\\)$", text.replace("\\\n", " "), flags=re.M)
    assert commands
    for sub, rest in commands:
        rest = re.sub(r"\$\{\w+:-([^}]*)\}", r"\1", rest)  # ${VAR:-default} -> default
        argv = shlex.split(re.sub(r"\$\w+", "path", rest))
        parse([sub, *argv])
