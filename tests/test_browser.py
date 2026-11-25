"""The viewer in headless Chrome: one scripted run of ten steps on two pages, compared with goldens.

Run with `scripts/check.sh --browser` (marker `browser`; the default pytest run leaves these out). They need Google
Chrome (GEMMY_CHROME overrides the path) and Node 22 or later (tests/browser/driver.mjs uses Node's WebSocket); without
either, they are skipped. The pages are the gemmy view page of the stishovite example and the hosted site's front page,
both built here into a temporary folder and served on 127.0.0.1 by `python -m http.server`.

Chrome draws with the GPU when it can (--use-angle=metal) and with SwiftShader only when WebGL 2 does not start.
GEMMY_BROWSER_RENDERER=software forces SwiftShader, for timing comparisons.

Goldens (tests/fixtures/browser/<page>/): steps.json holds each step's UI state and WebGL draw counts, compared exactly
on every machine. export-svg.svg is the canonical SVG of the SVG export, and renderer.txt names the renderer that drew
it: the export is traced from the picture, so its exact bytes follow the renderer. The SVG is compared only when the
renderer matches; otherwise the test warns and still compares the state. Regenerate deliberately with
    GEMMY_UPDATE_GOLDEN=1 uv run pytest -m browser tests/test_browser.py
and explain the change in the commit message.
"""

from __future__ import annotations

import difflib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import warnings
from itertools import zip_longest
from pathlib import Path

import pytest

from golden import FIXTURES, canonical_svg, dumps, updating

pytestmark = pytest.mark.browser

ROOT = Path(__file__).resolve().parents[1]
DRIVER = ROOT / "tests" / "browser" / "driver.mjs"
GOLDENS = FIXTURES / "browser"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
GPU_FLAGS = ["--use-angle=metal"]
SOFTWARE_FLAGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
DRIVER_NO_WEBGL = 3  # the driver's exit code when WebGL 2 does not start
# (name, path under the server, the example card the start screen opens first). The front page opens on the start
# screen (home), so its run records home and then opens the stishovite card, which has the polyhedra to select.
PAGES = [("view-stishovite", "/view-stishovite.html", None), ("site-front", "/site/index.html", "stishovite")]
# The hosted site's examples, for a site build that does not write examples.json yet (scripts/build_site.sh and
# gemmy.site.write_hosted_site are the owners of that file, so the test only fills it in when it is missing).
_EXAMPLES = [
    {"name": name, "title": title, "description": text, "scene": f"{name}/scene.json.gz"}
    for name, title, text in [
        ("nacl", "Sodium chloride", "Rock salt, a cubic lattice of Na and Cl."),
        ("ice-ih", "Ice Ih", "Hexagonal water ice, with its hydrogen bonds."),
        ("stishovite", "Stishovite", "A dense SiO2 polymorph with octahedral silicon."),
    ]
]


def _program(name: str) -> str | None:
    """The executable for `name`, or None; GEMMY_CHROME may name a path or a command."""
    return shutil.which(os.environ.get("GEMMY_CHROME", name))


def _node_ok() -> bool:
    node = shutil.which("node")
    if node is None:
        return False
    major = subprocess.run([node, "-p", "process.versions.node.split('.')[0]"], capture_output=True, text=True)
    return major.returncode == 0 and int(major.stdout.strip()) >= 22


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _stop(process: subprocess.Popen) -> None:
    """Ends a process this test started, by its pid: terminate, then kill if it does not go."""
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def _wait_for_port(port: int, process: subprocess.Popen) -> None:
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError("the page server exited")
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError(f"the page server did not start on port {port}")


def _devtools_port(profile: Path, process: subprocess.Popen) -> int:
    marker = profile / "DevToolsActivePort"  # Chrome writes its port here once it listens
    for _ in range(300):
        if process.poll() is not None:
            raise RuntimeError("Chrome exited before it listened")
        if marker.exists() and marker.read_text().strip():
            return int(marker.read_text().split()[0])
        time.sleep(0.1)
    raise RuntimeError("Chrome did not open its DevTools port")


def _build_pages(work: Path, gemmy: Path) -> None:
    """The two pages and the scene the test drops: compiled from the committed examples, never examples/private/."""
    examples = ROOT / "examples"
    subprocess.run(
        [str(gemmy), "compile", str(examples / "stishovite" / "config.toml"), "--out", str(work / "stishovite.json")],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [str(gemmy), "view", str(work / "stishovite.json"), "--out", str(work / "view-stishovite.html")],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [str(gemmy), "compile", str(examples / "ice-ih" / "config.toml"), "--out", str(work / "dropped.json")],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["bash", str(ROOT / "scripts" / "build_site.sh")],
        check=True,
        capture_output=True,
        env={**os.environ, "OUT": str(work / "site"), "GEMMY": str(gemmy)},
    )
    examples = work / "site" / "examples.json"
    if not examples.exists():
        examples.write_text(json.dumps(_EXAMPLES), encoding="utf-8")


def _drive(chrome: str, work: Path, port: int, flags: list[str]) -> subprocess.CompletedProcess:
    """One Chrome, started with `flags`, runs the driver over every page, then is ended by its pid."""
    profile = Path(tempfile.mkdtemp(prefix="chrome-", dir=work))  # fresh: a stale DevToolsActivePort would be read
    chrome_process = subprocess.Popen(
        [
            chrome,
            "--headless=new",
            "--remote-debugging-port=0",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--mute-audio",
            *flags,
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        devtools = _devtools_port(profile, chrome_process)
        pages = [f"{name}={path}" + (f"#{card}" if card else "") for name, path, card in PAGES]
        return subprocess.run(
            ["node", str(DRIVER), str(devtools), f"http://127.0.0.1:{port}/", "/dropped.json", *pages],
            capture_output=True,
            text=True,
            timeout=900,
        )
    finally:
        _stop(chrome_process)


@pytest.fixture(scope="session")
def browser_run(tmp_path_factory):
    """Builds the pages, serves them, runs the driver once, and returns its JSON (renderer and each page's steps)."""
    chrome = _program(CHROME)
    if chrome is None:
        pytest.skip("Google Chrome not found (set GEMMY_CHROME)")
    if not _node_ok():
        pytest.skip("Node 22 or later is needed for the browser driver")
    gemmy = Path(sys.executable).parent / "gemmy"
    work = tmp_path_factory.mktemp("browser")
    _build_pages(work, gemmy)
    port = _free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(work)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_port(port, server)
        order = (
            [SOFTWARE_FLAGS] if os.environ.get("GEMMY_BROWSER_RENDERER") == "software" else [GPU_FLAGS, SOFTWARE_FLAGS]
        )
        for flags in order:
            done = _drive(chrome, work, port, flags)
            if done.returncode == DRIVER_NO_WEBGL:
                continue
            assert done.returncode == 0, f"the browser driver failed:\n{done.stderr[-4000:]}"
            return json.loads(done.stdout)
        pytest.skip("WebGL 2 did not start, even with SwiftShader")
    finally:
        _stop(server)


def _golden_state(steps: list[dict]) -> tuple[dict, str | None]:
    """The steps as they are stored: the SVG text becomes a file name, and the file's text is returned with it."""
    stored = []
    svg = None
    for step in steps:
        step = dict(step)
        if "svg" in step:
            svg = canonical_svg(step.pop("svg"))
            step["svg"] = "export-svg.svg"
        stored.append(step)
    return {"steps": stored}, svg


@pytest.mark.parametrize("page", [name for name, _, _ in PAGES])
def test_page_steps_match_golden(page: str, browser_run: dict) -> None:
    golden_dir = GOLDENS / page
    state, svg = _golden_state(browser_run["pages"][page]["steps"])
    renderer = browser_run["renderer"]
    if updating():
        golden_dir.mkdir(parents=True, exist_ok=True)
        (golden_dir / "steps.json").write_text(dumps(state), encoding="utf-8")
        (golden_dir / "renderer.txt").write_text(renderer + "\n", encoding="utf-8")
        if svg is not None:
            (golden_dir / "export-svg.svg").write_text(svg, encoding="utf-8")
    expected = json.loads((golden_dir / "steps.json").read_text(encoding="utf-8"))
    actual = json.loads(dumps(state))
    if actual != expected:
        pytest.fail(_steps_diff(expected, actual), pytrace=False)

    golden_renderer = (golden_dir / "renderer.txt").read_text(encoding="utf-8").strip()
    if renderer != golden_renderer:
        warnings.warn(
            f"{page}: the SVG export was not compared, it was drawn by {renderer!r} and the golden by "
            f"{golden_renderer!r} (the traced SVG follows the renderer)",
            stacklevel=1,
        )
        return
    expected_svg = (golden_dir / "export-svg.svg").read_text(encoding="utf-8")
    assert svg == expected_svg, _text_diff(expected_svg, svg or "")


def _steps_diff(expected: dict, actual: dict) -> str:
    """The steps that differ by name, then every key of the first one that differs."""
    pairs = list(zip_longest(expected["steps"], actual["steps"]))
    differing = [(golden, run) for golden, run in pairs if golden != run]
    if not differing:
        return ""
    names = [(run or golden)["name"] for golden, run in differing]
    lines = [f"{len(differing)} of {len(pairs)} steps differ: {', '.join(names)}"]
    golden, run = differing[0]
    if golden is None or run is None:
        lines.append(f"step count: golden {len(expected['steps'])}, run {len(actual['steps'])}")
    else:
        lines.append(f"first difference, step {run['name']}:")
        for key in sorted(set(golden) | set(run)):
            if golden.get(key) != run.get(key):
                lines.append(
                    f"  {key}:\n    golden: {json.dumps(golden.get(key))}\n    run:    {json.dumps(run.get(key))}"
                )
    lines.append("(GEMMY_UPDATE_GOLDEN=1 regenerates the goldens)")
    return "\n".join(lines)


def _text_diff(expected: str, actual: str) -> str:
    diff = difflib.unified_diff(expected.splitlines(), actual.splitlines(), "golden", "run", lineterm="", n=1)
    return "\n".join(list(diff)[:200]) + "\n(GEMMY_UPDATE_GOLDEN=1 regenerates the goldens)"


# The layout the top bar and the menu must have (the driver measures it at 1280 px and at a phone's 393 px). Each
# check names what it measured, so a failure says the number, not just that it failed.
LAYOUT_TOLERANCE_PX = 1.0
PHONE_WIDTH_PX = 393


def _layout_failures(layout: dict) -> list[str]:
    failures = []
    desktop, phone = layout["desktop"], layout["phone"]
    for name, shot in (("desktop", desktop), ("phone", phone)):
        assert shot["open"]["viewport"]["width"] == (PHONE_WIDTH_PX if name == "phone" else 1280)
        if shot["open"]["scrollWidth"] > shot["open"]["viewport"]["width"]:
            failures.append(f"{name}: the page scrolls sideways ({shot['open']['scrollWidth']} px wide)")
        for island in ("menu", "tools"):
            spread = shot["shut"]["spread"][island]
            if spread > LAYOUT_TOLERANCE_PX:
                failures.append(f"{name}: the {island} island's controls are {spread:.2f} px off one centre line")
    spread = desktop["shut"]["spread"]["topBar"]
    if spread > LAYOUT_TOLERANCE_PX:
        failures.append(f"desktop: the top bar's controls are {spread:.2f} px off one centre line")
    # The lens and zoom row, measured unfolded (a phone starts folded): its controls share one centre line.
    for name, shot in (("desktop", desktop), ("phone", phone)):
        unfolded = shot["unfolded"]
        if unfolded["controls"]["row"] < 2:
            failures.append(f"{name}: the lens and zoom row shows no controls when unfolded")
        spread = unfolded["spread"]["row"]
        if spread > LAYOUT_TOLERANCE_PX:
            failures.append(f"{name}: the lens and zoom row's controls are {spread:.2f} px off one centre line")
    for name, shot in (("desktop", desktop), ("phone", phone)):
        box, size = shot["open"]["menuBox"], shot["open"]["viewport"]
        if box is None:
            failures.append(f"{name}: the menu did not open")
        elif box["left"] < 0 or box["top"] < 0 or box["right"] > size["width"] or box["bottom"] > size["height"]:
            failures.append(f"{name}: the menu's box {box} is not on the {size['width']}x{size['height']} screen")
    return failures


@pytest.mark.parametrize("page", [name for name, _, _ in PAGES])
def test_page_layout(page: str, browser_run: dict) -> None:
    failures = _layout_failures(browser_run["pages"][page]["layout"])
    assert not failures, "\n".join(failures)
