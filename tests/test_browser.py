"""The viewer in headless Chrome: scripted runs on two kinds of page, compared with goldens.

Run with `scripts/check.sh --browser` (marker `browser`; the default pytest run leaves these out). They need Google
Chrome (GEMMY_CHROME overrides the path) and Node 22 or later (tests/browser/driver.mjs uses Node's WebSocket); without
either, they are skipped. The pages are the gemmy view page of the stishovite example and the hosted site's one page
(a run opens its start-screen card), both built here into a temporary folder and served on 127.0.0.1 by
`python -m http.server`.

Chrome draws with the GPU when it can (--use-angle=metal) and with SwiftShader only when WebGL 2 does not start.
GEMMY_BROWSER_RENDERER=software forces SwiftShader, for timing comparisons.

The pages are split over N Chrome processes that run at once (GEMMY_BROWSER_JOBS sets N; the default is the smaller of
the page count, half the CPUs and 2; 1 runs every page in one Chrome). Each Chrome has its own profile, so the pages of
different Chromes share no storage; the server only serves files, so one server serves them all. The view page
(LAST_ALONE) runs after the shards, alone in its own Chrome: its dock step timed out under load from the other Chromes.

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
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from itertools import zip_longest
from pathlib import Path
from typing import NamedTuple

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
VIEW_STISHOVITE = "view-stishovite"
SITE_FRONT = "site-front"
SITE_DROP = "site-drop"
SITE_PANEL = "site-panel"
VIEW_DROP = "view-drop"
VIEW_CLOSED = "view-closed"
SITE_EXAMPLE = "site-example"


class Page(NamedTuple):
    """One page of the run: its path under the server, the start-screen card clicked first (an example's name; None
    when the page opens on its scene), and the scenario the driver runs on it (tests/browser/driver.mjs)."""

    name: str
    path: str
    card: str | None
    scenario: str


# The front page opens on the start screen (home), so its run records home and then opens the stishovite card, which
# has the polyhedra to select. The drop scenarios run on the front page (drops) and on the single-file page (alert).
PAGES = [
    # The single-file page turns the open-other-files flag on with its address (?open=1; web/src/ui/open-files.ts): its
    # drops and New tab need it. The closed page is the same file with the flag off, the default.
    Page(VIEW_STISHOVITE, "/view-stishovite.html?open=1", None, "view"),
    Page(SITE_FRONT, "/site/index.html", "stishovite", "view"),
    Page(SITE_DROP, "/site/index.html", "stishovite", "drops"),
    Page(SITE_PANEL, "/site/index.html", "stishovite", "panel"),
    Page(VIEW_DROP, "/view-stishovite.html?open=1", None, "alert"),
    Page(VIEW_CLOSED, "/view-stishovite.html", None, "closed"),
    # The hosted site's one page: its card opens an example's structure (compiled in the page), with the style sections.
    Page(SITE_EXAMPLE, "/site/index.html", "stishovite", "structure"),
]
# Pages that run last, each alone in its own Chrome, after the parallel shards (see _drive_pages). The view page's dock
# step timed out under CPU load from the other Chromes (a stress run), so it runs with nothing else drawing.
LAST_ALONE = {VIEW_STISHOVITE}


def _program(name: str) -> str | None:
    """The executable for `name`, or None; GEMMY_CHROME may name a path or a command."""
    return shutil.which(os.environ.get("GEMMY_CHROME", name))


def _node_ok() -> bool:
    node = shutil.which("node")
    if node is None:
        return False
    major = subprocess.run([node, "-p", "process.versions.node.split('.')[0]"], capture_output=True, text=True)
    return major.returncode == 0 and int(major.stdout.strip()) >= 22


def _jobs() -> int:
    """How many Chromes run the pages at once: GEMMY_BROWSER_JOBS, else the smaller of the page count, half the CPUs
    and 2. Never more than there are pages. Two, not more: the draw-count steps time out when other test runs load the
    machine (four Chromes failed about half the runs under load, two kept the time near 50 s)."""
    override = os.environ.get("GEMMY_BROWSER_JOBS")
    if override:
        jobs = int(override)
    else:
        jobs = min(len(PAGES), (os.cpu_count() or 1) // 2, 2)
    return max(1, min(jobs, len(PAGES)))


def _shards(pages: list[Page], jobs: int) -> list[list[Page]]:
    """The pages split over `jobs` Chromes, round-robin in PAGES order (each shard keeps the order its pages have)."""
    return [pages[index::jobs] for index in range(jobs)]


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


# A config with a key the config format does not have: the drop names the file and the key.
BAD_CONFIG = "no_such_key = 1\n"
# The LAMMPS data files the drops scenario drops: two atom types with masses that no element has, so the reader asks for
# their labels (a file whose masses name an element is read without asking). Synthetic: the atoms of the fixture
# lammps-masses/mgo-masses.data with other masses. Once to teach the form, then as the files that auto-apply.
MASSES_FILES = [
    "masses-types.data",
    "masses-auto.data",
    "masses-third.data",
    "masses-fourth.data",
    "masses-fifth.data",
    "masses-sixth.data",
]
MASSES_DATA = """LAMMPS data, MgO with masses and no type names (synthetic)

8 atoms
2 atom types

0.0 4.2 xlo xhi
0.0 4.2 ylo yhi
0.0 4.2 zlo zhi

Masses

1 3.31
2 7.77

Atoms # atomic

1 1 0.0 0.0 0.0
2 2 2.1 0.0 0.0
3 2 0.0 2.1 0.0
4 1 2.1 2.1 0.0
5 2 0.0 0.0 2.1
6 1 2.1 0.0 2.1
7 1 0.0 2.1 2.1
8 2 2.1 2.1 2.1
"""


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
    # The files the drop scenarios drop (driver.mjs reads them from drop/): the stishovite POSCAR and its config, and a
    # LAMMPS dump with no type information, twice (the second one gets the saved map).
    drop = work / "drop"
    drop.mkdir()
    shutil.copy(ROOT / "examples" / "stishovite" / "POSCAR", drop / "POSCAR")
    shutil.copy(ROOT / "examples" / "stishovite" / "config.toml", drop / "config.toml")
    # The c60 cage, dropped by the panel scenario for the atom budget, in its own folder (dropped as POSCAR).
    (drop / "c60").mkdir()
    shutil.copy(ROOT / "examples" / "c60" / "POSCAR", drop / "c60" / "POSCAR")
    shutil.copy(ROOT / "examples" / "c60" / "config.toml", drop / "c60" / "config.toml")
    dump = FIXTURES / "structures" / "two-types" / "two-types.dump"
    shutil.copy(dump, drop / "two-types.dump")
    shutil.copy(dump, drop / "second-types.dump")
    # The config named for the POSCAR, the scene among the sidecars, a config that does not read, and LAMMPS data with
    # masses (informative: a saved map for it applies by itself), one per drop of the drops scenario.
    shutil.copy(ROOT / "examples" / "stishovite" / "config.toml", drop / "POSCAR.toml")
    shutil.copy(work / "dropped.json", drop / "scene.json")
    (drop / "bad-config.toml").write_text(BAD_CONFIG, encoding="utf-8")
    for name in MASSES_FILES:
        (drop / name).write_text(MASSES_DATA, encoding="utf-8")


def _drive(chrome: str, work: Path, port: int, flags: list[str], pages: list[Page]) -> subprocess.CompletedProcess:
    """One Chrome, started with `flags`, runs the driver over `pages`; then it is ended and its profile removed."""
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
        pages_json = json.dumps([page._asdict() for page in pages])
        return subprocess.run(
            ["node", str(DRIVER), str(devtools), f"http://127.0.0.1:{port}/", "/dropped.json", pages_json],
            capture_output=True,
            text=True,
            timeout=900,
        )
    finally:
        _stop(chrome_process)
        shutil.rmtree(profile, ignore_errors=True)


def _drive_pages(chrome: str, work: Path, port: int, flags: list[str]) -> list[subprocess.CompletedProcess]:
    """Every page under `flags`: the other pages' shards at once, then each LAST_ALONE page alone. With one job every
    page runs in one Chrome, as before. Stops after the shards when WebGL 2 did not start."""
    jobs = _jobs()
    alone = [page for page in PAGES if page.name in LAST_ALONE] if jobs > 1 else []
    shared = [page for page in PAGES if page not in alone]
    shards = _shards(shared, min(jobs, len(shared)))
    with ThreadPoolExecutor(max_workers=len(shards)) as pool:
        runs = list(pool.map(partial(_drive, chrome, work, port, flags), shards))
    if any(run.returncode == DRIVER_NO_WEBGL for run in runs):
        return runs
    for page in alone:
        runs.append(_drive(chrome, work, port, flags, [page]))
    return runs


def _merge(results: list[dict]) -> dict:
    """The shards' results as one: the renderer they all drew with, and every page's steps and layout, in PAGES order
    whatever order the shards finished in. A page that ran twice or not at all is an error."""
    renderers = {result["renderer"] for result in results}
    assert len(renderers) == 1, f"the shards drew with different renderers: {sorted(renderers)}"
    ran = [name for result in results for name in result["pages"]]
    assert sorted(ran) == sorted(page.name for page in PAGES), f"the shards ran these pages: {sorted(ran)}"
    by_name = {name: result["pages"][name] for result in results for name in result["pages"]}
    return {"renderer": renderers.pop(), "pages": {page.name: by_name[page.name] for page in PAGES}}


@pytest.fixture(scope="session")
def browser_run(tmp_path_factory):
    """Builds the pages, serves them, runs the driver over each shard of the pages at once, and returns the merged JSON
    (renderer and each page's steps)."""
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
            runs = _drive_pages(chrome, work, port, flags)
            if any(run.returncode == DRIVER_NO_WEBGL for run in runs):
                continue
            for run in runs:
                assert run.returncode == 0, f"the browser driver failed:\n{run.stderr[-4000:]}"
            return _merge([json.loads(run.stdout) for run in runs])
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


@pytest.mark.parametrize("page", [page.name for page in PAGES])
def test_exported_svg_has_only_colours_svg_tools_read(page: str, browser_run: dict) -> None:
    """The page's colour tokens are oklch; the SVG export writes sRGB hex, which Inkscape and Illustrator read."""
    for step in browser_run["pages"][page]["steps"]:
        if "svg" in step:
            assert "oklch(" not in step["svg"]
            assert "color-mix(" not in step["svg"]


@pytest.mark.parametrize("page", [page.name for page in PAGES])
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
    if svg is None:  # a page with no SVG export (the drop scenarios) has no SVG to compare
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
    # With the dock open (below 1560 px its toolbar takes a row of its own), the two rows of the top bar do not overlap,
    # and each keeps its controls on one centre line.
    rows = desktop["dock"]
    tools, title = rows["tools"], rows["title"]
    if tools is None or title is None:
        failures.append("desktop, dock open: a top-bar row has no controls")
    else:
        if not (tools["bottom"] <= title["top"] or title["bottom"] <= tools["top"]):
            failures.append(f"desktop, dock open: the toolbar row and the title row overlap ({tools} and {title})")
        for name, row in (("toolbar", tools), ("title", title)):
            if row["spread"] > LAYOUT_TOLERANCE_PX:
                failures.append(
                    f"desktop, dock open: the {name} row's controls are {row['spread']:.2f} px off one centre line"
                )
    # The file island never overlaps the toolbar island, in any arrangement. At the desktop width with the dock shut the
    # two share a row, and the file island ends a gap before the toolbar's left edge.
    for name, shot in (("desktop", desktop), ("phone", phone)):
        for state in ("shut", "unfolded", "open"):
            files, tools = shot[state]["fileIsland"], shot[state]["tools"]
            if files is None or tools is None:
                continue
            if (
                files["left"] < tools["right"]
                and tools["left"] < files["right"]
                and (files["top"] < tools["bottom"] and tools["top"] < files["bottom"])
            ):
                failures.append(f"{name} ({state}): the file island {files} overlaps the toolbar island {tools}")
    shut = desktop["shut"]
    if shut["fileIsland"] is not None and shut["tools"] is not None:
        gap = shut["gap"]
        if shut["fileIsland"]["right"] > shut["tools"]["left"] - gap + LAYOUT_TOLERANCE_PX:
            failures.append(
                f"desktop: the file island ends at {shut['fileIsland']['right']:.1f} px, past the toolbar's left edge "
                f"{shut['tools']['left']:.1f} px less the {gap:g} px gap"
            )
    # The file island is the top bar's only island on the left: its box holds the trigger (or the name as text) at one
    # height, the 36 px control and the island's padding, in the dropdown case and in the plain name.
    for name, shot in (("desktop", desktop), ("phone", phone)):
        files = shot["shut"]["fileIsland"]
        if files is not None and files["bottom"] - files["top"] > 60:
            failures.append(f"{name}: the file island is {files['bottom'] - files['top']:.1f} px tall")
    # The file island is as wide as its content and its padding: it does not stretch (its trigger, or its text).
    for name, shot in (("desktop", desktop), ("phone", phone)):
        island = shot["shut"]["fileIsland"]
        if island is None:
            failures.append(f"{name}: the file island is not drawn")
            continue
        slack = island["width"] - island["content"] - island["padding"]
        if slack > LAYOUT_TOLERANCE_PX:
            failures.append(
                f"{name}: the file island is {island['width']:.1f} px for {island['content']:.1f} px of content "
                f"and {island['padding']:g} px of padding"
            )
    # The toolbar's chevrons: one on each side its row has more on (none on a desktop, where the row does not overflow),
    # each inside the toolbar island (#tools), never over the message line under it.
    for name, shot in (("desktop", desktop), ("phone", phone)):
        drawn = sorted(chevron["side"] for chevron in shot["shut"]["chevrons"])
        more = sorted(side for side, on in shot["shut"]["toolsEdges"].items() if on)
        if drawn != more:
            failures.append(f"{name}: the toolbar's chevrons are on {drawn}, but its edges with more are {more}")
        if not all(chevron["inside"] for chevron in shot["shut"]["chevrons"]):
            failures.append(f"{name}: a toolbar chevron sits outside the toolbar island")
    for name, shot in (("desktop", desktop), ("phone", phone)):
        box, size = shot["open"]["menuBox"], shot["open"]["viewport"]
        if box is None:
            failures.append(f"{name}: the menu did not open")
        elif box["left"] < 0 or box["top"] < 0 or box["right"] > size["width"] or box["bottom"] > size["height"]:
            failures.append(f"{name}: the menu's box {box} is not on the {size['width']}x{size['height']} screen")
    failures += _edge_tab_failures(desktop["edgeTab"])
    return failures


# The edge tab (react/inspector-toggle.tsx) at the desktop width, read by the driver (measureEdgeTab). At rest it sits
# EDGE_PEEK_PX past the page's right edge. On hover, on keyboard focus and on a
# touch screen it is whole. Open, it is the chevron alone, at the islands' height, at the dock's left side.
EDGE_PEEK_PX = 4.0
ISLAND_PX = 44.0


def _edge_tab_failures(edge: dict) -> list[str]:
    failures = []
    rest, hover, focused, open_ = edge["rest"], edge["hover"], edge["focused"], edge["open"]
    width = rest["viewportWidth"]
    overhang = rest["box"]["right"] - width
    if abs(overhang - EDGE_PEEK_PX) > LAYOUT_TOLERANCE_PX:
        failures.append(
            f"desktop: the edge tab at rest reaches {overhang:.1f} px past the edge, not {EDGE_PEEK_PX:g} px"
        )
    names = [icon["name"] for icon in rest["icons"]]
    if names != ["lucide-chevron-left", "lucide-sliders-horizontal"]:
        failures.append(f"desktop: the edge tab at rest shows the icons {names}")
    if abs(rest["box"]["height"] - ISLAND_PX) > LAYOUT_TOLERANCE_PX:
        failures.append(
            f"desktop: the edge tab is {rest['box']['height']:.1f} px high, not the island's {ISLAND_PX:g} px"
        )
    if not rest["hitAtEdge"]:
        failures.append("desktop: the edge tab at rest does not take a press at the screen's edge")
    for name, state in (("hover", hover), ("keyboard focus", focused)):
        if abs(state["box"]["right"] - state["viewportWidth"]) > LAYOUT_TOLERANCE_PX:
            failures.append(f"desktop: the edge tab on {name} ends at {state['box']['right']:.1f} px, not the edge")
    if edge["peekMedia"] != ["(hover: hover)"]:
        failures.append(f"desktop: the edge tab's peek is in the media {edge['peekMedia']}, not (hover: hover)")
    if not focused["focusVisible"]:
        failures.append("desktop: the edge tab did not take a keyboard focus-visible")
    if [icon["name"] for icon in open_["icons"]] != ["lucide-chevron-right"]:
        failures.append(f"desktop: the open edge tab shows the icons {[icon['name'] for icon in open_['icons']]}")
    if abs(open_["box"]["height"] - ISLAND_PX) > LAYOUT_TOLERANCE_PX:
        failures.append(f"desktop: the open edge tab is {open_['box']['height']:.1f} px high, not {ISLAND_PX:g} px")
    if open_["dock"] is None or abs(open_["box"]["right"] - open_["dock"]) > LAYOUT_TOLERANCE_PX:
        failures.append(
            f"desktop: the open edge tab does not sit at the dock's left side ({open_['box']}, dock {open_['dock']})"
        )
    return failures


@pytest.mark.parametrize("page", [page.name for page in PAGES])
def test_page_layout(page: str, browser_run: dict) -> None:
    failures = _layout_failures(browser_run["pages"][page]["layout"])
    assert not failures, "\n".join(failures)


def _step(browser_run: dict, page: str, name: str) -> dict:
    return next(step for step in browser_run["pages"][page]["steps"] if step["name"] == name)


def test_a_gallery_card_opens_only_its_example_structure(browser_run: dict) -> None:
    # The start screen's card opens the example's structure as the page's only file (the front page opens no example by
    # default: its start screen is the one New tab), titled by the structure's file.
    home = _step(browser_run, SITE_FRONT, "home")
    step = _step(browser_run, SITE_FRONT, "open-card")
    assert home["title"] == "New tab" and home["files"] == 1, home
    assert step["files"] == 1, step["files"]
    assert step["title"] == "POSCAR", step["title"]


def test_the_example_page_opens_its_structure_with_the_style_sections(browser_run: dict) -> None:
    # The card opens the example's structure, compiled in the browser: its dock has the style sections, and the Atoms
    # section has the colour-scheme dropdown (the colours can be changed).
    step = _step(browser_run, SITE_EXAMPLE, "structure-page")
    assert {"Atoms", "Bonds", "Shapes", "Cell"} <= set(step["sections"]), step["sections"]
    assert step["colourScheme"] is True
    assert step["title"] == "POSCAR"  # the structure tab, named by its file


def test_a_dropped_structure_draws_what_the_example_draws(browser_run: dict) -> None:
    # The POSCAR alone compiles with the defaults, so it draws; with its config it draws the example's scene exactly.
    alone = _step(browser_run, SITE_DROP, "drop-poscar")
    assert alone["draws"]["draw"] > 0 and alone["alert"] is None
    with_config = _step(browser_run, SITE_DROP, "drop-poscar-config")
    assert with_config["alert"] is None
    assert with_config["draws"] == _step(browser_run, SITE_FRONT, "open-card")["draws"]


def test_a_lammps_file_without_types_asks_for_them_and_then_shows(browser_run: dict) -> None:
    assert _step(browser_run, SITE_DROP, "drop-lammps-form")["form"] is True
    applied = _step(browser_run, SITE_DROP, "type-form-apply")
    assert applied["form"] is False and applied["title"] == "two-types.dump" and applied["alert"] is None


def test_a_file_with_only_type_ids_is_not_applied_by_its_saved_map(browser_run: dict) -> None:
    # The form opens with the saved map as its suggestion, named after the preset, and focus is on the first label.
    again = _step(browser_run, SITE_DROP, "drop-lammps-preset")
    assert again["form"] is True and again["prompt"] == "Name the LAMMPS types"
    assert again["focus"] == "type-input-1"
    assert "Use two-types.dump" in again["presetButtons"]
    assert again["toast"]["shown"] is False


def test_a_saved_map_is_used_by_its_button_and_applied_with_apply(browser_run: dict) -> None:
    assert _step(browser_run, SITE_DROP, "preset-use")["labels"] == ["Na", "Cl"]
    applied = _step(browser_run, SITE_DROP, "preset-apply")
    assert applied["form"] is False and applied["title"] == "second-types.dump"


def test_an_informative_file_applies_its_saved_map_with_a_toast_that_offers_undo(browser_run: dict) -> None:
    auto = _step(browser_run, SITE_DROP, "drop-masses-auto")
    assert auto["form"] is False and auto["title"] == "masses-auto.data"
    assert auto["toast"]["shown"] is True and auto["toast"]["actions"] == ["Undo"]
    assert 'Used the saved type map "masses-types.data" for masses-auto.data.' in auto["toast"]["text"]


def test_undo_by_pointer_opens_the_form_and_the_next_load_asks_again(browser_run: dict) -> None:
    undone = _step(browser_run, SITE_DROP, "undo-pointer")
    assert undone["form"] is True and undone["toast"]["shown"] is False
    asked = _step(browser_run, SITE_DROP, "switch-back-asks")
    assert asked["form"] is True and asked["toast"]["shown"] is False


def test_undo_by_keyboard_reaches_the_button_with_tab_and_presses_enter(browser_run: dict) -> None:
    assert _step(browser_run, SITE_DROP, "drop-masses-third")["toast"]["actions"] == ["Undo"]
    undone = _step(browser_run, SITE_DROP, "undo-keyboard")
    assert undone["form"] is True and undone["toast"]["shown"] is False


def test_a_toast_expires_with_a_tab_switch(browser_run: dict) -> None:
    assert _step(browser_run, SITE_DROP, "drop-masses-fourth")["toast"]["actions"] == ["Undo"]
    assert _step(browser_run, SITE_DROP, "switch-expires-toast")["toast"]["shown"] is False


def test_a_toast_shows_once_per_load(browser_run: dict) -> None:
    back = _step(browser_run, SITE_DROP, "switch-back-once")
    assert back["title"] == "masses-fourth.data" and back["toast"]["shown"] is False


def test_a_second_note_replaces_the_first_and_its_action(browser_run: dict) -> None:
    toast = _step(browser_run, SITE_DROP, "second-note")["toast"]
    assert toast["shown"] is True and toast["actions"] == ["Undo"]
    assert "masses-sixth.data" in toast["text"] and "masses-fifth.data" not in toast["text"]


def test_a_bad_presets_import_says_why(browser_run: dict) -> None:
    assert "not a gemmy type presets file" in _step(browser_run, SITE_DROP, "import-bad")["alert"]


def test_a_bad_label_keeps_the_form_and_saves_nothing(browser_run: dict) -> None:
    bad = _step(browser_run, SITE_DROP, "label-qq")
    assert bad["fieldError"].startswith("Qq does not name an element")
    assert bad["applyDisabled"] is True and bad["values"] == ["Qq", "Cl"]
    assert bad["presetCount"] == _step(browser_run, SITE_DROP, "drop-two-types-again")["presetCount"]
    assert _step(browser_run, SITE_DROP, "label-good-apply")["form"] is False


def test_poscar_with_its_config_compiles_with_that_config(browser_run: dict) -> None:
    pair = _step(browser_run, SITE_DROP, "drop-poscar-pair")
    assert pair["alert"] is None and pair["draws"] == _step(browser_run, SITE_FRONT, "open-card")["draws"]


def test_a_scene_among_the_sidecars_is_refused(browser_run: dict) -> None:
    alert = _step(browser_run, SITE_DROP, "drop-scene-sidecar")["alert"]
    assert alert is not None and alert.startswith("Could not load POSCAR:") and "is a scene file" in alert


def test_a_config_error_starts_with_the_config_file_name(browser_run: dict) -> None:
    alert = _step(browser_run, SITE_DROP, "drop-bad-config")["alert"]
    reason = alert.removeprefix("Could not load POSCAR: ")
    assert reason.startswith("bad-config.toml: ") and "no_such_key" in reason


def test_a_switch_while_a_structure_loads_shows_nothing_for_that_tab(browser_run: dict) -> None:
    switched = _step(browser_run, SITE_DROP, "switch-while-loading")
    assert switched["draws"] == {"clear": 0, "draw": 0} and switched["alert"] is None
    assert _step(browser_run, SITE_DROP, "switch-clears-form")["form"] is False


def test_the_single_file_page_says_it_cannot_compile_a_structure(browser_run: dict) -> None:
    alert = _step(browser_run, VIEW_DROP, "drop-structure")["alert"]
    assert alert is not None and "cannot compile structures" in alert


# ---- the style panel on a structure tab (tests/browser/scenarios/panel.mjs). The instance counts are the frame's
# instanced draws: the atoms and the bonds, so a step that changes them has changed the scene the page drew.


def test_the_style_button_opens_the_dock_at_its_sections(browser_run: dict) -> None:
    opened = _step(browser_run, SITE_PANEL, "open-style")
    assert opened["sections"] == ["View", "Atoms", "Bonds", "Shapes", "Cell"]


def test_a_colour_pick_redraws_the_polyhedra_in_that_colour(browser_run: dict) -> None:
    picked = _step(browser_run, SITE_PANEL, "polyhedron-colour")
    assert picked["colour"] == "#00ff00ff"  # the colour row takes alpha: eight digits while solid
    assert picked["draws"]["draw"] > 0


def test_a_bond_window_is_typed_from_the_keyboard(browser_run: dict) -> None:
    # The window's ends are read back as typed. The drawn count does not follow it yet on this structure (the automatic
    # O-Si bonds keep the count), so the count is recorded, not asserted.
    assert _step(browser_run, SITE_PANEL, "bond-add")["window"] == ["1.66", "1.91"]
    assert _step(browser_run, SITE_PANEL, "bond-narrow")["window"] == ["1.66", "1.78"]
    assert _step(browser_run, SITE_PANEL, "bond-widen")["window"] == ["1.66", "2.00"]


def test_the_view_section_sets_the_atoms_check_and_the_outline_width(browser_run: dict) -> None:
    # The View section (react/style-panel/view-section.tsx) is the dock's first: its check and its list are read back.
    toggled = _step(browser_run, VIEW_STISHOVITE, "toggle-atoms")
    assert toggled["checks"]["Atoms"] is False and toggled["checks"]["Cell box"] is True
    assert _step(browser_run, VIEW_STISHOVITE, "outline-bold")["width"] == "Bold"


def test_one_cell_draws_fewer_instances_than_the_supercell(browser_run: dict) -> None:
    assert (
        _step(browser_run, SITE_PANEL, "supercell-one")["instances"]
        < _step(browser_run, SITE_PANEL, "bond-widen")["instances"]
    )


def test_the_i_key_toggles_the_details_card_on_a_scene(browser_run: dict) -> None:
    first = _step(browser_run, VIEW_STISHOVITE, "details-key-first")["expanded"]
    second = _step(browser_run, VIEW_STISHOVITE, "details-key-second")["expanded"]
    assert {first, second} == {"true", "false"}


def test_crossing_to_phone_keeps_the_sheet_opened_last_and_moves_focus_off_the_edge_tab(browser_run: dict) -> None:
    before = _step(browser_run, VIEW_STISHOVITE, "sheets-both-open")
    assert before["details"] == "true" and before["dock"] is True and before["focus"] == "inspector-tab"
    after = _step(browser_run, VIEW_STISHOVITE, "sheets-phone")
    assert (after["details"], after["dock"], after["focus"]) == ("false", True, "customize-button")


def test_focus_goes_to_the_start_screen_on_new_tab_and_to_the_file_trigger_on_close(browser_run: dict) -> None:
    assert _step(browser_run, SITE_DROP, "new-tab-open")["focusInStart"] is True
    assert _step(browser_run, SITE_DROP, "new-tab-closed")["focusCurrent"] == "file-trigger"


def test_new_tab_opens_the_start_screen_once_and_is_transient(browser_run: dict) -> None:
    before = _step(browser_run, SITE_DROP, "new-tab-before")
    opened = _step(browser_run, SITE_DROP, "new-tab-open")
    assert before["title"] != "New tab" and opened["title"] == "New tab"
    assert opened["files"] == before["files"] + 1, "the start screen was not opened as one file"
    # The New tab is not a row of the list, even while it is the current view: no row is checked.
    assert "New tab" not in opened["items"] and opened["checked"] == 0
    again = _step(browser_run, SITE_DROP, "new-tab-pressed-again")
    assert again["title"] == "New tab" and again["files"] == opened["files"], "a second New tab was added"
    # Leaving the New tab for a file closes it: the list has only files, and the "+" is back.
    switched = _step(browser_run, SITE_DROP, "new-tab-switched")
    assert switched["files"] == before["files"] and "New tab" not in switched["items"]
    assert switched["title"] != "New tab" and switched["plus"] is True
    files_start = _step(browser_run, VIEW_STISHOVITE, "files-start")
    assert files_start["title"] == "New tab" and files_start["files"] == 3


def test_the_plus_is_shown_only_while_no_start_tab_exists(browser_run: dict) -> None:
    assert _step(browser_run, SITE_DROP, "new-tab-before")["plus"] is True
    assert _step(browser_run, SITE_DROP, "new-tab-open")["plus"] is False
    assert _step(browser_run, SITE_DROP, "new-tab-pressed-again")["plus"] is False
    assert _step(browser_run, SITE_DROP, "new-tab-switched")["plus"] is True
    plus = _step(browser_run, SITE_DROP, "new-tab-plus")
    assert plus["plus"] is False and plus["title"] == "New tab"
    assert _step(browser_run, SITE_DROP, "new-tab-closed")["plus"] is True


def test_the_file_island_spaces_its_right_end_evenly(browser_run: dict) -> None:
    # The chevron, the separator and the + icon, and the island's edge: the gaps between them are equal, within 1 px.
    spacing = browser_run["pages"][SITE_DROP]["layout"]["desktop"]["shut"]["spacing"]
    assert spacing is not None, "the + is not shown in the file island"
    gaps = [spacing["chevronToRule"], spacing["ruleToPlus"], spacing["plusToEdge"]]
    assert max(gaps) - min(gaps) <= LAYOUT_TOLERANCE_PX, f"the gaps differ: {gaps}"


def test_one_popup_at_a_time_the_file_menu_closes_the_export_menu(browser_run: dict) -> None:
    step = _step(browser_run, SITE_DROP, "popup-one-at-a-time")
    assert step["fileMenu"] is True and step["exportMenu"] is False


def test_the_dropdown_has_no_start_screen_item_and_the_export_menu_has_no_new_tab(browser_run: dict) -> None:
    labels = [item["label"] for item in _step(browser_run, VIEW_STISHOVITE, "files-three")["items"]]
    assert "New tab" not in labels and "Start screen" not in labels
    items = _step(browser_run, VIEW_STISHOVITE, "menu-start")["menu"]["items"]
    assert items[0] == "Copy link" and "New tab" not in items


def test_no_toolbar_chevron_is_drawn_on_the_start_screen(browser_run: dict) -> None:
    # The toolbar is hidden on the start screen: no chevron is drawn, and none outside the toolbar island in any step.
    home = _step(browser_run, SITE_FRONT, "home")
    assert home["chevrons"] == 0 and home["files"] == 1 and home["menu"] == "true"
    assert home["title"] == "New tab", "the start screen's file is not named New tab"
    for page in PAGES:
        for step in browser_run["pages"][page.name]["steps"]:
            assert step["chevronsOutside"] == 0, f"{page.name} {step['name']}: a chevron is drawn outside #tools"


def test_the_file_menu_lists_every_open_file_and_fits_the_window(browser_run: dict) -> None:
    long = _step(browser_run, SITE_DROP, "file-menu-long")
    assert long["items"] == long["files"] and long["items"] > 3
    assert long["fits"] is True, "the file menu runs off the window"


def test_three_files_give_a_menu_of_three_with_the_current_one_checked(browser_run: dict) -> None:
    three = _step(browser_run, VIEW_STISHOVITE, "files-three")
    assert [item["checked"] for item in three["items"]] == [False, False, True]
    assert len({item["label"] for item in three["items"]}) == 3


def test_a_file_is_closed_from_the_keyboard_and_the_focus_stays_on_the_trigger(browser_run: dict) -> None:
    probe = browser_run["pages"][SITE_DROP]["probes"]["keyboard-close"]
    assert probe["target"] is not None and probe["highlighted"] == probe["target"], (
        "the arrow keys did not reach the file"
    )
    assert probe["after"] == probe["before"] - 1
    assert probe["closed"] is True
    assert probe["focus"] == "file-trigger"


def test_a_file_keeps_its_view_and_selection_when_the_page_switches_away_and_back(browser_run: dict) -> None:
    probe = browser_run["pages"][VIEW_STISHOVITE]["probes"]["files-back-view"]
    assert probe["after"] == probe["before"], "the file did not come back with its zoom and selection"


def test_a_style_edit_keeps_the_selected_object_by_its_identity(browser_run: dict) -> None:
    probe = browser_run["pages"][SITE_PANEL]["probes"]["colour-edit-readout"]
    assert probe["before"] is not None and "Centre" in probe["before"], "nothing was selected before the edit"
    assert probe["after"] == probe["before"], "the style edit cleared or changed the selection"


def test_a_phone_sheet_has_a_close_button_and_escape_closes_it_to_the_customize_button(browser_run: dict) -> None:
    probe = browser_run["pages"][SITE_PANEL]["probes"]["phone-sheet-escape"]
    assert probe["closeButton"] is True, "the phone style sheet has no Close button"
    assert probe["focus"] == "customize-button", "Escape did not close the focused phone sheet to its button"


def test_choosing_the_file_on_the_stage_changes_nothing(browser_run: dict) -> None:
    probe = browser_run["pages"][VIEW_STISHOVITE]["probes"]["same-file-pick"]
    assert probe["after"] == probe["before"], "choosing the current file changed the view"


def test_closing_the_current_file_moves_to_its_right_neighbour_and_the_focus_to_the_trigger(browser_run: dict) -> None:
    three = _step(browser_run, VIEW_STISHOVITE, "files-three")
    closed = _step(browser_run, VIEW_STISHOVITE, "files-close-middle")
    assert closed["file"] == three["items"][2]["label"], "the closed file's right neighbour is not the one shown"
    assert closed["files"] == 2
    assert closed["focus"] == "file-trigger"


def test_a_hex_typed_in_the_colour_field_is_the_colour_and_the_hue_bar_moves_it(browser_run: dict) -> None:
    assert _step(browser_run, SITE_PANEL, "polyhedron-colour-hex")["colour"] == "#0000ffff"
    dragged = _step(browser_run, SITE_PANEL, "polyhedron-colour-drag")["colour"]
    assert re.fullmatch(r"#[0-9a-f]{8}", dragged) and dragged != "#0000ffff"


def test_the_exported_toml_holds_the_edited_values(browser_run: dict) -> None:
    exported = _step(browser_run, SITE_PANEL, "export-toml")
    assert exported["status"] == "Saved POSCAR.toml."
    text = exported["text"]
    assert 'structure = "POSCAR"' in text
    assert "supercell = [ 1, 1, 1 ]" in text
    assert re.search(r"color = \[ 0, (1|255), 0, 1 \]", text)
    assert re.search(r"max = 2(\.0)?\b", text)


def test_the_exported_json_holds_the_edited_values(browser_run: dict) -> None:
    config = json.loads(_step(browser_run, SITE_PANEL, "export-json")["text"])
    assert config["structure"] == "POSCAR"
    assert config["cells"]["supercell"] == [1, 1, 1]
    red, green, blue = config["polyhedra"][0]["color"][:3]
    assert (red, blue) == (0, 0) and green > 0
    assert config["bonds"][0]["max"] == 2


# ---- the open-other-files flag (web/src/ui/open-files.ts), off on the closed page (scenarios/closed.mjs).


def test_with_the_open_flag_off_one_file_is_its_name_as_text(browser_run: dict) -> None:
    island = _step(browser_run, VIEW_CLOSED, "closed-file-island")
    assert island["trigger"] is False and island["menu"] == "false", "the island shows a menu with the flag off"
    assert island["plus"] is False, "the New tab plus shows with the flag off"
    assert island["title"], "the file's name is not shown as text"


def test_with_the_open_flag_off_the_export_menu_leads_with_copy_link_and_has_no_new_tab(browser_run: dict) -> None:
    items = _step(browser_run, VIEW_CLOSED, "closed-menu")["menu"]["items"]
    assert items[0] == "Copy link" and "New tab" not in items


def test_with_the_open_flag_off_a_dropped_file_is_ignored(browser_run: dict) -> None:
    before = _step(browser_run, VIEW_CLOSED, "closed-file-island")["files"]
    dropped = _step(browser_run, VIEW_CLOSED, "closed-drop")
    assert dropped["files"] == before, "a dropped file added a file with the open flag off"
    assert dropped["alert"] is None and dropped["outline"] is False


def test_a_phone_tap_opens_the_selection_card(browser_run: dict) -> None:
    tapped = _step(browser_run, SITE_PANEL, "phone-tap-atom")
    assert tapped["card"], "the tap on a phone did not open the selection card"
    assert tapped["dock"] is False, "the card and the dock are one sheet at a time on a phone"


# The top of the phone's bottom-right island at 393 x 852. The sheets sit 64 px above the bottom inset (style.css).
PHONE_ISLAND_TOP = 792


def test_customize_opens_the_style_sections_as_a_phone_sheet(browser_run: dict) -> None:
    opened = _step(browser_run, SITE_PANEL, "phone-customize")
    assert opened["sections"] == ["View", "Atoms", "Bonds", "Shapes", "Cell"]
    assert opened["card"] is False, "the sheet shuts the details card"
    assert opened["sheet"]["bottom"] <= PHONE_ISLAND_TOP, "the sheet covers the bottom row's island"
