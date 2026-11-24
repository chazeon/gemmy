from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from gemmy.cli import main
from gemmy.render.launch import BlenderNotFoundError, build_command, find_blender


def _never(_: str) -> bool:
    return False


def test_precedence_flag_env_path_known() -> None:
    always = lambda _: True  # noqa: E731 - tiny stub
    assert find_blender("/x/flag", {"BLENDER": "/x/env"}, lambda _: "/x/path", always) == "/x/flag"
    assert find_blender(None, {"BLENDER": "/x/env"}, lambda _: "/x/path", always) == "/x/env"
    assert find_blender(None, {}, lambda _: "/x/path", _never) == "/x/path"
    assert find_blender(None, {}, lambda _: None, lambda p: p == "/known", ("/nope", "/known")) == "/known"


def test_missing_blender_is_a_clear_error() -> None:
    with pytest.raises(BlenderNotFoundError, match="--blender PATH or \\$BLENDER"):
        find_blender(None, {}, lambda _: None, _never, ("/a", "/b"))
    with pytest.raises(BlenderNotFoundError, match="not a file"):
        find_blender(None, {"BLENDER": "/missing"}, lambda _: None, _never)


def test_command_is_background_by_default() -> None:
    cmd = build_command("/bin/blender", "/tmp/p.json", src_root=Path("/repo/src"))
    assert cmd[:2] == ["/bin/blender", "-b"] and "--python-exit-code" in cmd
    assert "/repo/src" in cmd[-1] and "/tmp/p.json" in cmd[-1]
    assert "-b" not in build_command("/bin/blender", "/tmp/p.json", gui=True)


def test_render_spawns_blender_with_resolved_plan(tmp_path: Path, monkeypatch, capsys) -> None:
    record = tmp_path / "args.txt"
    fake = tmp_path / "fakeblender"
    fake.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" > {record}\nexit 0\n')
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    scene = Path(__file__).parent / "fixtures" / "rocksalt" / "scene.golden.json"
    plan = tmp_path / "plan.json"
    monkeypatch.setenv("BLENDER", str(fake))
    rc = main(["render", "--scene", str(scene), "--plan-out", str(plan), "--quality.samples", "5"])
    assert rc == 0 and plan.is_file() and '"samples": 5' in plan.read_text()
    assert "-b" in record.read_text().split("\n")


def test_render_without_blender_exits_with_message(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.delenv("BLENDER", raising=False)
    monkeypatch.setattr("gemmy.render.launch.KNOWN_LOCATIONS", ())
    scene = Path(__file__).parent / "fixtures" / "rocksalt" / "scene.golden.json"
    assert main(["render", "--scene", str(scene)]) == 2
    assert "Blender not found" in capsys.readouterr().err
    assert os.environ["PATH"] == str(tmp_path)
