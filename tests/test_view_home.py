"""The start screen's pure parts: the home tab's operations, the strip's links (linksShown), both in
web/src/ui/tab-model.ts, the examples.json parse (scene/examples.ts) and a gist address (scene/source.ts). Run in node
through tests/viewer_bundle.py; the DOM (the card, the thumbnails) is checked in a browser."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from viewer_bundle import available, header

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")


def _run(body: str, args: Any, tmp_path: Path) -> Any:
    script = tmp_path / "home.mjs"
    script.write_text(header() + "\nconst args = JSON.parse(process.argv[2]);\n" + body, encoding="utf-8")
    result = subprocess.run(["node", str(script), json.dumps(args)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _tabs(body: str, args: Any, tmp_path: Path) -> Any:
    return _run(f"console.log(JSON.stringify(({body})(args)));", args, tmp_path)


def test_the_strip_marks_the_own_link_current_on_tab_zero(tmp_path: Path) -> None:
    body = "({ links, current }) => linksShown(links, current)"
    links = [{"label": "a", "href": "../a/", "own": False}, {"label": "b", "href": "../b/", "own": True}]
    on_tab_zero = _tabs(body, {"links": links, "current": 0}, tmp_path)
    assert [link["current"] for link in on_tab_zero] == [False, True]
    on_tab_one = _tabs(body, {"links": links, "current": 1}, tmp_path)
    assert [link["current"] for link in on_tab_one] == [False, False]


def test_closing_the_last_scene_tab_leaves_the_home_tab(tmp_path: Path) -> None:
    body = "({ tabs, k }) => closeTab(tabsOf(tabs, 0), k, 'home')"
    assert _tabs(body, {"tabs": ["scene"], "k": 0}, tmp_path) == {"tabs": ["home"], "current": 0}
    assert _tabs(body, {"tabs": ["home", "scene"], "k": 1}, tmp_path) == {"tabs": ["home"], "current": 0}


def test_closing_the_current_tab_shows_the_one_before_and_closing_another_keeps_it(tmp_path: Path) -> None:
    body = "({ tabs, k }) => closeTab(tabsOf(tabs, 2), k, 'home')"
    assert _tabs(body, {"tabs": ["a", "b", "c"], "k": 2}, tmp_path) == {"tabs": ["a", "b"], "current": 1}
    assert _tabs(body, {"tabs": ["a", "b", "c"], "k": 0}, tmp_path) == {"tabs": ["b", "c"], "current": 1}


def test_a_scene_opened_from_home_takes_its_place(tmp_path: Path) -> None:
    body = "({ tabs, current, opened, replace }) => openTabs(tabsOf(tabs, current), opened, replace)"
    replaced = {"tabs": ["a", "home", "c"], "current": 1, "opened": ["x", "y"], "replace": True}
    assert _tabs(body, replaced, tmp_path) == {"tabs": ["a", "x", "y", "c"], "current": 1}
    appended = {"tabs": ["a", "b"], "current": 0, "opened": ["x"], "replace": False}
    assert _tabs(body, appended, tmp_path) == {"tabs": ["a", "b", "x"], "current": 2}


def test_the_plus_button_adds_the_home_tab_as_the_current_one(tmp_path: Path) -> None:
    body = "({ tabs }) => addTab(tabsOf(tabs, 0), 'home')"
    assert _tabs(body, {"tabs": ["a"]}, tmp_path) == {"tabs": ["a", "home"], "current": 1}


def test_examples_json_is_a_list_of_complete_entries(tmp_path: Path) -> None:
    good = [
        {
            "name": "nacl",
            "title": "NaCl",
            "description": "Rock salt.",
            "scene": "nacl/scene.json.gz",
            "thumbnail": "nacl/thumbnail.png",
        }
    ]
    body = """({ value }) => {
      try { return { ok: parseExamples(value) }; } catch (e) { return { error: e.message }; }
    }"""
    assert _tabs(body, {"value": good}, tmp_path) == {"ok": good}
    assert "list" in _tabs(body, {"value": {"name": "x"}}, tmp_path)["error"]
    assert "list" in _tabs(body, {"value": [{"name": "x", "title": "X"}]}, tmp_path)["error"]
    no_thumbnail = [{k: v for k, v in good[0].items() if k != "thumbnail"}]
    assert "list" in _tabs(body, {"value": no_thumbnail}, tmp_path)["error"]


def test_a_gist_address_or_id_opens_the_gist(tmp_path: Path) -> None:
    body = """({ text }) => {
      try { return { ok: gistSourceOf(text) }; } catch (e) { return { error: e.message }; }
    }"""
    assert _tabs(body, {"text": "  0123abcd "}, tmp_path) == {"ok": {"kind": "gist", "id": "0123abcd", "file": None}}
    address = "https://gist.github.com/someone/0123abcd"
    assert _tabs(body, {"text": address}, tmp_path)["ok"]["id"] == "0123abcd"
    assert "gist id" in _tabs(body, {"text": "https://example.org/"}, tmp_path)["error"]
