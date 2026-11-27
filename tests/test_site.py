"""The hosted site (scripts/build_site.sh, gemmy view --hosted): one viewer page at the root, the shared viewer and
stylesheet named by the hash of their content, examples.json, and per committed example a data folder (its structure
and config, the thumbnail) that the root page's gallery opens. Built locally, no network. Tests that need the built site
are `slow` (scripts/check.sh --slow); the rest check the gallery files, the folders and the head code without building
anything."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path

import pytest

from gemmy.site import EXAMPLES_FILE, FRONT_TITLE, GALLERY_KEYS, HASH_CHARS, SITE_DESCRIPTION, write_hosted_site

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = sorted(p.parent.name for p in (ROOT / "examples").glob("*/config.toml"))
# The committed examples in gallery order: the start screen's cards follow it.
BUILD_ORDER = (ROOT / "scripts" / "examples.txt").read_text(encoding="utf-8").split()
GEMMY = Path(sys.executable).with_name("gemmy")  # the console script of this environment
HASH = rf"[0-9a-f]{{{HASH_CHARS}}}"  # the hex digits of a shared file's name
VIEWER_NAME = re.compile(rf"viewer\.({HASH})\.js")
STYLE_NAME = re.compile(rf"style\.({HASH})\.css")
COMPILER_NAME = re.compile(rf"compile\.({HASH})\.js")
# A reference to a shared file in the page (href or src), relative to the site root.
REFERENCE = re.compile(r'(?:href|src)="([^"/]+)"')
# The site's address the build uses by default (scripts/build_site.sh SITE_URL).
SITE_URL = "https://chazeon.github.io/gemmy/"
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


class _Head(HTMLParser):
    """The head of a page: its lang, title, meta and link elements, as the browser or a crawler reads them."""

    def __init__(self) -> None:
        super().__init__()
        self.lang: str | None = None
        self.title: str | None = None
        self.metas: list[dict[str, str | None]] = []
        self.links: list[dict[str, str | None]] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "html":
            self.lang = values.get("lang")
        elif tag == "meta":
            self.metas.append(values)
        elif tag == "link":
            self.links.append(values)
        elif tag == "title":
            self._in_title = True
            self.title = ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title = (self.title or "") + data

    def content(self, value: str) -> str | None:
        """The content of the meta whose `name` or `property` is `value` (None when there is none)."""
        for meta in self.metas:
            if meta.get("name") == value or meta.get("property") == value:
                return meta.get("content")
        return None

    def canonical(self) -> str | None:
        return next((link["href"] for link in self.links if link.get("rel") == "canonical"), None)


def _head_of(page: str) -> _Head:
    parser = _Head()
    parser.feed(page)
    return parser


def _shared(site: Path) -> tuple[str, str, str]:
    """The one viewer, the one stylesheet and the one structure compiler at the site root, by name."""
    names = {
        "viewer": [p.name for p in site.glob("viewer.*.js")],
        "style": [p.name for p in site.glob("style.*.css")],
        "compile": [p.name for p in site.glob("compile.*.js")],
    }
    assert all(len(found) == 1 for found in names.values()), names
    return names["viewer"][0], names["style"][0], names["compile"][0]


def _structure_of(name: str) -> tuple[str, list[str]]:
    """The structure file and the config's files for an example, as its config names them (the config's own name is
    config.toml, and the structure and the files it names come from the config's folder)."""
    config = tomllib.loads((ROOT / "examples" / name / "config.toml").read_text(encoding="utf-8"))
    names = [config["structure"]]
    if isinstance(config.get("labels"), dict) and config["labels"].get("file"):
        names.append(config["labels"]["file"])
    return names[0], names[1:]


@pytest.mark.slow
def test_the_shared_files_are_named_by_the_hash_of_their_content(site: Path) -> None:
    viewer, style, compiler = _shared(site)
    assert (site / viewer).stat().st_size > 100_000
    for name, pattern in ((viewer, VIEWER_NAME), (style, STYLE_NAME), (compiler, COMPILER_NAME)):
        match = pattern.fullmatch(name)
        assert match, name
        assert hashlib.sha256((site / name).read_bytes()).hexdigest()[:HASH_CHARS] == match.group(1)
    assert not (site / "viewer.js").exists() and not (site / "style.css").exists()


@pytest.mark.slow
def test_the_site_has_one_page_and_the_folders_hold_data_only(site: Path) -> None:
    """The root page is the only HTML page: no per-example page and no view/ page. An example's folder holds its
    structure, its config and the files the config names, and its thumbnail, and nothing else."""
    assert sorted(p.relative_to(site).as_posix() for p in site.rglob("*.html")) == ["index.html"]
    for name in EXAMPLES:
        structure, sidecars = _structure_of(name)
        assert sorted(p.name for p in (site / name).iterdir()) == sorted(
            [structure, "config.toml", *sidecars, "thumbnail.png"]
        ), name
        assert not (site / name / "scene.json.gz").exists()  # the structure is the example's scene


@pytest.mark.slow
def test_the_front_page_is_the_viewer_with_the_start_screen(site: Path) -> None:
    assert sorted(BUILD_ORDER) == EXAMPLES
    page = (site / "index.html").read_text(encoding="utf-8")
    viewer, style, compiler = _shared(site)
    assert set(REFERENCE.findall(page)) >= {viewer, style}  # the shared files, not inlined copies
    assert f'content="{compiler}"' in page  # the compiler is named by its meta
    assert '<script type="module">' not in page


@pytest.mark.slow
def test_the_front_page_head_names_the_site_and_its_first_example(site: Path) -> None:
    head = _head_of((site / "index.html").read_text(encoding="utf-8"))
    assert head.lang == "en"
    assert head.title == FRONT_TITLE
    assert head.content("description") == SITE_DESCRIPTION
    assert head.canonical() == SITE_URL
    assert head.content("og:url") == SITE_URL
    assert head.content("og:title") == FRONT_TITLE
    assert head.content("og:description") == SITE_DESCRIPTION
    assert head.content("og:type") == "website"
    assert head.content("twitter:card") == "summary_large_image"
    first = BUILD_ORDER[0]
    assert head.content("og:image") == f"{SITE_URL}{first}/thumbnail.png"
    assert (site / first / "thumbnail.png").is_file()
    width, height = struct.unpack(">II", (THUMBNAILS / f"{first}.png").read_bytes()[16:24])
    assert head.content("og:image:width") == str(width)
    assert head.content("og:image:height") == str(height)


@pytest.mark.parametrize("name", EXAMPLES)
@pytest.mark.slow
def test_each_example_folder_holds_its_structure_and_config(site: Path, name: str) -> None:
    """The page compiles in the browser, so the folder has the structure file, the config (the only config: a second
    one would be a second candidate) and the files the config names, each the same bytes as the example's."""
    structure, sidecars = _structure_of(name)
    folder = site / name
    assert (folder / structure).read_bytes() == (ROOT / "examples" / name / structure).read_bytes()
    assert (folder / "config.toml").read_bytes() == (ROOT / "examples" / name / "config.toml").read_bytes()
    assert not (folder / "config.json").exists()
    for sidecar in sidecars:
        assert (folder / sidecar).read_bytes() == (ROOT / "examples" / name / sidecar).read_bytes()


TINY_SCENE = {
    "source_comment": "tiny",
    "materials": {"m": {"base_color": [1, 0, 0, 1]}},
    "points": [{"id": "p0", "element": "O", "label": "O", "position": [0, 0, 0]}],
    "primitives": {
        "atoms": [{"id": "a0", "point_id": "p0", "radius": 1.0, "material_id": "m", "element": "O", "label": "O"}]
    },
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


def _structure(folder: Path, name: str, files: tuple[str, ...] = ()) -> list[Path]:
    """A scene's structure as the site takes it: its structure file (POSCAR) and the files its config reads."""
    paths = []
    for file in ("POSCAR", *files):
        path = folder / name / file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(file, encoding="utf-8")
        paths.append(path)
    return paths


def test_examples_json_lists_the_scenes_in_order(tmp_path: Path) -> None:
    scenes = [_scene_file(tmp_path / "in" / f"{name}.json") for name in ("zeta", "alpha")]
    for name in ("zeta", "alpha"):
        _gallery(tmp_path / "gallery", name, {"title": name.title(), "description": f"{name} scene"})
        _thumbnail(tmp_path / "thumbs", name)
    out = tmp_path / "site"
    structures = {"zeta": _structure(tmp_path, "zeta", ("config.toml",)), "alpha": _structure(tmp_path, "alpha")}
    write_hosted_site(scenes, out, gallery=tmp_path / "gallery", thumbnails=tmp_path / "thumbs", structures=structures)
    assert not (out / "zeta" / "scene.json.gz").exists() and not (out / "alpha" / "scene.json.gz").exists()
    assert json.loads((out / EXAMPLES_FILE).read_text(encoding="utf-8")) == [
        {
            "name": "zeta",
            "title": "Zeta",
            "description": "zeta scene",
            "thumbnail": "zeta/thumbnail.png",
            "structure": {"structure": "POSCAR", "files": ["config.toml"]},
        },
        {
            "name": "alpha",
            "title": "Alpha",
            "description": "alpha scene",
            "thumbnail": "alpha/thumbnail.png",
            "structure": {"structure": "POSCAR", "files": []},
        },
    ]
    assert (out / "zeta" / "thumbnail.png").read_bytes() == PNG_SIGNATURE + b"picture"
    assert not (out / "zeta" / "index.html").exists() and not (out / "view").exists()


def test_examples_json_is_written_only_with_a_gallery(tmp_path: Path) -> None:
    write_hosted_site([_scene_file(tmp_path / "in" / "one.json")], tmp_path / "site")
    assert not (tmp_path / "site" / EXAMPLES_FILE).exists()
    assert not (tmp_path / "site" / "one" / "thumbnail.png").exists()


def test_a_scene_without_a_structure_is_kept_as_its_scene_file(tmp_path: Path) -> None:
    write_hosted_site([_scene_file(tmp_path / "in" / "one.json")], tmp_path / "site")
    kept = tmp_path / "site" / "one" / "scene.json.gz"
    assert json.loads(gzip.decompress(kept.read_bytes())) == TINY_SCENE
    assert sorted(p.name for p in (tmp_path / "site" / "one").iterdir()) == ["scene.json.gz"]


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
        write_hosted_site(
            [scene],
            tmp_path / "site",
            gallery=tmp_path / "gallery",
            thumbnails=tmp_path / "thumbs",
            structures={"one": _structure(tmp_path, "one")},
        )
    assert not (tmp_path / "site").exists()


def test_a_gallery_card_needs_its_scenes_structure(tmp_path: Path) -> None:
    scene = _scene_file(tmp_path / "in" / "one.json")
    _gallery(tmp_path / "gallery", "one", {"title": "One", "description": "one scene"})
    _thumbnail(tmp_path / "thumbs", "one")
    with pytest.raises(ValueError, match="a gallery card opens the structure of its scene, and one has none"):
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
        write_hosted_site(
            [scene],
            tmp_path / "site",
            gallery=tmp_path / "gallery",
            thumbnails=tmp_path / "thumbs",
            structures={"one": _structure(tmp_path, "one")},
        )
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
def test_examples_json_lists_every_example_in_order_and_each_card_opens_its_structure(site: Path) -> None:
    entries = json.loads((site / EXAMPLES_FILE).read_text(encoding="utf-8"))
    assert [entry["name"] for entry in entries] == BUILD_ORDER
    for entry in entries:
        assert set(entry) == {"name", "title", "description", "thumbnail", "structure"}
        structure, sidecars = _structure_of(entry["name"])
        assert entry["structure"]["structure"] == structure
        assert sorted(entry["structure"]["files"]) == sorted(["config.toml", *sidecars])
        assert (site / entry["name"] / structure).is_file()
        assert entry["thumbnail"] == f"{entry['name']}/thumbnail.png"
        assert (site / entry["thumbnail"]).read_bytes().startswith(PNG_SIGNATURE)


def test_the_page_names_the_compiler_under_its_hashed_name(tmp_path: Path) -> None:
    out = tmp_path / "site"
    write_hosted_site([_scene_file(tmp_path / "in" / "zeta.json")], out)
    names = [p.name for p in out.glob("compile.*.js")]
    assert len(names) == 1 and (match := re.fullmatch(rf"compile\.({HASH})\.js", names[0]))
    assert hashlib.sha256((out / names[0]).read_bytes()).hexdigest()[:HASH_CHARS] == match.group(1)
    assert f'<meta name="gemmy-compiler" content="{names[0]}">' in (out / "index.html").read_text(encoding="utf-8")


def test_a_structure_is_copied_into_its_folder_with_no_page(tmp_path: Path) -> None:
    """A scene with a structure: the structure and the files its config names are copied into its folder, and the
    folder has no page: the root page's gallery opens the structure. Without a structure, the scene is kept."""
    scenes = [_scene_file(tmp_path / "in" / f"{name}.json") for name in ("zeta", "alpha")]
    structure = tmp_path / "in" / "POSCAR"
    structure.write_text("structure", encoding="utf-8")
    config = tmp_path / "in" / "config.toml"
    config.write_text("structure = 'POSCAR'\n", encoding="utf-8")
    out = tmp_path / "site"
    write_hosted_site(scenes, out, structures={"zeta": [structure, config]})
    assert (out / "zeta" / "POSCAR").read_text(encoding="utf-8") == "structure"
    assert (out / "zeta" / "config.toml").read_bytes() == config.read_bytes()
    assert sorted(p.name for p in (out / "zeta").iterdir()) == ["POSCAR", "config.toml"]
    assert (out / "alpha" / "scene.json.gz").is_file()
    assert not (out / "alpha" / "POSCAR").exists()


@pytest.mark.parametrize(
    ("structures", "problem"),
    [
        ({"nope": ["a/POSCAR"]}, "which is no scene"),
        ({"zeta": []}, "needs at least its structure file"),
        ({"zeta": ["missing/POSCAR"]}, "no file for zeta's structure"),
        ({"zeta": ["a/POSCAR", "b/POSCAR"]}, "must have different names"),
    ],
)
def test_a_bad_structure_stops_the_build_before_anything_is_written(
    tmp_path: Path, structures: dict[str, list[str]], problem: str
) -> None:
    scenes = [_scene_file(tmp_path / "in" / "zeta.json")]
    for folder in ("a", "b"):
        (tmp_path / folder).mkdir()
        (tmp_path / folder / "POSCAR").write_text("structure", encoding="utf-8")
    given = {name: [str(tmp_path / rel) for rel in files] for name, files in structures.items()}
    out = tmp_path / "site"
    with pytest.raises(ValueError, match=problem):
        write_hosted_site(scenes, out, structures=given)
    assert not out.exists()


def test_the_head_has_the_title_description_and_social_tags_for_the_front_page(tmp_path: Path) -> None:
    scene = _scene_file(tmp_path / "in" / "zeta.json")
    head = _head_of(write_hosted_site([scene], tmp_path / "plain", site_url=SITE_URL).read_text(encoding="utf-8"))
    assert head.lang == "en" and head.title == FRONT_TITLE
    assert head.content("description") == SITE_DESCRIPTION
    assert head.canonical() == SITE_URL
    assert head.content("og:url") == SITE_URL
    assert head.content("og:type") == "website"
    assert head.content("twitter:card") == "summary_large_image"
    assert head.content("og:image") is None  # no gallery, so no picture


def test_the_head_picture_is_the_first_example_thumbnail_with_its_size(tmp_path: Path) -> None:
    scenes = [_scene_file(tmp_path / "in" / f"{name}.json") for name in ("zeta", "alpha")]
    for name in ("zeta", "alpha"):
        _gallery(tmp_path / "gallery", name, {"title": name.title(), "description": f"{name} scene"})
    picture = PNG_SIGNATURE + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 400, 267) + b"\x08\x06\x00\x00\x00"
    _thumbnail(tmp_path / "thumbs", "zeta", picture)
    _thumbnail(tmp_path / "thumbs", "alpha")
    structures = {"zeta": _structure(tmp_path, "zeta"), "alpha": _structure(tmp_path, "alpha")}
    out = write_hosted_site(
        scenes,
        tmp_path / "site",
        gallery=tmp_path / "gallery",
        thumbnails=tmp_path / "thumbs",
        structures=structures,
        site_url=SITE_URL,
    )
    head = _head_of(out.read_text(encoding="utf-8"))
    assert head.content("og:image") == f"{SITE_URL}zeta/thumbnail.png"
    assert head.content("og:image:width") == "400" and head.content("og:image:height") == "267"


def test_a_local_build_leaves_out_the_absolute_addresses(tmp_path: Path) -> None:
    """Without a site URL, the canonical address, og:url and og:image are left out (a relative one is not valid for
    them), and the title and description stay."""
    head = _head_of(
        write_hosted_site([_scene_file(tmp_path / "in" / "zeta.json")], tmp_path / "site").read_text("utf-8")
    )
    assert head.title == FRONT_TITLE and head.content("description") == SITE_DESCRIPTION
    assert head.canonical() is None
    assert head.content("og:url") is None and head.content("og:image") is None


@pytest.mark.parametrize(
    "site_url",
    ["gemmy.example", "ftp://example.org/gemmy/", "https://", "https://example.org/?a=b", "https://example.org/#x"],
)
def test_the_site_url_must_be_an_absolute_http_address(tmp_path: Path, site_url: str) -> None:
    with pytest.raises(ValueError, match="absolute http or https address"):
        write_hosted_site([_scene_file(tmp_path / "in" / "zeta.json")], tmp_path / "site", site_url=site_url)
    assert not (tmp_path / "site").exists()


def test_hosted_refuses_a_subtitle(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """The one hosted page has no subtitle, so --subtitle with --hosted is an error rather than a silent no-op."""
    from gemmy.cli import main

    code = main(["view", "--hosted", str(tmp_path / "zeta.json"), "--out", str(tmp_path / "site"), "--subtitle", "x"])
    assert code == 2
    assert "the hosted site has no subtitle" in capsys.readouterr().err
    assert not (tmp_path / "site").exists()


def test_hosted_refuses_a_title(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """--title names one page; the hosted site's page has a fixed name, so --title with --hosted is an error."""
    from gemmy.cli import main

    code = main(["view", "--hosted", str(tmp_path / "zeta.json"), "--out", str(tmp_path / "site"), "--title", "x"])
    assert code == 2
    assert "--title does not apply" in capsys.readouterr().err
    assert not (tmp_path / "site").exists()


def test_the_head_escapes_the_site_url_in_its_attributes(tmp_path: Path) -> None:
    url = 'https://example.org/a"b&c/'
    page = write_hosted_site([_scene_file(tmp_path / "in" / "zeta.json")], tmp_path / "site", site_url=url).read_text(
        encoding="utf-8"
    )
    assert 'a"b' not in page
    assert _head_of(page).canonical() == url
