"""`gemmy serve`: the live state, the HTTP endpoints and the coalescing render step; no browser, no Blender."""

from __future__ import annotations

import json
import shutil
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from gemmy.cli import main
from gemmy.serve import Preview, compile_build, make_server, scene_file_build

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
POLL = 0.02

SCENE = {
    "source_comment": "v1",
    "materials": {"m": {"base_color": [1, 0, 0, 1]}},
    "points": [{"id": "p0", "element": "O", "position": [0, 0, 0]}],
    "primitives": {"atoms": [{"id": "a0", "point_id": "p0", "radius": 1.0, "material_id": "m", "element": "O"}]},
}


class Running:
    def __init__(self, *previews: Preview) -> None:
        self.previews = previews
        self.preview = previews[0]
        self.server = make_server(previews, "127.0.0.1", 0)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(0.02), daemon=True)

    def get(self, path: str) -> tuple[int, bytes]:
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()

    def status(self) -> dict:
        return json.loads(self.get("/status")[1])

    def scene(self) -> dict:
        return json.loads(self.get("/scene.json")[1])

    def __enter__(self) -> Running:
        for preview in self.previews:
            preview.start()
        self.thread.start()
        return self

    def __exit__(self, *exc) -> None:
        for preview in self.previews:
            preview.stop()
        self.server.shutdown()
        self.server.server_close()


def until(check: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.01)
    raise AssertionError("condition not reached in time")


def write_scene(path: Path, comment: str) -> None:
    path.write_text(json.dumps({**SCENE, "source_comment": comment}), encoding="utf-8")


@pytest.fixture
def scene_path(tmp_path: Path) -> Iterator[Path]:
    path = tmp_path / "scene.json"
    write_scene(path, "v1")
    yield path


def preview_for(path: Path, **kwargs) -> Preview:
    build, watch = scene_file_build(path)
    return Preview(build, watch, "demo", poll=POLL, **kwargs)


def bump_mtime(path: Path) -> None:
    st = path.stat()
    import os

    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000))


def test_serves_page_scene_and_status(scene_path: Path) -> None:
    with Running(preview_for(scene_path)) as run:
        code, page = run.get("/")
        assert code == 200 and b"<h1>demo</h1>" in page and b'id="scene-data"></script>' in page
        assert run.scene()["source_comment"] == "v1"
        status = run.status()
        assert status["error"] is None and status["version"] and status["render"]["enabled"] is False
        assert run.get("/nope")[0] == 404


def test_several_previews_are_tabs_at_their_own_paths(tmp_path: Path) -> None:
    paths = [tmp_path / "a.json", tmp_path / "b.json"]
    for path in paths:
        write_scene(path, path.stem)
    previews = [
        Preview(*scene_file_build(path), path.stem, poll=POLL, tabs=[("a", "0"), ("b", "1")], tab=k)
        for k, path in enumerate(paths)
    ]
    with Running(*previews) as run:
        code, page = run.get("/1/")
        assert code == 200 and b'<a href="../1/" aria-current="page">b</a>' in page and b'<a href="../0/">a</a>' in page
        assert json.loads(run.get("/1/scene.json")[1])["source_comment"] == "b"
        assert json.loads(run.get("/scene.json")[1])["source_comment"] == "a"  # / is the first tab
        assert run.get("/1") == (200, page)  # redirected to /1/, so the page's relative links resolve
        assert run.get("/2/")[0] == 404 and run.get("/1/nope")[0] == 404
        assert b'class="tabs"' not in Preview(*scene_file_build(paths[0]), "a").page  # one preview: no tabs


def test_cli_several_configs_reject_single_config_flags(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["serve", "a.toml", "b.toml", "--title", "x"]) == 2
    assert "one config" in capsys.readouterr().err


def test_bad_edit_keeps_last_good_scene_then_recovers(scene_path: Path) -> None:
    with Running(preview_for(scene_path)) as run:
        first = run.status()["version"]
        scene_path.write_text("{ not json", encoding="utf-8")
        until(lambda: run.status()["error"] is not None)
        assert "JSON" in run.status()["error"] or "Expecting" in run.status()["error"]
        assert run.scene()["source_comment"] == "v1"
        assert run.status()["version"] == first
        write_scene(scene_path, "v2")
        bump_mtime(scene_path)
        until(lambda: run.status()["error"] is None)
        assert run.scene()["source_comment"] == "v2"
        assert run.status()["version"] != first


def test_invalid_scene_is_an_error_not_a_crash(scene_path: Path) -> None:
    bad = json.loads(scene_path.read_text(encoding="utf-8"))
    bad["primitives"]["atoms"][0]["point_id"] = "missing"
    scene_path.write_text(json.dumps(bad), encoding="utf-8")
    with Running(preview_for(scene_path)) as run:  # the first compile fails: no scene yet, the error is reported
        assert run.get("/scene.json")[0] == 404
        assert "missing" in run.status()["error"]
        write_scene(scene_path, "fixed")
        bump_mtime(scene_path)
        until(lambda: run.status()["error"] is None)
        assert run.scene()["source_comment"] == "fixed"


def test_events_stream_sends_status(scene_path: Path) -> None:
    with Running(preview_for(scene_path)) as run:
        with urllib.request.urlopen(run.base + "/events", timeout=5) as response:
            assert response.headers["Content-Type"] == "text/event-stream"
            assert response.readline() == b"event: status\n"
            payload = json.loads(response.readline().removeprefix(b"data: "))
            assert payload["version"] == run.status()["version"]
            write_scene(scene_path, "v2")
            bump_mtime(scene_path)
            response.readline()  # blank line ending the first event
            for _ in range(20):
                line = response.readline()
                if line.startswith(b"data: ") and json.loads(line[6:])["version"] != payload["version"]:
                    break
            else:
                raise AssertionError("no event for the change")


def test_renders_coalesce_to_one_more_with_the_latest_scene(scene_path: Path) -> None:
    started, release = threading.Event(), threading.Event()
    seen: list[str] = []

    def render(path: Path) -> None:
        seen.append(json.loads(path.read_text(encoding="utf-8"))["source_comment"])
        started.set()
        release.wait(5)

    with Running(preview_for(scene_path, render=render, render_output="fig.png")) as run:
        assert started.wait(5)
        assert run.status()["render"]["state"] == "rendering"
        for n in (2, 3, 4):
            write_scene(scene_path, f"v{n}")
            bump_mtime(scene_path)
            until(lambda n=n: run.scene()["source_comment"] == f"v{n}")
        release.set()
        until(lambda: len(seen) == 2 and run.status()["render"]["state"] == "idle")
        time.sleep(0.2)
        assert seen == ["v1", "v4"]  # never queued per change: one extra render, the latest scene
        render_state = run.status()["render"]
        assert render_state["time"] and render_state["output"] == "fig.png" and render_state["error"] is None


def test_render_error_is_reported_and_the_server_goes_on(scene_path: Path) -> None:
    def render(path: Path) -> None:
        raise RuntimeError("Blender exploded")

    with Running(preview_for(scene_path, render=render)) as run:
        until(lambda: run.status()["render"]["error"] is not None)
        assert "Blender exploded" in run.status()["render"]["error"]
        assert run.status()["render"]["state"] == "idle"
        assert run.scene()["source_comment"] == "v1"


def test_compile_error_names_the_key_and_the_last_scene_stays(tmp_path: Path) -> None:
    shutil.copy(EXAMPLES / "nacl" / "POSCAR", tmp_path / "POSCAR")
    config = tmp_path / "config.toml"
    shutil.copy(EXAMPLES / "nacl" / "config.toml", config)
    build, watch = compile_build(config, tmp_path / "POSCAR")
    preview = Preview(build, watch, "nacl", poll=POLL)
    with Running(preview) as run:
        good = run.scene()
        assert good["primitives"]["atoms"]
        config.write_text(config.read_text(encoding="utf-8") + "\nno_such_key = 1\n", encoding="utf-8")
        until(lambda: run.status()["error"] is not None)
        assert "no_such_key" in run.status()["error"]
        assert run.scene() == good
        shutil.copy(EXAMPLES / "nacl" / "config.toml", config)
        bump_mtime(config)
        until(lambda: run.status()["error"] is None)


def test_watch_includes_files_the_config_names(tmp_path: Path) -> None:
    config = tmp_path / "sub" / "config.toml"
    config.parent.mkdir()
    config.write_text('[labels]\nfile = "labels.toml"\n[displacements]\ndata_file = "d.json"\n', encoding="utf-8")
    _, watch = compile_build(config, tmp_path / "POSCAR")
    names = [p.name for p in watch()]
    assert names == ["config.toml", "POSCAR", "labels.toml", "d.json"]
    assert watch()[2].parent == config.resolve().parent
    # Without --poscar, the structure the config names is watched, next to the config.
    config.write_text('structure = "POSCAR_HS"\n', encoding="utf-8")
    _, watch = compile_build(config)
    assert watch() == [config, config.resolve().parent / "POSCAR_HS"]


def test_cli_rejects_missing_inputs(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["serve"]) == 2
    assert "--scene" in capsys.readouterr().err


def test_cli_render_without_blender_fails_at_startup(scene_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    missing = scene_path.parent / "no-blender"
    code = main(["serve", "--scene", str(scene_path), "--render", "fig.png", "--blender", str(missing), "--port", "0"])
    assert code == 2
    assert "--blender" in capsys.readouterr().err


def post(run: Running, path: str, body: object) -> tuple[int, dict]:
    request = urllib.request.Request(
        run.base + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        text = exc.read()
        return exc.code, json.loads(text) if exc.headers["Content-Type"] == "application/json" else {}


VIEW = {
    "look": {"preset": "3to2d"},
    "camera": {
        "projection": "ortho", "direction": [0.7, 0.5, 0.5], "up": [-0.4, -0.3, 0.9], "zoom": 2, "target": [1, 2, 3],
    },
    "cell_box": {"show": False},
    "quality": {"resolution": [1600, 800]},
}  # fmt: skip


def test_render_view_applies_the_view_and_renders_again(scene_path: Path) -> None:
    from gemmy.config import validate_settings
    from gemmy.settings import RenderSettings

    state = {"settings": RenderSettings(), "renders": 0}

    def apply_view(raw: dict) -> None:
        view = validate_settings(raw)
        state["settings"] = RenderSettings(camera=view.camera, cell_box=view.cell_box)

    def render(path: Path) -> None:
        state["renders"] += 1

    with Running(preview_for(scene_path, render=render, apply_view=apply_view)) as run:
        until(lambda: state["renders"] == 1 and run.status()["render"]["state"] == "idle")
        assert post(run, "/render-view", VIEW) == (200, {"ok": True})
        until(lambda: state["renders"] == 2)
        camera, box = state["settings"].camera, state["settings"].cell_box
        assert camera.zoom == 2 and camera.target == (1, 2, 3) and camera.up == (-0.4, -0.3, 0.9) and box.show is False
        # a bad view is rejected with the key named, and nothing renders
        code, reply = post(run, "/render-view", {"camera": {"zoom": 0}})
        assert code == 400 and "zoom" in reply["error"]
        assert post(run, "/render-view", [1])[0] == 400
        time.sleep(0.2)
        assert state["renders"] == 2


def test_render_view_needs_render(scene_path: Path) -> None:
    with Running(preview_for(scene_path)) as run:  # started without --render
        code, reply = post(run, "/render-view", VIEW)
        assert code == 409 and "--render" in reply["error"]
        assert post(run, "/elsewhere", {})[0] == 404
