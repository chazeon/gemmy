"""Look-around (web/src/camera/view-state.ts turnedInPlace): inside the structure with nothing selected, a turn turns
the camera where it stands. The camera's place and its distance from the target hold, so the zoom readout does not
move; the orbit (rotated) moves the place. The moves are pure, so node runs them (tests/viewer_bundle.py)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from viewer_bundle import available, header

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")
EXTENT = 18.0
TOLERANCE = 1e-9

# The view is built in node, so its zoom is the real one: a camera `distance` from the target, looking along `back`.
BUILD = """
const extent = args.extent;
const make = (projection, distance, target) => ({
  target,
  orientation: orientationFromBasis(args.back, [0, 1, 0]),
  projection,
  lens: 50,
  zoom: projection === "persp" ? baseDistance(extent) / distance : 1,
});
const view = make(args.projection, args.distance, args.target);
const place = (s) => cameraPosition(s, extent);
const degreesBetween = (a, b) => {
  const cos = vdot(a, b) / (span([0, 0, 0], a) * span([0, 0, 0], b));
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
};
"""


def _run(body: str, args: dict[str, Any], tmp_path: Path) -> Any:
    script = tmp_path / "look.mjs"
    script.write_text(header() + "\nconst args = JSON.parse(process.argv[2]);\n" + BUILD + body, encoding="utf-8")
    result = subprocess.run(["node", str(script), json.dumps(args)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _args(projection: str, distance: float, **extra: Any) -> dict[str, Any]:
    base = {"extent": EXTENT, "back": [0.3, 0.5, 0.8], "projection": projection, "distance": distance}
    return {**base, "target": [1, 2, 3], **extra}


def test_turn_in_place_keeps_the_place_and_the_distance(tmp_path: Path) -> None:
    # Inside: a quarter of the extent from the target, so the camera is within the structure's bounds.
    body = """
const turned = turnedInPlace(view, [0, 1, 0], args.degrees, extent);
console.log(JSON.stringify({
  placeDrift: span(place(turned), place(view)),
  distanceDrift: span(place(turned), turned.target) - span(place(view), view.target),
  zoomDrift: shownZoom(turned, extent) - shownZoom(view, extent),
  turned: degreesBetween(applyQuaternion(view.orientation, [0, 0, 1]), applyQuaternion(turned.orientation, [0, 0, 1])),
  targetMoved: span(turned.target, view.target),
}));
"""
    got = _run(body, _args("persp", EXTENT / 4, degrees=30), tmp_path)
    assert got["placeDrift"] == pytest.approx(0.0, abs=TOLERANCE)
    assert got["distanceDrift"] == pytest.approx(0.0, abs=TOLERANCE)
    assert got["zoomDrift"] == pytest.approx(0.0, abs=TOLERANCE)
    assert got["turned"] == pytest.approx(30.0, abs=1e-6)
    assert got["targetMoved"] > 1.0


@pytest.mark.parametrize("projection", ["persp", "ortho"])
def test_small_turns_add_up_without_drift(tmp_path: Path, projection: str) -> None:
    # A tap is 5 degrees; a held key takes many of them. The place must not drift over them.
    body = """
let state = view;
for (let i = 0; i < args.turns; i++) state = turnedInPlace(state, [1, 0, 0], args.degrees, extent);
console.log(JSON.stringify({
  placeDrift: span(place(state), place(view)),
  distanceDrift: span(place(state), state.target) - span(place(view), view.target),
  zoomDrift: shownZoom(state, extent) - shownZoom(view, extent),
}));
"""
    got = _run(body, _args(projection, EXTENT / 4, degrees=5, turns=72), tmp_path)
    assert got["placeDrift"] == pytest.approx(0.0, abs=TOLERANCE)
    assert got["distanceDrift"] == pytest.approx(0.0, abs=TOLERANCE)
    assert got["zoomDrift"] == pytest.approx(0.0, abs=TOLERANCE)


def test_orbit_moves_the_place_and_keeps_the_target(tmp_path: Path) -> None:
    # Outside the structure a turn orbits: the target holds and the camera moves (unchanged behaviour).
    body = """
const orbited = rotated(view, [0, 1, 0], args.degrees);
console.log(JSON.stringify({
  targetMoved: span(orbited.target, view.target),
  placeMoved: span(place(orbited), place(view)),
  distanceDrift: span(place(orbited), orbited.target) - span(place(view), view.target),
}));
"""
    got = _run(body, _args("persp", EXTENT * 2, target=[0, 0, 0], degrees=30), tmp_path)
    assert got["targetMoved"] == pytest.approx(0.0, abs=TOLERANCE)
    assert got["placeMoved"] > 1.0
    assert got["distanceDrift"] == pytest.approx(0.0, abs=TOLERANCE)
