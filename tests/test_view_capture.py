"""Capture mode (?capture=1, web/src/ui/capture.ts) in headless Chrome: the page draws the stage alone, and window.gemmy
sets the view and exports a picture. Run with `scripts/check.sh --browser`."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from test_browser import (
    CHROME,
    GPU_FLAGS,
    ROOT,
    SOFTWARE_FLAGS,
    _devtools_port,
    _free_port,
    _node_ok,
    _program,
    _stop,
    _wait_for_port,
)

pytestmark = pytest.mark.browser

SCRIPT = ROOT / "tests" / "browser" / "capture.mjs"
WIDTH, HEIGHT = 480, 320
PNG_SCALE = 2  # the PNG is twice the stage (ui/export.ts)


def _run(chrome: str, flags: list[str], work: Path, port: int) -> subprocess.CompletedProcess:
    profile = Path(tempfile.mkdtemp(prefix="chrome-", dir=work))
    process = subprocess.Popen(
        [chrome, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={profile}", "--no-first-run",
         "--no-default-browser-check", "--mute-audio", *flags, "about:blank"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )  # fmt: skip
    try:
        devtools = _devtools_port(profile, process)
        url = f"http://127.0.0.1:{port}/view.html?capture=1"
        return subprocess.run(["node", str(SCRIPT), str(devtools), url], capture_output=True, text=True, timeout=120)
    finally:
        _stop(process)


@pytest.fixture(scope="module")
def capture_run(tmp_path_factory) -> dict:
    chrome = _program(CHROME)
    if chrome is None:
        pytest.skip("Google Chrome not found (set GEMMY_CHROME)")
    if not _node_ok():
        pytest.skip("Node 22 or later is needed")
    gemmy = Path(sys.executable).parent / "gemmy"
    work = tmp_path_factory.mktemp("capture")
    example = ROOT / "examples" / "stishovite" / "config.toml"
    subprocess.run([str(gemmy), "compile", str(example), "--out", str(work / "scene.json")], check=True)
    subprocess.run([str(gemmy), "view", str(work / "scene.json"), "--out", str(work / "view.html")], check=True)
    port = _free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(work)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_port(port, server)
        for flags in (GPU_FLAGS, SOFTWARE_FLAGS):
            run = _run(chrome, flags, work, port)
            if run.stdout.strip():
                return json.loads(run.stdout)
        pytest.fail(f"the capture scenario printed nothing:\n{run.stderr[-2000:]}")
    finally:
        _stop(server)


def test_capture_page_has_no_ui(capture_run: dict) -> None:
    assert "error" not in capture_run, capture_run.get("error")
    assert capture_run["ui"] == {"overlayChildren": 0, "controls": 0, "canvases": 1}


def test_set_changes_the_state(capture_run: dict) -> None:
    assert capture_run["before"]["box"] is True
    assert capture_run["after"]["box"] is False
    assert capture_run["after"]["theme"] == "light"
    assert capture_run["after"]["transparent"] is True


def test_png_export_has_the_stage_size(capture_run: dict) -> None:
    assert capture_run["png"] == {"type": "image/png", "width": WIDTH * PNG_SCALE, "height": HEIGHT * PNG_SCALE}
