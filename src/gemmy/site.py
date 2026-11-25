"""The hosted site (`gemmy view --hosted`, scripts/build_site.sh): one viewer and one stylesheet at the site root,
named by the hash of their content and shared by every page; a scene.json.gz per scene; a page per scene that loads
the shared viewer rather than carrying its own copy; and the front page, with the gallery (examples.json) when there
is one. Stdlib only. The pages themselves come from gemmy.view."""

from __future__ import annotations

import gzip
import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from .datafile import read_data
from .view import VIEWER, render_loader_page, render_page, scene_names, shared_script, validate_scene_dict

# A hosted site: the scene files and the pages' references to the shared viewer, relative to the page's folder.
HOSTED_SCENE_FILE = "scene.json.gz"
_SITE_ROOT = "../"  # from a scene's folder, or from view/, back to the site root
HASH_CHARS = 10  # hex digits of a shared file's SHA-256 in its name: a new build never gets an old file's name
# The gallery: each scene's folder holds GALLERY_FILE (its title and description); the site root gets EXAMPLES_FILE, the
# list of the scenes in order for the start screen: {name, title, description, scene}.
GALLERY_FILE = "gallery.json"
GALLERY_KEYS = ("title", "description")
EXAMPLES_FILE = "examples.json"
# The start screen's picture of a scene: pre-rendered PNGs (scripts/render_thumbnails.sh) in a folder with <scene
# name>.png, copied into the scene's folder as THUMBNAIL_FILE and named by examples.json's "thumbnail".
THUMBNAIL_FILE = "thumbnail.png"


@dataclass(frozen=True)
class _SharedFiles:
    """The hosted site's shared viewer files, with the names they are published under (their content's hash)."""

    script: str  # viewer.<hash>.js
    script_bytes: bytes
    style: str  # style.<hash>.css
    style_bytes: bytes

    def hrefs(self, folder: str) -> tuple[str, str]:
        """The (style, script) hrefs for a page `folder` steps down from the site root ("" for the root)."""
        return f"{folder}{self.style}", f"{folder}{self.script}"


def _hashed_name(stem: str, extension: str, data: bytes) -> str:
    """`stem.<hash>.extension`, the hash being the first HASH_CHARS hex digits of the data's SHA-256. The name changes
    exactly when the content does, so a cached copy of an older build is never served under the new name."""
    return f"{stem}.{hashlib.sha256(data).hexdigest()[:HASH_CHARS]}.{extension}"


def _shared_files() -> _SharedFiles:
    script = shared_script().encode("utf-8")
    style = (VIEWER / "style.css").read_bytes()
    return _SharedFiles(
        script=_hashed_name("viewer", "js", script),
        script_bytes=script,
        style=_hashed_name("style", "css", style),
        style_bytes=style,
    )


def _gallery_entries(folder: Path, names: Sequence[str], thumbnails: Path) -> list[dict[str, str]]:
    """examples.json's entries, in scene order: each scene's title and description from `folder/<name>/gallery.json`,
    and its thumbnail from `thumbnails/<name>.png`. Every scene needs both, with exactly those keys and string
    values."""
    entries = []
    for name in names:
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
        entries.append(
            {
                "name": name,
                **{key: data[key] for key in GALLERY_KEYS},
                "scene": f"{name}/{HOSTED_SCENE_FILE}",
                "thumbnail": f"{name}/{THUMBNAIL_FILE}",
            }
        )
    return entries


def write_hosted_site(
    scenes: Sequence[str | Path],
    out: str | Path,
    subtitle: str = "",
    gallery: str | Path | None = None,
    thumbnails: str | Path | None = None,
) -> Path:
    """A hosted site (GitHub Pages): one viewer and one stylesheet at the root, named by their content's hash
    (viewer.<hash>.js, style.<hash>.css), shared by every page. Per scene, a folder with `scene.json.gz` (gzip, no
    timestamp, so the same scene gives the same bytes; not hashed, since a stale copy of a scene is harmless) and an
    index.html that opens it, a small page with the viewer's default scene. `view/index.html` is the viewer with no
    scene, which opens any scene by address or file. `index.html` is the front page. With `gallery` (a folder
    with <scene name>/gallery.json for each scene), it is the start screen, which lists the scenes from examples.json
    (written alongside, the scenes in order as {name, title, description, scene, thumbnail}) and opens one when chosen;
    each scene's folder then gets its thumbnail (`thumbnails`, a folder with <scene name>.png). A gallery needs
    thumbnails, and the other way round. Without `gallery`, there is no examples.json, so the front page opens every
    scene as a default tab, in order. Every scene is checked before anything is written; links are relative, so the
    site works under any path. Returns `out/index.html`."""
    paths = [Path(scene) for scene in scenes]
    names = scene_names(paths)
    if (gallery is None) != (thumbnails is None):
        raise ValueError("a gallery needs thumbnails, and thumbnails need a gallery (--gallery and --thumbnails)")
    # Everything is read and checked before the first file is written.
    entries = None if gallery is None else _gallery_entries(Path(gallery), names, Path(thumbnails))
    texts = [path.read_text(encoding="utf-8") for path in paths]
    for text in texts:
        validate_scene_dict(json.loads(text))
    shared = _shared_files()
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / shared.script).write_bytes(shared.script_bytes)
    (out / shared.style).write_bytes(shared.style_bytes)
    assets = shared.hrefs(_SITE_ROOT)
    tabs = [(name, name) for name in names]
    for k, (path, name, text) in enumerate(zip(paths, names, texts, strict=True)):
        picture = None if thumbnails is None else Path(thumbnails) / f"{name}.png"
        _write_scene_folder(out / name, path.name, name, text, k, tabs, subtitle, assets, picture)
    _write_front_pages(out, shared, names, entries)
    return out / "index.html"


def _write_scene_folder(
    folder: Path,
    scene_file: str,
    name: str,
    text: str,
    tab: int,
    tabs: Sequence[tuple[str, str]],
    subtitle: str,
    assets: tuple[str, str],
    picture: Path | None,
) -> None:
    """One scene's folder: its scene gzipped, its thumbnail (with a gallery), and the page that opens it."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / HOSTED_SCENE_FILE).write_bytes(gzip.compress(text.encode("utf-8"), mtime=0))
    if picture is not None:
        (folder / THUMBNAIL_FILE).write_bytes(picture.read_bytes())
    page = render_page(
        "", name, subtitle, scene_file, tabs, tab, mode="load", default_scenes=[HOSTED_SCENE_FILE], assets=assets
    )
    (folder / "index.html").write_text(page, encoding="utf-8")


def _write_front_pages(
    out: Path, shared: _SharedFiles, names: Sequence[str], entries: list[dict[str, str]] | None
) -> None:
    """view/index.html (the viewer with no scene), the front page (every scene as a default tab) and, with a gallery,
    examples.json for the start screen."""
    (out / "view").mkdir(exist_ok=True)
    (out / "view" / "index.html").write_text(render_loader_page(assets=shared.hrefs(_SITE_ROOT)), encoding="utf-8")
    scenes_at_root = [f"{name}/{HOSTED_SCENE_FILE}" for name in names]
    front = render_loader_page("gemmy", assets=shared.hrefs(""), default_scenes=scenes_at_root)
    (out / "index.html").write_text(front, encoding="utf-8")
    if entries is not None:
        (out / EXAMPLES_FILE).write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
