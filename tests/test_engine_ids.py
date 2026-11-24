from __future__ import annotations

import pytest

from gemmy.render.blender.renderer import engine_candidates, pick_engine_id


def test_eevee_picks_whatever_the_build_offers() -> None:
    assert pick_engine_id("EEVEE", {"BLENDER_EEVEE"}.__contains__) == "BLENDER_EEVEE"  # Blender 5.x
    assert pick_engine_id("eevee", {"BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"}.__contains__) == "BLENDER_EEVEE_NEXT"
    assert pick_engine_id("EEVEE", {"BLENDER_EEVEE_NEXT"}.__contains__) == "BLENDER_EEVEE_NEXT"  # 4.2-4.5


def test_other_engines_and_errors() -> None:
    assert engine_candidates("cycles") == ("CYCLES",)
    with pytest.raises(ValueError):
        engine_candidates("luxrender")
    with pytest.raises(ValueError):
        pick_engine_id("EEVEE", lambda _id: False)
