"""`gemmy view` writes self-contained pages (one, or a site of several); no browser is involved."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from gemmy.cli import main
from gemmy.compile.pipeline import compile_to_json
from gemmy.view import render_live_page, render_viewer, write_viewer

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
NAMES = sorted(p.parent.name for p in EXAMPLES.glob("*/config.toml"))

SCENE = {
    "source_comment": "tiny",
    "materials": {"m": {"base_color": [1, 0, 0, 1]}},
    "points": [{"id": "p0", "element": "O", "position": [0, 0, 0]}],
    "primitives": {"atoms": [{"id": "a0", "point_id": "p0", "radius": 1.0, "material_id": "m", "element": "O"}]},
    "cell": {"origin": [0, 0, 0], "vectors": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
}


def _embedded(page: str) -> dict:
    match = re.search(r'<script type="application/json" id="scene-data">(.*?)</script>', page, re.S)
    assert match
    return json.loads(match.group(1))


def _module_script(page: str) -> str:
    match = re.search(r'<script type="module">(.*?)</script>', page, re.S)
    assert match
    return match.group(1)


def _atom_scene(**atom):
    scene = json.loads(json.dumps(SCENE))
    scene["primitives"]["atoms"][0].update(atom)
    return scene


def test_embedded_scene_round_trips() -> None:
    assert _embedded(render_viewer(SCENE, "t")) == SCENE


def test_script_cannot_be_closed_by_the_scene() -> None:
    scene = json.loads(json.dumps(SCENE))
    scene["source_comment"] = "</script><script>alert(1)</script><!-- __TITLE__"
    page = render_viewer(scene, "t")
    assert page.count("</script>") == page.count("<script")  # only the template's own tags
    assert _embedded(page) == scene


def test_title_and_subtitle_are_escaped() -> None:
    page = render_viewer(SCENE, '<b>"x"</b> & co', "<i>sub</i>")
    assert "<b>" not in page and "<i>sub</i>" not in page
    assert "&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; co" in page
    assert "&lt;i&gt;sub&lt;/i&gt;" in page


def test_invalid_scene_is_rejected() -> None:
    scene = _atom_scene(point_id="missing")
    with pytest.raises(ValueError, match="unknown point_id"):
        render_viewer(scene, "t")


def test_template_pins_three_and_uses_no_other_host() -> None:
    page = render_viewer(SCENE, "t")
    hosts = set(re.findall(r"https://([^/\"']+)", page))
    # api.github.com is the gist loader (web/src/scene/fetch.ts): it is called only for ?gist=, never on its own.
    # github.com is the project link in the help panel: a new-tab link the page never fetches.
    assert hosts == {"cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com", "api.github.com", "github.com"}
    assert all("three@0.160.0" in u for u in re.findall(r"https://cdn\.jsdelivr\.net/\S+", page) if "three" in u)


def test_cli_writes_a_page(tmp_path: Path) -> None:
    scene_path = tmp_path / "nacl.json"
    scene_path.write_text(json.dumps(SCENE), encoding="utf-8")
    out = tmp_path / "sub" / "page.html"
    assert main(["view", str(scene_path), "--out", str(out), "--subtitle", "demo"]) == 0
    page = out.read_text(encoding="utf-8")
    assert "<h1>nacl</h1>" in page and "demo" in page and 'class="tabs"' not in page
    assert _embedded(page) == SCENE


def test_cli_writes_a_site_with_relative_tabs(tmp_path: Path) -> None:
    paths = [tmp_path / "nacl.json", tmp_path / "ice-ih.json"]
    for k, path in enumerate(paths):
        path.write_text(json.dumps({**SCENE, "source_comment": f"s{k}"}), encoding="utf-8")
    site = tmp_path / "site"
    assert main(["view", *map(str, paths), "--out", str(site)]) == 0
    first, second = (site / "nacl" / "index.html").read_text(), (site / "ice-ih" / "index.html").read_text()
    assert _embedded(first)["source_comment"] == "s0" and _embedded(second)["source_comment"] == "s1"
    assert '<a href="../nacl/">nacl</a><a href="../ice-ih/" aria-current="page">ice-ih</a>' in second
    assert 'url=nacl/"' in (site / "index.html").read_text()  # the root opens the first page


def test_cli_site_rejects_title_and_clashing_names(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    paths = [tmp_path / "a" / "scene.json", tmp_path / "b" / "scene.json"]
    for path in paths:
        path.parent.mkdir()
        path.write_text(json.dumps(SCENE), encoding="utf-8")
    assert main(["view", *map(str, paths), "--out", str(tmp_path / "site"), "--title", "x"]) == 2
    assert "one scene" in capsys.readouterr().err
    assert main(["view", *map(str, paths), "--out", str(tmp_path / "site")]) == 2
    assert "must differ" in capsys.readouterr().err and not (tmp_path / "site").exists()


def test_cli_reports_a_bad_scene(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    scene_path = tmp_path / "bad.json"
    scene_path.write_text(json.dumps(_atom_scene(point_id="nope")), encoding="utf-8")
    assert main(["view", str(scene_path), "--out", str(tmp_path / "x.html")]) == 2
    assert "nope" in capsys.readouterr().err


@pytest.mark.parametrize("name", NAMES)
def test_every_example_makes_a_page(name: str, tmp_path: Path) -> None:
    scene_path = tmp_path / f"{name}.json"
    compile_to_json(EXAMPLES / name / "config.toml", scene_path)
    out = write_viewer(scene_path, tmp_path / f"{name}.html", subtitle=name)
    page = out.read_text(encoding="utf-8")
    assert _embedded(page) == json.loads(scene_path.read_text(encoding="utf-8"))
    assert "__SCENE_JSON__" not in page and "__TITLE__" not in page


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_module_script_parses(tmp_path: Path) -> None:
    script = tmp_path / "viewer.mjs"
    script.write_text(_module_script(render_viewer(SCENE, "t")), encoding="utf-8")
    result = subprocess.run(["node", "--check", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_page_is_a_full_document_with_no_body_margin() -> None:
    page = render_live_page("x")
    assert page.startswith("<!doctype html>") and '<meta charset="utf-8">' in page and page.rstrip().endswith("</html>")
    assert "html, body { height: 100%; margin: 0; }" in page  # toolbar flush with the window edges
