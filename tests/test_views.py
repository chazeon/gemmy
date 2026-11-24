from __future__ import annotations

import pytest

from gemmy.render import looks as c


def test_named_views_are_nonzero_directions() -> None:
    assert "top" in c.VIEW_DIRECTIONS
    assert all(any(d) for d in c.VIEW_DIRECTIONS.values())


def test_zoom_scales_distance_and_ortho_scale() -> None:
    assert c.camera_distance(10, 2.0) == pytest.approx(c.camera_distance(10, 1.0) / 2)
    assert c.ortho_scale(10, 2.0) == pytest.approx(5.5)
    assert c.camera_distance(0.1, 1.0) == pytest.approx(4.0)
