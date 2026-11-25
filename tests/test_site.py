"""The hosted site (scripts/build_site.sh, gemmy view --hosted): one shared viewer and stylesheet, named by the hash of
their content, a scene.json.gz per committed example, and example pages that load the shared viewer rather than carry
their own copy. Built locally, no network. Tests that need the built site are `slow` (scripts/check.sh --slow); the rest
check the gallery files and the manifest code without building anything."""

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

from gemmy.view import EXAMPLES_FILE, GALLERY_KEYS, write_hosted_site

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
# The start screen's pictures: pre-rendered by scripts/render_thumbnails.sh, one PNG per committed example.
THUMBNAILS = ROOT / "docs" / "images" / "gallery"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


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


@pytest.mark.slow
def test_the_shared_files_are_named_by_the_hash_of_their_content(site: Path) -> None:
    viewer, style = _shared(site)
    assert (site / viewer).stat().st_size > 100_000
    for name in (viewer, style):
        match = VIEWER_NAME.fullmatch(name) or STYLE_NAME.fullmatch(name)
        assert match, name
        assert hashlib.sha256((site / name).read_bytes()).hexdigest()[:10] == match.group(1)
    assert not (site / "viewer.js").exists() and not (site / "style.css").exists()


@pytest.mark.slow
def test_every_page_references_the_hashed_names_and_no_others(site: Path) -> None:
    viewer, style = _shared(site)
    pages = _pages(site)
    assert set(pages) == {"index.html", "view/index.html"} | {f"{name}/index.html" for name in EXAMPLES}
    for path, page in pages.items():
        referenced = {match for match in REFERENCE.findall(page)}
        assert style in referenced, path
        assert not re.search(r'(?:href|src)="(?:\.\./)?(?:viewer|style)\.(?:js|css)"', page), path
        assert viewer in referenced, path


@pytest.mark.slow
def test_the_front_page_is_the_viewer_with_every_example_as_a_default_tab(site: Path) -> None:
    assert sorted(BUILD_ORDER) == EXAMPLES
    page = (site / "index.html").read_text(encoding="utf-8")
    assert '<script type="module" src="viewer.' in page  # the shared viewer, not an inlined copy
    assert DEFAULT_SCENE.findall(page) == [f"{name}/scene.json.gz" for name in BUILD_ORDER]


@pytest.mark.parametrize("name", EXAMPLES)
@pytest.mark.slow
def test_each_example_has_its_scene_gzipped_and_a_small_page(site: Path, name: str) -> None:
    scene = json.loads(gzip.decompress((site / name / "scene.json.gz").read_bytes()))
    assert scene["schema_version"] == 2
    page = (site / name / "index.html").read_text(encoding="utf-8")
    assert len(page.encode("utf-8")) < PAGE_BYTES_LIMIT
    assert '<script type="module">' not in page  # no inlined copy of the viewer
    assert DEFAULT_SCENE.findall(page) == ["scene.json.gz"]  # its own scene file, its only default


TINY_SCENE = {
    "source_comment": "tiny",
    "materials": {"m": {"base_color": [1, 0, 0, 1]}},
    "points": [{"id": "p0", "element": "O", "position": [0, 0, 0]}],
    "primitives": {"atoms": [{"id": "a0", "point_id": "p0", "radius": 1.0, "material_id": "m", "element": "O"}]},
    "cell": {"origin": [0, 0, 0], "vectors": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
}


def _scene_file(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(TINY_SCENE), encoding="utf-8")
    return path


def _gallery(folder: Path, name: str, entry: object) -> None:
    (folder / name).mkdir(parents=True, exist_ok=True)
    (folder / name / "gallery.json").write_text(json.dumps(entry), encoding="utf-8")


def _thumbnail(folder: Path, name: str, data: bytes = PNG_SIGNATURE + b"picture") -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.png").write_bytes(data)


def test_examples_json_lists_the_scenes_in_order(tmp_path: Path) -> None:
    scenes = [_scene_file(tmp_path / "in" / f"{name}.json") for name in ("zeta", "alpha")]
    for name in ("zeta", "alpha"):
        _gallery(tmp_path / "gallery", name, {"title": name.title(), "description": f"{name} scene"})
        _thumbnail(tmp_path / "thumbs", name)
    out = tmp_path / "site"
    write_hosted_site(scenes, out, gallery=tmp_path / "gallery", thumbnails=tmp_path / "thumbs")
    assert json.loads((out / EXAMPLES_FILE).read_text(encoding="utf-8")) == [
        {
            "name": "zeta",
            "title": "Zeta",
            "description": "zeta scene",
            "scene": "zeta/scene.json.gz",
            "thumbnail": "zeta/thumbnail.png",
        },
        {
            "name": "alpha",
            "title": "Alpha",
            "description": "alpha scene",
            "scene": "alpha/scene.json.gz",
            "thumbnail": "alpha/thumbnail.png",
        },
    ]
    assert (out / "zeta" / "thumbnail.png").read_bytes() == PNG_SIGNATURE + b"picture"


def test_examples_json_is_written_only_with_a_gallery(tmp_path: Path) -> None:
    write_hosted_site([_scene_file(tmp_path / "in" / "one.json")], tmp_path / "site")
    assert not (tmp_path / "site" / EXAMPLES_FILE).exists()
    assert not (tmp_path / "site" / "one" / "thumbnail.png").exists()


def test_a_gallery_needs_thumbnails_and_thumbnails_need_a_gallery(tmp_path: Path) -> None:
    scene = _scene_file(tmp_path / "in" / "one.json")
    _gallery(tmp_path / "gallery", "one", {"title": "One", "description": "one scene"})
    with pytest.raises(ValueError, match="needs thumbnails"):
        write_hosted_site([scene], tmp_path / "site", gallery=tmp_path / "gallery")
    with pytest.raises(ValueError, match="need a gallery"):
        write_hosted_site([scene], tmp_path / "site", thumbnails=tmp_path / "thumbs")
    assert not (tmp_path / "site").exists()


def test_a_scene_without_a_thumbnail_stops_the_build_before_anything_is_written(tmp_path: Path) -> None:
    scene = _scene_file(tmp_path / "in" / "one.json")
    _gallery(tmp_path / "gallery", "one", {"title": "One", "description": "one scene"})
    _thumbnail(tmp_path / "thumbs", "other")
    with pytest.raises(ValueError, match="no thumbnail for scene one"):
        write_hosted_site([scene], tmp_path / "site", gallery=tmp_path / "gallery", thumbnails=tmp_path / "thumbs")
    assert not (tmp_path / "site").exists()


@pytest.mark.parametrize(
    ("entry", "message"),
    [
        (None, "no gallery entry for scene one"),
        ({"title": "T"}, "exactly the keys"),
        ({"title": "T", "description": "D", "extra": 1}, "exactly the keys"),
        ({"title": 1, "description": "D"}, "must be strings"),
    ],
)
def test_a_bad_gallery_entry_stops_the_build_before_anything_is_written(
    tmp_path: Path, entry: object, message: str
) -> None:
    scene = _scene_file(tmp_path / "in" / "one.json")
    if entry is not None:
        _gallery(tmp_path / "gallery", "one", entry)
    _thumbnail(tmp_path / "thumbs", "one")
    with pytest.raises(ValueError, match=message):
        write_hosted_site([scene], tmp_path / "site", gallery=tmp_path / "gallery", thumbnails=tmp_path / "thumbs")
    assert not (tmp_path / "site").exists()


def test_every_example_has_a_gallery_entry_and_the_build_lists_them_all() -> None:
    assert sorted(BUILD_ORDER) == EXAMPLES
    for name in BUILD_ORDER:
        entry = json.loads((ROOT / "examples" / name / "gallery.json").read_text(encoding="utf-8"))
        assert sorted(entry) == sorted(GALLERY_KEYS)
        assert all(isinstance(value, str) and value for value in entry.values())


def test_every_example_has_a_thumbnail_picture() -> None:
    for name in BUILD_ORDER:
        assert (THUMBNAILS / f"{name}.png").read_bytes().startswith(PNG_SIGNATURE), name


@pytest.mark.slow
def test_examples_json_lists_every_example_in_order_and_each_scene_exists(site: Path) -> None:
    entries = json.loads((site / EXAMPLES_FILE).read_text(encoding="utf-8"))
    assert [entry["name"] for entry in entries] == BUILD_ORDER
    for entry in entries:
        assert set(entry) == {"name", "title", "description", "scene", "thumbnail"}
        assert entry["scene"] == f"{entry['name']}/scene.json.gz"
        assert (site / entry["scene"]).is_file()
        assert entry["thumbnail"] == f"{entry['name']}/thumbnail.png"
        assert (site / entry["thumbnail"]).read_bytes().startswith(PNG_SIGNATURE)
