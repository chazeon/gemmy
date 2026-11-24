from __future__ import annotations

import pytest

from gemmy.render.looks import LOOKS, get_look, resolved_for_background


def test_registry_has_default_classic_and_3to2d() -> None:
    assert {"default", "classic", "3to2d"} <= set(LOOKS)


def test_default_look_is_not_washed_out() -> None:
    look = get_look("default")
    assert look.view_transform == "Standard" and look.exposure <= 0.1 and not look.backdrop


def test_classic_keeps_old_look() -> None:
    look = get_look("classic")
    assert look.view_transform == "AgX" and look.exposure == 0.35 and look.backdrop


def test_transparent_variant_collapses() -> None:
    look = resolved_for_background(get_look("classic"), True)
    assert look.exposure == 0.45 and look.world_strength == 0.42


def test_unknown_look() -> None:
    with pytest.raises(ValueError):
        get_look("nope")


def test_3to2d_is_toon_shaded_with_resolution_relative_outline() -> None:
    look = get_look("3to2d")
    assert look.toon_bands and look.freestyle and 0 < look.outline_width < 0.05
