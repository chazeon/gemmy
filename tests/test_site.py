"""The hosted site (scripts/build_site.sh, gemmy view --hosted): one shared viewer and stylesheet, named by the hash of
their content, a scene.json.gz per committed example, and example pages that load the shared viewer rather than carry
their own copy. Built locally, no network."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = sorted(p.parent.name for p in (ROOT / "examples").glob("*/config.toml"))
# The examples in the order scripts/build_site.sh compiles them: the front page's tabs follow this order.
BUILD_ORDER = re.search(r"for example in ([^;]+);", (ROOT / "scripts" / "build_site.sh").read_text()).group(1).split()
GEMMY = Path(sys.executable).with_name("gemmy")  # the console script of this environment
# A page with its viewer inline is over 200 KB; the example pages are a few KB and load the shared viewer.
PAGE_BYTES_LIMIT = 30_000
HASH = r"[0-9a-f]{10}"  # gemmy.view.HASH_CHARS
VIEWER_NAME = re.compile(rf"viewer\.({HASH})\.js")
STYLE_NAME = re.compile(rf"style\.({HASH})\.css")
# A reference to a file in a page (href or src), relative to the page's folder.
REFERENCE = re.compile(r'(?:href|src)="(?:\.\./)?([^"/]+)"')
# The default scenes a page opens, in document order (the loader reads them the same way).
DEFAULT_SCENE = re.compile(r'<meta name="gemmy-default-scene" content="([^"]*)">')


@pytest.fixture(scope="module")
def site(tmp_path_factory: pytest.TempPathFactory) -> Path:
    if not GEMMY.exists():
        pytest.skip("the gemmy console script is not installed in this environment")
    out = tmp_path_factory.mktemp("site")
    env = {**os.environ, "OUT": str(out), "GEMMY": str(GEMMY)}
    subprocess.run([str(ROOT / "scripts" / "build_site.sh")], env=env, check=True, capture_output=True)
    return out


def _shared(site: Path) -> tuple[str, str]:
    """The one viewer and the one stylesheet at the site root, by name."""
    viewers = [p.name for p in site.glob("viewer.*.js")]
    styles = [p.name for p in site.glob("style.*.css")]
    assert len(viewers) == 1 and len(styles) == 1, (viewers, styles)
    return viewers[0], styles[0]


def _pages(site: Path) -> dict[str, str]:
    """Every HTML page of the site, by its path relative to the site root."""
    return {str(p.relative_to(site)): p.read_text(encoding="utf-8") for p in site.rglob("*.html")}


def test_the_shared_files_are_named_by_the_hash_of_their_content(site: Path) -> None:
    viewer, style = _shared(site)
    assert (site / viewer).stat().st_size > 100_000
    for name in (viewer, style):
        match = VIEWER_NAME.fullmatch(name) or STYLE_NAME.fullmatch(name)
        assert match, name
        assert hashlib.sha256((site / name).read_bytes()).hexdigest()[:10] == match.group(1)
    assert not (site / "viewer.js").exists() and not (site / "style.css").exists()


def test_every_page_references_the_hashed_names_and_no_others(site: Path) -> None:
    viewer, style = _shared(site)
    pages = _pages(site)
    assert set(pages) == {"index.html", "view/index.html"} | {f"{name}/index.html" for name in EXAMPLES}
    for path, page in pages.items():
        referenced = {match for match in REFERENCE.findall(page)}
        assert style in referenced, path
        assert not re.search(r'(?:href|src)="(?:\.\./)?(?:viewer|style)\.(?:js|css)"', page), path
        assert viewer in referenced, path


def test_the_front_page_is_the_viewer_with_every_example_as_a_default_tab(site: Path) -> None:
    assert sorted(BUILD_ORDER) == EXAMPLES
    page = (site / "index.html").read_text(encoding="utf-8")
    assert '<script type="module" src="viewer.' in page  # the shared viewer, not an inlined copy
    assert DEFAULT_SCENE.findall(page) == [f"{name}/scene.json.gz" for name in BUILD_ORDER]


@pytest.mark.parametrize("name", EXAMPLES)
def test_each_example_has_its_scene_gzipped_and_a_small_page(site: Path, name: str) -> None:
    scene = json.loads(gzip.decompress((site / name / "scene.json.gz").read_bytes()))
    assert scene["schema_version"] == 2
    page = (site / name / "index.html").read_text(encoding="utf-8")
    assert len(page.encode("utf-8")) < PAGE_BYTES_LIMIT
    assert '<script type="module">' not in page  # no inlined copy of the viewer
    assert DEFAULT_SCENE.findall(page) == ["scene.json.gz"]  # its own scene file, its only default
