"""`gemmy view`: write a scene as one self-contained HTML page (three.js from a pinned CDN, no Blender), or several
scenes as a static site of such pages.

Stdlib only. The page is `viewer/page.html`; its stylesheet and script are the other built files in `viewer/`
(`viewer.js` is the TypeScript viewer in `web/`, built by `npm --prefix web run build`; never edit the built files). It
reads the embedded scene JSON with the same meaning the Blender backend gives it (bond styles, arrow proportions,
see-through polyhedra).
"""

from __future__ import annotations

import base64
import html
import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .render import looks
from .scene import SceneDocument, check_references, from_dict
from .settings import Axes

VIEWER = Path(__file__).with_name("viewer")
_PLACEHOLDER = re.compile(r"__(TITLE|SUBTITLE|SCENE_JSON|SCENE_FILE|CONSTANTS_JSON|AXIS_FONTS_JSON|TABS)__")


def scene_json_for_html(data: Mapping[str, Any]) -> str:
    """JSON text that is safe inside a <script> element: `</script>` and `<!--` cannot occur in it."""
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    return text.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def render_constants() -> dict[str, Any]:
    """The numbers the page shares with the Blender render (camera framing, lens, axis triad), from one place."""
    axes = Axes()
    return {
        "distanceFactor": looks.DISTANCE_FACTOR,
        "distanceMin": looks.DISTANCE_MIN,
        "orthoFactor": looks.ORTHO_FACTOR,
        "orthoMin": looks.ORTHO_MIN,
        "sensorWidth": looks.SENSOR_WIDTH,
        "lenses": list(looks.LENS_CHOICES),
        "defaultLens": looks.DEFAULT_LENS,
        "triad": {
            "size": axes.size,
            "margin": axes.margin,
            "arrowRadius": looks.AXES_ARROW_RADIUS,
            "labelPad": looks.AXES_LABEL_PAD,
            "labelSize": looks.AXES_LABEL_SIZE,
            "labelReach": looks.AXES_LABEL_REACH,
            "headRadiusRatio": looks.AXES_HEAD_RADIUS_RATIO,
            "headLengthRatio": looks.AXES_HEAD_LENGTH_RATIO,
        },
    }


def _axis_fonts() -> dict[str, str]:
    """The axis label faces Blender uses, base64 by CSS weight: 700 for the triad (bold is the default), 400 for
    the page's a/b/c buttons."""
    faces = {"700": looks.BOLD_LABEL_FONT_CANDIDATES[0], "400": looks.LABEL_FONT_CANDIDATES[0]}
    return {weight: base64.b64encode(Path(path).read_bytes()).decode("ascii") for weight, path in faces.items()}


def _tabs(tabs: Sequence[tuple[str, str]], current: int) -> str:
    """Links between sibling pages, one (label, folder) each: `gemmy serve` previews or a `gemmy view` site.

    Relative (`../folder/`), so a site still works under a sub-path such as https://user.github.io/gemmy/.
    Nothing for a single page."""
    if len(tabs) < 2:
        return ""
    current_attr = ' aria-current="page"'
    links = "".join(
        f'<a href="../{html.escape(quote(folder))}/"{current_attr if k == current else ""}>{html.escape(label)}</a>'
        for k, (label, folder) in enumerate(tabs)
    )
    return f'<nav class="tabs" aria-label="Structures">{links}</nav>'


def _template() -> str:
    """The built page with its stylesheet and script inserted. This runs before the placeholders are filled, so
    scene text that contains a placeholder name is never mistaken for a marker."""
    page = (VIEWER / "page.html").read_text(encoding="utf-8")
    style = (VIEWER / "style.css").read_text(encoding="utf-8")
    script = (VIEWER / "viewer.js").read_text(encoding="utf-8")
    return page.replace("/*__STYLE__*/", style).replace("//__SCRIPT__", script)


def _page(
    scene_text: str,
    title: str,
    subtitle: str,
    scene_file: str = "scene.json",
    tabs: Sequence[tuple[str, str]] = (),
    tab: int = 0,
) -> str:
    values = {
        "TITLE": html.escape(title),
        "SUBTITLE": html.escape(subtitle),
        "SCENE_JSON": scene_text,
        "SCENE_FILE": html.escape(scene_file),
        "CONSTANTS_JSON": json.dumps(render_constants()),
        "AXIS_FONTS_JSON": json.dumps(_axis_fonts()),
        "TABS": _tabs(tabs, tab),
    }
    # One pass, so text inside the scene or the title is never mistaken for a placeholder.
    return _PLACEHOLDER.sub(lambda m: values[m.group(1)], _template())


def validate_scene_dict(scene: Mapping[str, Any]) -> None:
    """Raise ValueError (or TypeError for unknown keys) if `scene` is not a valid scene document."""
    check_references(from_dict(SceneDocument, scene))


def render_viewer(
    scene: Mapping[str, Any],
    title: str,
    subtitle: str = "",
    scene_file: str = "scene.json",
    tabs: Sequence[tuple[str, str]] = (),
    tab: int = 0,
) -> str:
    """The page text for a scene dict; raises ValueError (or TypeError for unknown keys) if it is not valid.

    `scene_file` is how the copied `gemmy render` command names the scene; `tabs` link to sibling pages."""
    validate_scene_dict(scene)
    return _page(scene_json_for_html(scene), title, subtitle, scene_file, tabs, tab)


def render_live_page(
    title: str, subtitle: str = "", scene_file: str = "scene.json", tabs: Sequence[tuple[str, str]] = (), tab: int = 0
) -> str:
    """A page with no scene embedded: it fetches scene.json and follows events, relative to its own URL (see
    `gemmy.serve`). With several `tabs` it links to the others."""
    return _page("", title, subtitle, scene_file, tabs, tab)


def write_viewer(
    scene: str | Path | Mapping[str, Any], out: str | Path, title: str | None = None, subtitle: str = ""
) -> Path:
    """Write the viewer page. `scene` is a scene.json path or an already loaded dict."""
    if isinstance(scene, (str, Path)):
        path = Path(scene)
        data = json.loads(path.read_text(encoding="utf-8"))
        title = title or path.stem
        scene_file = path.name
    else:
        data = scene
        title = title or "Structure"
        scene_file = "scene.json"
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_viewer(data, title, subtitle, scene_file), encoding="utf-8")
    return out


def write_site(scenes: Sequence[str | Path], out: str | Path, subtitle: str = "") -> Path:
    """A static site: `out/<name>/index.html` per scene file (name: the file name without extension), tabs between
    them, and `out/index.html` that opens the first. Links are relative, so `out` can be served under any path.
    Every scene is checked before anything is written. Returns `out/index.html`."""
    paths = [Path(scene) for scene in scenes]
    names = [path.stem for path in paths]
    if len(set(names)) < len(names):
        raise ValueError(f"scene file names must differ, they name the pages: {', '.join(names)}")
    tabs = [(name, name) for name in names]
    pages = [
        render_viewer(json.loads(path.read_text(encoding="utf-8")), name, subtitle, path.name, tabs, k)
        for k, (path, name) in enumerate(zip(paths, names, strict=True))
    ]
    out = Path(out)
    for name, page in zip(names, pages, strict=True):
        (out / name).mkdir(parents=True, exist_ok=True)
        (out / name / "index.html").write_text(page, encoding="utf-8")
    first = html.escape(quote(names[0]))
    index = out / "index.html"
    index.write_text(
        f'<!doctype html>\n<meta charset="utf-8">\n<title>gemmy</title>\n'
        f'<meta http-equiv="refresh" content="0; url={first}/">\n<a href="{first}/">{html.escape(names[0])}</a>\n',
        encoding="utf-8",
    )
    return index
