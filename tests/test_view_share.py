"""The viewer's loading of scenes by URL, gist or file (web/src/scene/): the address parsing, gzip detection and the
scene checks, run in node through tests/viewer_bundle.py. The page itself (the DOM) is not tested here."""

from __future__ import annotations

import base64
import gzip
import json
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest

from gemmy.view import render_live_page, render_loader_page, render_viewer
from viewer_bundle import available, header

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")
BASE = "https://chazeon.github.io/gemmy/view/"


def _run(body: str, args: Any, tmp_path: Path) -> Any:
    script = tmp_path / "share.mjs"
    script.write_text(header() + "\nconst args = JSON.parse(process.argv[2]);\n" + body, encoding="utf-8")
    result = subprocess.run(["node", str(script), json.dumps(args)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _try_parse(search: str, tmp_path: Path) -> dict:
    body = (
        "try { console.log(JSON.stringify({ ok: parseSources(args.search, args.base) })); }"
        " catch (e) { console.log(JSON.stringify({ error: e.message })); }"
    )
    return _run(body, {"search": search, "base": BASE}, tmp_path)


def test_scene_urls_resolve_against_the_page_and_several_scenes_are_kept(tmp_path: Path) -> None:
    found = _try_parse("?scene=../nacl/scene.json.gz&scene=https://example.org/a.json", tmp_path)
    assert found["ok"] == [
        {"kind": "url", "url": "https://chazeon.github.io/gemmy/nacl/scene.json.gz"},
        {"kind": "url", "url": "https://example.org/a.json"},
    ]


@pytest.mark.parametrize("search", ["?scene=file:///etc/passwd", "?scene=javascript:alert(1)", "?scene=", "?scene=%20"])
def test_only_http_and_https_scene_urls_are_taken(search: str, tmp_path: Path) -> None:
    assert "error" in _try_parse(search, tmp_path)


def test_gist_and_file_are_parsed_and_a_gist_excludes_scene(tmp_path: Path) -> None:
    assert _try_parse("?gist=0123abcd&file=ice.json.gz", tmp_path)["ok"] == [
        {"kind": "gist", "id": "0123abcd", "file": "ice.json.gz"}
    ]
    assert _try_parse("?gist=0123abcd", tmp_path)["ok"] == [{"kind": "gist", "id": "0123abcd", "file": None}]
    assert "not both" in _try_parse("?gist=0123abcd&scene=https://example.org/a.json", tmp_path)["error"]
    assert "gist id" in _try_parse("?gist=../../etc", tmp_path)["error"]


def test_an_empty_address_asks_for_no_scene(tmp_path: Path) -> None:
    assert _try_parse("", tmp_path)["ok"] == []


# parseScene's message, or an empty object when it parses
PARSE_OR_ERROR = """
try { parseScene(args.text); console.log("{}"); } catch (e) { console.log(JSON.stringify({ error: e.message })); }
"""


def _scene(**extra: Any) -> dict:
    scene = {
        "schema_version": 2,
        "source_comment": "tiny",
        "materials": {"m": {"base_color": [1, 0, 0, 1]}},
        "points": [{"id": "p0", "element": "O", "position": [0, 0, 0]}],
        "topologies": [],
        "primitives": {},
        "cell": None,
    }
    scene.update(extra)
    return scene


def test_gzip_is_detected_by_its_magic_bytes_and_both_forms_load(tmp_path: Path) -> None:
    plain = json.dumps(_scene()).encode("utf-8")
    compressed = gzip.compress(plain)
    body = """
const bytes = (b64) => Uint8Array.from(Buffer.from(b64, "base64"));
const gz = bytes(args.gzip), plain = bytes(args.plain);
const fromGz = await sceneFromBytes(gz);
const fromPlain = await sceneFromBytes(plain);
// a file that is not gzip, named .gz, is read as the JSON it is
console.log(JSON.stringify({
  gzip: isGzip(gz), plain: isGzip(plain), empty: isGzip(new Uint8Array(0)),
  gzId: fromGz.source_comment, plainId: fromPlain.source_comment,
}));
"""
    found = _run(
        body,
        {"gzip": base64.b64encode(compressed).decode(), "plain": base64.b64encode(plain).decode()},
        tmp_path,
    )
    assert found == {"gzip": True, "plain": False, "empty": False, "gzId": "tiny", "plainId": "tiny"}


def test_a_scene_from_another_schema_version_is_refused_by_name(tmp_path: Path) -> None:
    text = json.dumps(_scene(schema_version=1))
    found = _run(PARSE_OR_ERROR, {"text": text}, tmp_path)
    assert "schema_version 1" in found["error"] and "reads version 2" in found["error"]


def test_a_document_that_is_not_a_scene_is_refused(tmp_path: Path) -> None:
    assert "not a gemmy scene" in _run(PARSE_OR_ERROR, {"text": json.dumps({"schema_version": 2})}, tmp_path)["error"]
    assert "not valid JSON" in _run(PARSE_OR_ERROR, {"text": "{"}, tmp_path)["error"]


def test_a_gist_takes_the_named_file_or_the_first_scene_file(tmp_path: Path) -> None:
    body = """
const files = {
  "notes.md": { filename: "notes.md", raw_url: "https://gist.example/notes" },
  "ice.json.gz": { filename: "ice.json.gz", raw_url: "https://gist.example/ice" },
  "nacl.JSON": { filename: "nacl.JSON", raw_url: "https://gist.example/nacl" },
};
const names = [pickGistFile(files, null).filename, pickGistFile(files, "notes.md").filename];
let missing = null;
try { pickGistFile({ "a.md": files["notes.md"] }, null); } catch (e) { missing = e.message; }
console.log(JSON.stringify({ names, missing }));
"""
    found = _run(body, {}, tmp_path)
    assert found["names"] == ["ice.json.gz", "notes.md"]
    assert "no .json or .json.gz" in found["missing"]


def test_a_view_round_trips_to_four_figures_and_back_to_the_same_text(tmp_path: Path) -> None:
    body = """
const pose = {
  projection: "persp", lens: 50, zoom: 1, eye: [1.23456, -0.000123456, 12345.6], at: [0, 0, 0], up: [0, 0, 1],
};
const text = encodeView(pose);
const back = decodeView(text);
console.log(JSON.stringify({ text, back, again: encodeView(back) }));
"""
    found = _run(body, {}, tmp_path)
    assert found["text"] == "persp;lens=50;eye=1.235,-0.0001235,12350;at=0,0,0;up=0,0,1"
    assert found["again"] == found["text"]
    assert found["back"]["eye"] == [1.235, -0.0001235, 12350]


def test_an_orthographic_view_keeps_its_zoom_and_drops_the_lens(tmp_path: Path) -> None:
    body = """
const text = encodeView({ projection: "ortho", lens: 50, zoom: 1.23456, eye: [0, 0, 8], at: [0, 0, 0], up: [0, 1, 0] });
console.log(JSON.stringify({ text, back: decodeView(text) }));
"""
    found = _run(body, {}, tmp_path)
    assert found["text"] == "ortho;zoom=1.235;eye=0,0,8;at=0,0,0;up=0,1,0"
    assert found["back"]["zoom"] == 1.235 and found["back"]["projection"] == "ortho"


@pytest.mark.parametrize(
    "text",
    [
        "",
        "sideways;lens=50;eye=0,0,1;at=0,0,0;up=0,0,1",
        "persp;lens=0;eye=0,0,1;at=0,0,0;up=0,0,1",
        "persp;lens=50;eye=0,0;at=0,0,0;up=0,0,1",
        "persp;lens=50;eye=0,0,x;at=0,0,0;up=0,0,1",
        "ortho;zoom=abc",
    ],
)
def test_a_view_that_is_not_one_decodes_to_null(text: str, tmp_path: Path) -> None:
    assert _run("console.log(JSON.stringify({ back: decodeView(args.text) }));", {"text": text}, tmp_path) == {
        "back": None
    }


# placedPose: the address pose as the structure can show it (ui/share.ts applyPose). An orthographic eye goes to the
# standard distance along its direction; a perspective eye keeps its distance, clamped to the trackball's limits.
def _placed(pose: dict, extent: float, limits: dict, tmp_path: Path) -> Any:
    body = "console.log(JSON.stringify(placedPose(args.pose, args.extent, args.limits)));"
    return _run(body, {"pose": pose, "extent": extent, "limits": limits}, tmp_path)


def _pose(projection: str, eye: list, at: list, up: list, zoom: float = 1.0) -> dict:
    return {
        "projection": projection,
        "lens": 50 if projection == "persp" else 0,
        "zoom": zoom,
        "eye": eye,
        "at": at,
        "up": up,
    }


def _length(v: list) -> float:
    return sum(x * x for x in v) ** 0.5


def test_an_orthographic_eye_far_away_moves_to_the_standard_distance_in_the_same_direction(tmp_path: Path) -> None:
    eye, at = [37.56, -356.5, 1646.0], [0.0, 0.0, 0.0]
    placed = _placed(
        _pose("ortho", eye, at, [-0.6627, -0.6607, 0.3525], 0.7509),
        20.0,
        {"minDistance": 1, "maxDistance": 800},
        tmp_path,
    )
    assert _length([placed["eye"][i] - at[i] for i in range(3)]) == pytest.approx(20.0 * 8)
    for got, want in zip(placed["eye"], eye, strict=True):
        assert got == pytest.approx(want / _length(eye) * 160.0)
    assert placed["at"] == at and placed["zoom"] == 0.7509
    assert _length(placed["up"]) == pytest.approx(1.0)


def test_an_orthographic_placement_is_taken_from_the_target_not_the_origin(tmp_path: Path) -> None:
    at = [1.0, 2.0, 3.0]
    placed = _placed(
        _pose("ortho", [1.0, 2.0, 103.0], at, [0, 1, 0]), 10.0, {"minDistance": 1, "maxDistance": 800}, tmp_path
    )
    assert placed["eye"] == pytest.approx([1.0, 2.0, 3.0 + 80.0])


def test_a_perspective_eye_beyond_the_maximum_distance_is_clamped(tmp_path: Path) -> None:
    placed = _placed(
        _pose("persp", [0, 0, 5000], [0, 0, 0], [0, 1, 0]), 20.0, {"minDistance": 2, "maxDistance": 400}, tmp_path
    )
    assert placed["eye"] == pytest.approx([0, 0, 400])


def test_a_perspective_eye_inside_the_minimum_distance_is_clamped_out(tmp_path: Path) -> None:
    placed = _placed(
        _pose("persp", [0, 0.5, 0.5], [0, 0, 0], [0, 1, 0]), 20.0, {"minDistance": 2, "maxDistance": 400}, tmp_path
    )
    assert _length(placed["eye"]) == pytest.approx(2.0)


def test_a_perspective_eye_in_range_is_unchanged(tmp_path: Path) -> None:
    eye = [30.0, -40.0, 120.0]
    placed = _placed(_pose("persp", eye, [0, 0, 0], [0, 1, 0]), 20.0, {"minDistance": 2, "maxDistance": 400}, tmp_path)
    assert placed["eye"] == pytest.approx(eye)


@pytest.mark.parametrize(
    "pose",
    [
        _pose("ortho", [0, 0, 0], [0, 0, 0], [0, 1, 0]),  # eye on the target: no direction
        _pose("persp", [4, 4, 4], [4, 4, 4], [0, 1, 0]),
        _pose("persp", [0, 0, 9], [0, 0, 0], [0, 0, 0]),  # a zero up
    ],
)
def test_a_pose_without_a_direction_places_nothing(pose: dict, tmp_path: Path) -> None:
    assert _placed(pose, 20.0, {"minDistance": 2, "maxDistance": 400}, tmp_path) is None


def test_a_scene_is_named_after_its_folder_or_its_file(tmp_path: Path) -> None:
    body = """
console.log(JSON.stringify([
  sceneName({ kind: "url", url: "https://x.example/nacl/scene.json.gz" }),
  sceneName({ kind: "url", url: "https://x.example/runs/ice-ih.json" }),
  sceneName({ kind: "url", url: "https://x.example/a%20b/scene.json" }),
  sceneName({ kind: "gist", id: "0123", file: "ice.json.gz" }),
]));
"""
    assert _run(body, {}, tmp_path) == ["nacl", "ice-ih", "a b", "ice.json.gz"]


def test_the_page_opens_its_defaults_unless_the_address_names_scenes(tmp_path: Path) -> None:
    body = """
const base = "https://chazeon.github.io/gemmy/";
const defaults = ["nacl/scene.json.gz", "ice-ih/scene.json.gz", "stishovite/scene.json.gz"];
const shown = (openings) => openings.map((o) => ({
  what: o.source.kind === "url" ? o.source.url : `gist ${o.source.id}`, byDefault: o.byDefault,
}));
console.log(JSON.stringify({
  front: shown(sourcesToOpen("", base, defaults)),
  sceneOverrides: shown(sourcesToOpen("?scene=https://example.org/a.json", base, defaults)),
  gistOverrides: shown(sourcesToOpen("?gist=0123", base, defaults)),
  nothing: sourcesToOpen("", base, []),
  secondTab: sceneName(sourcesToOpen("", base, defaults)[1].source),
  frontName: sourcesToOpen("", base, defaults).map((o) => sceneName(o.source)),
}));
"""
    found = _run(body, {}, tmp_path)
    assert found["front"] == [
        {"what": "https://chazeon.github.io/gemmy/nacl/scene.json.gz", "byDefault": True},
        {"what": "https://chazeon.github.io/gemmy/ice-ih/scene.json.gz", "byDefault": True},
        {"what": "https://chazeon.github.io/gemmy/stishovite/scene.json.gz", "byDefault": True},
    ]
    assert found["sceneOverrides"] == [{"what": "https://example.org/a.json", "byDefault": False}]
    assert found["gistOverrides"] == [{"what": "gist 0123", "byDefault": False}]
    assert found["nothing"] == []
    assert found["secondTab"] == "ice-ih"
    assert found["frontName"] == ["nacl", "ice-ih", "stishovite"]


def test_a_default_tab_links_to_the_page_and_a_scene_tab_to_its_scene(tmp_path: Path) -> None:
    body = """
const page = "https://chazeon.github.io/gemmy/#view=persp;lens=50";
console.log(JSON.stringify({
  defaultTab: linkFor({ kind: "url", url: "https://chazeon.github.io/gemmy/nacl/scene.json.gz" }, true, page),
  sceneTab: linkFor({ kind: "url", url: "https://example.org/a.json" }, false, page),
  gistTab: linkFor({ kind: "gist", id: "0123", file: null }, false, page),
}));
"""
    assert _run(body, {}, tmp_path) == {
        "defaultTab": "https://chazeon.github.io/gemmy/",
        "sceneTab": "https://chazeon.github.io/gemmy/?scene=https%3A%2F%2Fexample.org%2Fa.json",
        "gistTab": "https://chazeon.github.io/gemmy/?gist=0123",
    }


# ---- the pages that carry the mode (the loader needs no scene in the page) ----


def _mode(page: str) -> str:
    match = re.search(r'<meta name="gemmy-mode" content="(\w+)"', page)
    assert match
    return match.group(1)


def test_the_loader_page_embeds_no_scene_and_says_load() -> None:
    page = render_loader_page()
    assert _mode(page) == "load"
    match = re.search(r'<script type="application/json" id="scene-data">(.*?)</script>', page, re.S)
    assert match and match.group(1).strip() == ""


def test_the_other_pages_say_scene_or_live() -> None:
    assert _mode(render_viewer(_scene_for_page(), "t")) == "scene"
    assert _mode(render_live_page("t")) == "live"


def _scene_for_page() -> dict:
    return {
        "schema_version": 2,
        "source_comment": "tiny",
        "materials": {"m": {"base_color": [1, 0, 0, 1]}},
        "points": [{"id": "p0", "element": "O", "position": [0, 0, 0]}],
        "topologies": [],
        "primitives": {"atoms": [{"id": "a0", "point_id": "p0", "radius": 1.0, "material_id": "m", "element": "O"}]},
        "cell": {"origin": [0, 0, 0], "vectors": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
    }
