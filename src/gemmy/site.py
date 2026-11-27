"""The hosted site (`gemmy view --hosted`, scripts/build_site.sh): one viewer page at the site root, which is the start
screen and opens any scene by address or file. Beside it: the shared viewer, stylesheet and structure compiler, named by
the hash of their content, examples.json (the gallery, when there is one), and per scene a data folder with its
structure and the files its config reads (the page compiles them in the browser), or its scene.json.gz, and its
thumbnail. The page itself comes from gemmy.view. Stdlib only."""

from __future__ import annotations

import gzip
import hashlib
import html
import json
import struct
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlsplit

from .datafile import read_data
from .view import VIEWER, render_loader_page, scene_names, shared_compiler, shared_script, validate_scene_dict

# A scene without a structure is kept as scene.json.gz in its folder, and opens by address: ?scene=NAME/scene.json.gz.
HOSTED_SCENE_FILE = "scene.json.gz"
HASH_CHARS = 10  # hex digits of a shared file's SHA-256 in its name: a new build never gets an old file's name
# The gallery: each scene's folder holds GALLERY_FILE (its title and description); the site root gets EXAMPLES_FILE, the
# list of the scenes in order for the start screen: {name, title, description, thumbnail, structure}, where structure is
# the scene's structure file and the files its config reads (what its card opens).
GALLERY_FILE = "gallery.json"
GALLERY_KEYS = ("title", "description")
EXAMPLES_FILE = "examples.json"
# The start screen's picture of a scene: pre-rendered PNGs (scripts/render_thumbnails.sh) in a folder with <scene
# name>.png, copied into the scene's folder as THUMBNAIL_FILE and named by examples.json's "thumbnail".
THUMBNAIL_FILE = "thumbnail.png"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# The head of the one page: its title and description (the README's first line, for the description).
FRONT_TITLE = "gemmy: crystal structure viewer for POSCAR, CIF, extxyz and LAMMPS"
SITE_DESCRIPTION = (
    "View VASP POSCAR, CIF, extxyz and LAMMPS files in the browser: bonds, coordination polyhedra and rings in "
    "VESTA or Jmol colours, exported as figures for papers."
)


@dataclass(frozen=True)
class _SharedFiles:
    """The hosted site's shared files, with the names they are published under (their content's hash): the viewer, its
    stylesheet, and the structure compiler, which the page uses to compile structures."""

    script: str  # viewer.<hash>.js
    script_bytes: bytes
    style: str  # style.<hash>.css
    style_bytes: bytes
    compiler: str  # compile.<hash>.js
    compiler_bytes: bytes


def _hashed_name(stem: str, extension: str, data: bytes) -> str:
    """`stem.<hash>.extension`, the hash being the first HASH_CHARS hex digits of the data's SHA-256. The name changes
    exactly when the content does, so a cached copy of an older build is never served under the new name."""
    return f"{stem}.{hashlib.sha256(data).hexdigest()[:HASH_CHARS]}.{extension}"


def _shared_files() -> _SharedFiles:
    script = shared_script().encode("utf-8")
    style = (VIEWER / "style.css").read_bytes()
    compiler = shared_compiler().encode("utf-8")
    return _SharedFiles(
        script=_hashed_name("viewer", "js", script),
        script_bytes=script,
        style=_hashed_name("style", "css", style),
        style_bytes=style,
        compiler=_hashed_name("compile", "js", compiler),
        compiler_bytes=compiler,
    )


def _site_address(site_url: str | None) -> str | None:
    """The site's absolute address with a trailing slash (the front page's canonical address), or None for a local
    build. Only http and https addresses are accepted."""
    if site_url is None:
        return None
    parts = urlsplit(site_url)
    if parts.scheme not in ("http", "https") or not parts.netloc or parts.query or parts.fragment:
        raise ValueError(
            f"the site URL must be an absolute http or https address without a query or fragment, not {site_url!r}"
        )
    return site_url.rstrip("/") + "/"


def _png_size(data: bytes) -> tuple[int, int] | None:
    """The width and height of a PNG from its header, or None for anything else."""
    if data[:8] != PNG_SIGNATURE or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def _meta(attribute: str, key: str, value: str) -> str:
    return f'<meta {attribute}="{key}" content="{html.escape(value, quote=True)}">'


def _head(site_url: str | None, picture: tuple[str, tuple[int, int] | None] | None) -> str:
    """The head metadata of the front page, the one place that writes it: its <title>, description, canonical
    address and the tags link previews read (Open Graph, Twitter card). `picture` is the first example's thumbnail
    as (path under the site root, size or None). The canonical address, og:url and og:image need the site URL: a
    local build leaves them out, since a relative address is not valid there."""
    tags = [f"<title>{html.escape(FRONT_TITLE)}</title>", _meta("name", "description", SITE_DESCRIPTION)]
    if site_url is not None:
        tags.append(f'<link rel="canonical" href="{html.escape(site_url, quote=True)}">')
        tags.append(_meta("property", "og:url", site_url))
    tags.append(_meta("property", "og:title", FRONT_TITLE))
    tags.append(_meta("property", "og:description", SITE_DESCRIPTION))
    tags.append(_meta("property", "og:type", "website"))
    if site_url is not None and picture is not None:
        path, size = picture
        tags.append(_meta("property", "og:image", site_url + quote(path)))
        if size is not None:
            tags.append(_meta("property", "og:image:width", str(size[0])))
            tags.append(_meta("property", "og:image:height", str(size[1])))
    tags.append(_meta("name", "twitter:card", "summary_large_image"))
    return "\n".join(tags)


def _thumbnail_of(name: str, picture: Path) -> tuple[str, tuple[int, int] | None]:
    """A scene's thumbnail as the head takes it: its path under the site root and its size."""
    return f"{name}/{THUMBNAIL_FILE}", _png_size(picture.read_bytes())


def _gallery_entries(
    folder: Path, names: Sequence[str], thumbnails: Path, structures: Mapping[str, Sequence[Path]]
) -> list[dict[str, object]]:
    """examples.json's entries, in scene order: each scene's title and description from `folder/<name>/gallery.json`,
    its thumbnail from `thumbnails/<name>.png`, and its structure (`structures`, see _structure_files): what its card
    opens. Every scene needs all of them, with exactly those keys and the right values."""
    entries: list[dict[str, object]] = []
    for name in names:
        if name not in structures:
            raise ValueError(f"a gallery card opens the structure of its scene, and {name} has none")
        path = folder / name / GALLERY_FILE
        if not path.is_file():
            raise ValueError(f"no gallery entry for scene {name}: expected {path}")
        data = read_data(path)
        if not isinstance(data, dict) or sorted(data) != sorted(GALLERY_KEYS):
            raise ValueError(f"{path} must be an object with exactly the keys {', '.join(GALLERY_KEYS)}")
        if not all(isinstance(data[key], str) for key in GALLERY_KEYS):
            raise ValueError(f"{path}: {' and '.join(GALLERY_KEYS)} must be strings")
        picture = thumbnails / f"{name}.png"
        if not picture.is_file():
            raise ValueError(f"no thumbnail for scene {name}: expected {picture}")
        files = structures[name]
        entries.append(
            {
                "name": name,
                **{key: data[key] for key in GALLERY_KEYS},
                "thumbnail": f"{name}/{THUMBNAIL_FILE}",
                "structure": {"structure": files[0].name, "files": [path.name for path in files[1:]]},
            }
        )
    return entries


def write_hosted_site(
    scenes: Sequence[str | Path],
    out: str | Path,
    gallery: str | Path | None = None,
    thumbnails: str | Path | None = None,
    structures: Mapping[str, Sequence[str | Path]] | None = None,
    site_url: str | None = None,
) -> Path:
    """A hosted site (GitHub Pages): one viewer page at the root (index.html), which is the start screen and opens any
    scene by address or file, with the shared viewer, stylesheet and structure compiler beside it, named by their
    content's hash (viewer.<hash>.js, style.<hash>.css, compile.<hash>.js). Per scene, a data folder named by the scene:
    with `structures[name]`, the scene's structure file and the files its config reads (the first path is the structure,
    the rest are the files the config names and the config itself; each is copied under its own file name), which the
    gallery's card opens; without one, the scene is kept as `scene.json.gz` (gzip, no timestamp, so the same scene gives
    the same bytes). With `gallery` (a folder with <scene name>/gallery.json for each scene), examples.json lists the
    scenes in order, as {name, title, description, thumbnail, structure}, and the start screen shows them. With
    `thumbnails` (a folder with <scene name>.png), each scene's folder gets its thumbnail. A gallery needs thumbnails,
    and the other way round, and every scene in a gallery needs a structure. Every scene and structure is checked before
    anything is written; links are relative, so the site works under any path. `site_url` is the site's absolute
    address, for the front page's canonical address, og:url and og:image; without it those are left out. Returns
    `out/index.html`."""
    paths = [Path(scene) for scene in scenes]
    names = scene_names(paths)
    address = _site_address(site_url)
    if (gallery is None) != (thumbnails is None):
        raise ValueError("a gallery needs thumbnails, and thumbnails need a gallery (--gallery and --thumbnails)")
    structure_files = _structure_files(structures or {}, names)
    # Everything is read and checked before the first file is written.
    entries = None if gallery is None else _gallery_entries(Path(gallery), names, Path(thumbnails), structure_files)
    texts = [path.read_text(encoding="utf-8") for path in paths]
    for text in texts:
        validate_scene_dict(json.loads(text))
    shared = _shared_files()
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / shared.script).write_bytes(shared.script_bytes)
    (out / shared.style).write_bytes(shared.style_bytes)
    (out / shared.compiler).write_bytes(shared.compiler_bytes)
    for name, text in zip(names, texts, strict=True):
        structure = structure_files.get(name)
        picture = None if thumbnails is None else Path(thumbnails) / f"{name}.png"
        # A scene with a structure is its data as the structure (its page compiles it), else kept as its scene.
        kept = text if structure is None else None
        _write_scene_data(out / name, kept, structure, picture)
    # The front page's picture is the first example's thumbnail: the first card the start screen shows.
    first = None if thumbnails is None else _thumbnail_of(names[0], Path(thumbnails) / f"{names[0]}.png")
    _write_front_page(out, shared, entries, _head(address, first))
    return out / "index.html"


def _structure_files(structures: Mapping[str, Sequence[str | Path]], names: Sequence[str]) -> dict[str, list[Path]]:
    """`structures` checked: each one names a scene, gives at least its structure, and every file exists and has its
    own name in the scene's folder (so the page's files never collide)."""
    checked: dict[str, list[Path]] = {}
    for name, files in structures.items():
        if name not in names:
            raise ValueError(f"a structure is given for {name}, which is no scene (scenes: {', '.join(names)})")
        paths = [Path(file) for file in files]
        if not paths:
            raise ValueError(f"the structure of {name} needs at least its structure file")
        for path in paths:
            if not path.is_file():
                raise ValueError(f"no file for {name}'s structure: {path}")
        basenames = [path.name for path in paths]
        if len(set(basenames)) < len(basenames):
            raise ValueError(f"the files of {name}'s structure must have different names: {', '.join(basenames)}")
        checked[name] = paths
    return checked


def _write_scene_data(folder: Path, text: str | None, structure: Sequence[Path] | None, picture: Path | None) -> None:
    """One scene's data folder: its scene gzipped (`text`, when the scene is kept), its structure and the files it reads
    (when it has one), and its thumbnail (with a gallery). No page: the root page opens them."""
    folder.mkdir(parents=True, exist_ok=True)
    if text is not None:
        (folder / HOSTED_SCENE_FILE).write_bytes(gzip.compress(text.encode("utf-8"), mtime=0))
    for path in structure or ():
        (folder / path.name).write_bytes(path.read_bytes())
    if picture is not None:
        (folder / THUMBNAIL_FILE).write_bytes(picture.read_bytes())


def _write_front_page(out: Path, shared: _SharedFiles, entries: list[dict[str, object]] | None, head: str) -> None:
    """index.html: the viewer with the start screen, which opens no scene by default (the gallery's cards open the
    examples one at a time). With the gallery, examples.json beside it."""
    page = render_loader_page(
        "gemmy",
        assets=(shared.style, shared.script),
        compiler=shared.compiler,
        open_files=True,
        head=head,
    )
    (out / "index.html").write_text(page, encoding="utf-8")
    if entries is not None:
        (out / EXAMPLES_FILE).write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
