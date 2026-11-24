"""RenderSettings: defaults once, CLI built from the fields by tyro, validation in one place."""

from __future__ import annotations

import dataclasses
import json

import pytest

from gemmy.cli import resolve_settings
from gemmy.cli_args import parse
from gemmy.config import validate_settings
from gemmy.scene import from_dict
from gemmy.settings import RenderPlan, RenderSettings


def _parse(*flags: str):
    return resolve_settings(parse(["render", "--scene", "s.json", *flags]))


def test_cli_without_flags_equals_model_defaults() -> None:
    assert _parse() == RenderSettings()


def test_cli_flags_override() -> None:
    s = _parse(
        "--quality.samples", "7", "--quality.resolution", "800", "600", "--look.preset", "classic",
        "--arrows.radius", "0.1", "--axes.enabled", "True", "--axes.margin", "0.2",
        "--polyhedron.edge-color", "0", "0", "0", "1", "--views", "front", "top",
        "--look.background", "transparent", "--no-soft-lighting",
    )  # fmt: skip
    assert s.quality.samples == 7 and s.quality.resolution == (800, 600)
    assert s.look.preset == "classic" and s.look.background == "transparent"
    assert s.arrows.radius == 0.1 and s.axes.enabled and s.axes.margin == 0.2
    assert s.polyhedron.edge_color == (0.0, 0.0, 0.0, 1.0)
    assert s.views == ("front", "top") and not s.soft_lighting


def test_bad_margin_is_rejected_once_by_the_model() -> None:
    with pytest.raises(ValueError):
        validate_settings({"axes": {"margin": 0.6}})
    with pytest.raises(ValueError):
        _parse("--axes.margin", "0.6")


def test_unknown_keys_and_views_rejected() -> None:
    with pytest.raises(ValueError):
        validate_settings({"qualty": {}})
    with pytest.raises(ValueError):
        validate_settings({"views": ["sideways"]})
    with pytest.raises(ValueError):
        validate_settings({"look": {"preset": "nope"}})


def test_resolve_applies_preset_and_overrides_and_roundtrips_json() -> None:
    resolved = validate_settings({"look": {"preset": "classic", "background": "transparent", "exposure": 1.0}}).resolve(
        "s.json"
    )
    plan = from_dict(RenderPlan, json.loads(json.dumps(dataclasses.asdict(resolved))))
    assert plan == resolved
    assert plan.look.exposure == 1.0  # override wins over transparent variant 0.45
    assert plan.look.world_strength == 0.42  # transparent variant collapsed
    assert plan.look.view_transform == "AgX" and plan.look.background == "transparent"
    assert plan.scene.endswith("/s.json")


def test_camera_flags_and_validation() -> None:
    s = _parse(
        "--camera.azimuth", "30", "--camera.elevation", "20", "--camera.projection", "ortho",
        "--camera.zoom", "1.5", "--out", "a.png",
    )  # fmt: skip
    assert s.camera.azimuth == 30 and s.camera.zoom == 1.5 and s.out == "a.png"
    s = _parse("--camera.direction", "1", "1", "1", "--camera.target", "0", "0", "1")
    assert s.camera.direction == (1.0, 1.0, 1.0)
    for bad in (
        ["--camera.azimuth", "10"],
        ["--camera.direction", "0", "0", "0"],
        ["--camera.zoom", "0"],
        ["--views", "front", "--camera.azimuth", "1", "--camera.elevation", "1"],
    ):
        with pytest.raises(ValueError):
            _parse(*bad)
    with pytest.raises(ValueError):
        validate_settings({"out": "a.png", "out_dir": "d"})


def test_shots_resolution() -> None:
    shots = validate_settings({"views": ["front", "top"], "out_dir": "d"}).resolve("s").shots
    assert [s.output.rsplit("/", 2)[-2:] for s in shots] == [["d", "front.png"], ["d", "top.png"]]
    shots = validate_settings({"look": {"preset": "3to2d"}}).resolve("s").shots
    assert shots[0].camera.projection == "ortho" and shots[0].output is None
    shots = validate_settings({"look": {"preset": "3to2d"}, "camera": {"projection": "persp"}}).resolve("s").shots
    assert shots[0].camera.projection == "persp"


def test_resolved_paths_are_absolute(tmp_path, monkeypatch) -> None:
    from pathlib import Path

    monkeypatch.chdir(tmp_path)
    plan = validate_settings({"out": "img.png"}).resolve("scene.json")
    assert plan.scene == str(Path(tmp_path / "scene.json").resolve())
    assert plan.shots[0].output == str(Path(tmp_path / "img.png").resolve())


def test_camera_up_flag_reaches_the_plan() -> None:
    s = resolve_settings(
        parse(["render", "--scene", "s.json", "--camera.direction", "0", "0", "1", "--camera.up", "1", "0", "0"])
    )
    assert s.camera.up == (1.0, 0.0, 0.0)
    assert s.resolve("scene.json").shots[0].camera.up == (1.0, 0.0, 0.0)
    assert validate_settings({}).resolve("scene.json").shots[0].camera.up is None


def test_settings_file_then_flags_override(tmp_path) -> None:
    f = tmp_path / "s.json"
    f.write_text(json.dumps({"quality": {"samples": 9}, "camera": {"zoom": 2}}))
    s = resolve_settings(parse(["render", "--scene", "s.json", "--settings", str(f), "--camera.zoom", "3"]))
    assert s.quality.samples == 9 and s.camera.zoom == 3


def test_pydantic_config_is_not_a_flag(capsys) -> None:
    with pytest.raises(SystemExit):
        parse(["render", "--help"])
    assert "pydantic" not in capsys.readouterr().out
