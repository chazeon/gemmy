"""The geometry of the range histogram (web/src/react/style-panel/range-histogram-layout.ts): where the bars, the band
and the handles sit on the strip, the snapping of a value to its step, and the move of one handle past the other. Run in
node through tests/viewer_bundle.py; skipped without node."""

from __future__ import annotations

import pytest

from viewer_bundle import available, node_json

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")

DOMAIN = {"min": 0.0, "max": 4.0}
HISTOGRAM = {"edges": [1.0, 2.0, 3.0, 4.0], "counts": [1, 4, 2]}


def test_bars_sit_at_their_edges_and_are_as_tall_as_their_count() -> None:
    boxes = node_json(
        "const result = viewer.barBoxes(args[0], args[1], args[2]);", HISTOGRAM, DOMAIN, {"min": 0, "max": 4}
    )
    assert [box["left"] for box in boxes] == [0.25, 0.5, 0.75]
    assert [box["width"] for box in boxes] == [0.25, 0.25, 0.25]
    assert [box["height"] for box in boxes] == pytest.approx([0.9 / 4, 0.9, 0.45])


def test_bars_outside_the_window_are_not_in_it() -> None:
    boxes = node_json(
        "const result = viewer.barBoxes(args[0], args[1], args[2]);", HISTOGRAM, DOMAIN, {"min": 3.5, "max": 4}
    )
    assert [box["inWindow"] for box in boxes] == [False, False, True]


def test_a_bar_that_only_touches_the_window_is_in_it() -> None:
    boxes = node_json(
        "const result = viewer.barBoxes(args[0], args[1], args[2]);", HISTOGRAM, DOMAIN, {"min": 2.0, "max": 2.0}
    )
    assert [box["inWindow"] for box in boxes] == [True, True, False]


def test_the_band_covers_the_window() -> None:
    band = node_json("const result = viewer.bandBox(args[0], args[1]);", {"min": 1, "max": 3}, DOMAIN)
    assert band == pytest.approx({"left": 0.25, "width": 0.5})


def test_snapping_rounds_to_the_step_and_keeps_the_domain() -> None:
    assert node_json("const result = viewer.snapToStep(args[0], args[1], args[2]);", 0.3, DOMAIN, 0.1) == 0.3
    assert node_json("const result = viewer.snapToStep(args[0], args[1], args[2]);", 1.2345, DOMAIN, 0.01) == 1.23
    assert node_json("const result = viewer.snapToStep(args[0], args[1], args[2]);", -0.4, DOMAIN, 0.01) == 0
    assert node_json("const result = viewer.snapToStep(args[0], args[1], args[2]);", 9, DOMAIN, 0.01) == 4


def test_decimals_follow_the_step() -> None:
    assert [node_json("const result = viewer.decimalsOf(args[0]);", step) for step in [1, 0.1, 0.01]] == [0, 1, 2]


def test_a_handle_moved_past_the_other_stops_at_it() -> None:
    window = {"min": 1, "max": 3}
    moved = node_json("const result = viewer.movedWindow(args[0], args[1], args[2]);", window, "min", 3.5)
    assert moved == {"min": 3, "max": 3}
    moved = node_json("const result = viewer.movedWindow(args[0], args[1], args[2]);", window, "max", 0.5)
    assert moved == {"min": 1, "max": 1}
    moved = node_json("const result = viewer.movedWindow(args[0], args[1], args[2]);", window, "max", 2.5)
    assert moved == {"min": 1, "max": 2.5}


def test_fraction_and_value_are_inverse_and_clamped() -> None:
    assert node_json("const result = viewer.fractionOf(args[0], args[1]);", 1, DOMAIN) == 0.25
    assert node_json("const result = viewer.fractionOf(args[0], args[1]);", 9, DOMAIN) == 1
    assert node_json("const result = viewer.valueAt(args[0], args[1]);", 0.5, DOMAIN) == 2
