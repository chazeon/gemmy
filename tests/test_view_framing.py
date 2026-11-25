"""Focused checks of the page's framing helpers (web/src/camera/framing.ts): the triad's on-screen decisions and the
quaternion rotation. The triad constants are read from gemmy.render.looks, so the page has to agree with Blender's.
The module runs in node, bundled by tests/viewer_bundle.py."""

from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path
from typing import Any

import pytest

from gemmy.render.looks import (
    AXES_ARROW_RADIUS,
    AXES_HEAD_LENGTH_RATIO,
    AXES_HEAD_RADIUS_RATIO,
    AXES_LABEL_PAD,
    AXES_LABEL_REACH,
)
from viewer_bundle import available, header

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")
SQRT_HALF = math.sqrt(0.5)
WIDTH, HEIGHT = 1000, 600
# geom.axis_label_position's cut-off (`flat > 0.15`) and geom.triad_layout's (`flat > 0.08`): both are strict.
LABEL_CUT_OFF = 0.15
HEAD_CUT_OFF = 0.08


def _run(body: str, args: Any, tmp_path: Path) -> Any:
    script = tmp_path / "framing.mjs"
    script.write_text(header() + "\nconst args = JSON.parse(process.argv[2]);\n" + body, encoding="utf-8")
    result = subprocess.run(["node", str(script), json.dumps(args)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _triad(dirs: list[list[float]], tmp_path: Path) -> dict:
    args = {"dirs": dirs, "width": WIDTH, "height": HEIGHT}
    return _run("console.log(JSON.stringify(triadLayout(args.dirs, args.width, args.height)));", args, tmp_path)


def _axis(flat: float) -> list[float]:
    """A unit direction whose on-screen part has length exactly `flat`, pointing right."""
    return [flat, 0.0, math.sqrt(1 - flat * flat)]


def _label_offset(layout: dict, item: dict) -> tuple[float, float]:
    ox, oy = layout["origin"]
    return item["label"]["x"] - ox, oy - item["label"]["y"]


def test_axis_pointing_at_the_viewer_has_a_label_but_no_arrow(tmp_path: Path) -> None:
    layout = _triad([[0.02, 0.0, 1.0]], tmp_path)
    item = layout["items"][0]
    assert "shaftEnd" not in item and "head" not in item
    # no screen direction: the label sits up and to the right of the origin, `labelPad` out on the diagonal
    pad = layout["length"] * AXES_LABEL_PAD
    dx, dy = _label_offset(layout, item)
    assert dx == pytest.approx(pad * SQRT_HALF) and dy == pytest.approx(pad * SQRT_HALF)


def test_label_is_diagonal_exactly_at_the_label_cut_off(tmp_path: Path) -> None:
    # Python uses `flat > 0.15`, so an axis exactly at the cut-off has no label reach along its (degenerate) arrow.
    layout = _triad([_axis(LABEL_CUT_OFF)], tmp_path)
    dx, dy = _label_offset(layout, layout["items"][0])
    pad = layout["length"] * AXES_LABEL_PAD
    assert dx == pytest.approx(pad * SQRT_HALF) and dy == pytest.approx(pad * SQRT_HALF)


def test_label_follows_the_arrow_just_above_the_label_cut_off(tmp_path: Path) -> None:
    flat = LABEL_CUT_OFF + 1e-6
    layout = _triad([_axis(flat)], tmp_path)
    dx, dy = _label_offset(layout, layout["items"][0])
    length = layout["length"]
    reach = length * (1 + AXES_LABEL_REACH * AXES_ARROW_RADIUS) * flat
    assert dx == pytest.approx(reach + length * AXES_LABEL_PAD)  # along the arrow: x is the full length
    assert dy == pytest.approx(0.0, abs=1e-9)


def test_no_arrow_exactly_at_the_head_cut_off(tmp_path: Path) -> None:
    # Python uses `flat > 0.08`: at the cut-off the axis has only its label; just above it the arrow is drawn.
    items = {
        item["index"]: item for item in _triad([_axis(HEAD_CUT_OFF), _axis(HEAD_CUT_OFF + 1e-6)], tmp_path)["items"]
    }
    at, above = items[0], items[1]
    assert "shaftEnd" not in at and "head" not in at
    assert "shaftEnd" in above and "head" in above


def test_short_on_screen_axis_has_an_arrow_with_a_diagonal_label(tmp_path: Path) -> None:
    # flat length 0.1 is between the arrow cut-off (0.08) and the label cut-off (0.15)
    layout = _triad([_axis(0.1)], tmp_path)
    item = layout["items"][0]
    assert "shaftEnd" in item and len(item["head"]) == 3
    pad = layout["length"] * AXES_LABEL_PAD
    dx, _ = _label_offset(layout, item)
    assert dx == pytest.approx(pad * SQRT_HALF)


def test_items_are_sorted_far_first(tmp_path: Path) -> None:
    layout = _triad([[1, 0, 0.5], [0, 1, -0.8], [0, 0, 0.9]], tmp_path)
    assert [item["index"] for item in layout["items"]] == [1, 0, 2]


def test_arrow_head_is_a_triangle_on_the_axis_with_blenders_proportions(tmp_path: Path) -> None:
    layout = _triad([[1, 0, 0]], tmp_path)
    item = layout["items"][0]
    tip, base_a, base_b = item["head"]
    ox, oy = layout["origin"]
    length = layout["length"]
    assert tip == pytest.approx([ox + length, oy])  # the tip is the full arrow length to the right
    # the head's base is a straight line across the axis, its two corners on opposite sides of it, equally far out
    assert base_a[0] == pytest.approx(base_b[0])
    assert (base_a[1] - oy) * (base_b[1] - oy) < 0
    assert base_a[1] + base_b[1] == pytest.approx(2 * oy)
    # Blender's proportions (gemmy.render.blender.overlay): the head is HEAD_LENGTH_RATIO of the arrow long, and
    # HEAD_RADIUS_RATIO times the arrow radius out on each side of the axis
    assert tip[0] - base_a[0] == pytest.approx(AXES_HEAD_LENGTH_RATIO * length)
    assert math.dist(base_a, base_b) == pytest.approx(2 * AXES_HEAD_RADIUS_RATIO * AXES_ARROW_RADIUS * length)
    # the shaft runs in from the origin and stops halfway into the head, so the join is hidden
    assert item["shaftEnd"][0] == pytest.approx(tip[0] - 0.5 * AXES_HEAD_LENGTH_RATIO * length)


def test_quaternion_turns_x_into_y_about_z(tmp_path: Path) -> None:
    half = math.sqrt(0.5)  # 90 degrees about z, as (x, y, z, w)
    got = _run("console.log(JSON.stringify(applyQuaternion(args.q, [1, 0, 0])));", {"q": [0, 0, half, half]}, tmp_path)
    assert got == pytest.approx([0, 1, 0], abs=1e-12)


def _off_axis_camera(off: float, dist: float) -> tuple[list[float], list[float]]:
    """A camera `dist` from the structure centre (the origin) on +x, turned about y so that the centre lies `off`
    degrees from its view axis. Returns (position, quaternion as x, y, z, w)."""
    phi = math.radians(90 + off)
    return [dist, 0.0, 0.0], [0.0, math.sin(phi / 2), 0.0, math.cos(phi / 2)]


@pytest.mark.parametrize(("off", "dist"), [(0, 30), (20, 60), (35, 150), (38, 150), (50, 40)])
def test_clip_planes_hold_every_structure_point_in_front_of_an_off_axis_camera(
    off: float, dist: float, tmp_path: Path
) -> None:
    # The structure is the sphere of radius extent / 2 about the origin. Every point of it in front of the camera must
    # lie between the near and far planes (depths along the view axis, not distances from the camera).
    extent = 20.3146
    position, quaternion = _off_axis_camera(off, dist)
    body = """
const { position, quaternion, extent } = args;
const radius = extent / 2;
const forward = viewForward(quaternion);
const steps = [-1, -0.5, 0, 0.5, 1].map((t) => t * radius);
const depths = [];
for (const x of steps) for (const y of steps) for (const z of steps) {
  if (Math.hypot(x, y, z) > radius) continue;
  const d = vdot(vsub([x, y, z], position), forward);
  if (d > 0) depths.push(d);
}
const planes = clipPlanesAround(depthOfCentre(position, quaternion), extent);
const minDepth = Math.min(...depths), maxDepth = Math.max(...depths);
console.log(JSON.stringify({ near: planes.near, far: planes.far, minDepth, maxDepth }));
"""
    out = _run(body, {"position": position, "quaternion": quaternion, "extent": extent}, tmp_path)
    assert out["near"] <= out["minDepth"] + 1e-9
    assert out["far"] >= out["maxDepth"] - 1e-9


def test_fly_moves_camera_and_target_together_along_the_view_axis(tmp_path: Path) -> None:
    # W/S fly the camera and the target by one world vector, along the view direction: the distance between them (and so
    # the perspective zoom) is unchanged.
    position, quaternion = _off_axis_camera(35, 120)
    target = [-3.0, 4.0, 1.0]
    body = """
const { position, quaternion, target, distance } = args;
const shift = flyShift(quaternion, distance);
const moved = (p) => p.map((x, i) => x + shift[i]);
console.log(JSON.stringify({
  before: span(target, position),
  after: span(moved(target), moved(position)),
  along: vdot(shift, viewForward(quaternion)),
  length: Math.hypot(...shift),
}));
"""
    out = _run(body, {"position": position, "quaternion": quaternion, "target": target, "distance": 7.5}, tmp_path)
    assert out["after"] == pytest.approx(out["before"], abs=1e-9)
    assert out["along"] == pytest.approx(7.5, abs=1e-9)
    assert out["length"] == pytest.approx(7.5, abs=1e-9)


# A camera turned off the view axis, with its target off the structure's centre: the case a pivot creates.
TURN = [0.21, 0.32, 0.09]
TURN_W = math.sqrt(1 - sum(x * x for x in TURN))
ORIENTATION = [*TURN, TURN_W]
TARGET = [-3.0, 4.0, 1.0]
EXTENT = 9.0


def test_pivot_along_the_view_ray_keeps_the_exported_camera(tmp_path: Path) -> None:
    # The page pivots the target with pivotTarget (camera/framing.ts, used by camera/pivot.ts) and then exports
    # zoom = baseDistance / distance to the new target. The implied camera position, target + forward * baseDistance /
    # zoom, must not move, while the target and the zoom do.
    args = {"quaternion": ORIENTATION, "target": TARGET, "extent": EXTENT, "zoom": 1.3, "hit": 6.2}
    body = """
const { quaternion, target, extent, zoom, hit } = args;
const base = baseDistance(extent);
const position = cameraPosition(quaternion, target, zoom, extent);
const pivot = pivotTarget(position, quaternion, target, hit, 0);
const pivotZoom = base / span(position, pivot);
const after = cameraPosition(quaternion, pivot, pivotZoom, extent);
console.log(JSON.stringify({ before: position, after, target, pivot, zoom, pivotZoom }));
"""
    out = _run(body, args, tmp_path)
    assert out["after"] == pytest.approx(out["before"], abs=1e-9)
    assert out["pivot"] != pytest.approx(out["target"], abs=1e-6)
    assert out["pivotZoom"] != pytest.approx(out["zoom"], abs=1e-6)


def test_pivot_clamps_a_near_hit_to_minimum_distance_and_skips_a_far_one(tmp_path: Path) -> None:
    # A hit nearer than minDistance pivots at minDistance, on the same ray. A hit not nearer than the
    # target is no pivot.
    args = {"quaternion": ORIENTATION, "target": TARGET, "extent": EXTENT, "zoom": 1.3}
    body = """
const { quaternion, target, extent, zoom } = args;
const position = cameraPosition(quaternion, target, zoom, extent);
const near = pivotTarget(position, quaternion, target, 0.2, 1.5);
const far = pivotTarget(position, quaternion, target, span(position, target) + 1, 1.5);
const onRay = vdot(vunit(vsub(near, position)), viewForward(quaternion));
console.log(JSON.stringify({ nearDistance: span(position, near), far, onRay }));
"""
    out = _run(body, args, tmp_path)
    assert out["nearDistance"] == pytest.approx(1.5, abs=1e-9)
    assert out["far"] is None
    assert out["onRay"] == pytest.approx(1.0, abs=1e-9)


def test_dolly_moves_the_camera_along_its_view_line_and_round_trips_the_export(tmp_path: Path) -> None:
    # The zoom buttons (camera/view.ts setShownZoom) slide the camera along its view line: the target and the
    # direction hold, the distance from the centre becomes the wanted one, and the exported zoom of the result
    # reproduces it.
    # hold, the distance from the centre becomes the wanted one, and the exported zoom of the result reproduces it.
    args = {"quaternion": ORIENTATION, "target": TARGET, "extent": EXTENT, "zoom": 1.3, "factor": 1.1}
    body = """
const { quaternion, target, extent, zoom, factor } = args;
const base = baseDistance(extent);
const position = cameraPosition(quaternion, target, zoom, extent);
// The zoom buttons work on the shown zoom, base / centre distance: one press multiplies it by the factor.
const wanted = centreDistance(position) / factor;
const moved = dollyPosition(position, target, wanted, 0, Infinity);
const exported = cameraPosition(quaternion, target, base / span(moved, target), extent);
const direction = (p) => vunit(vsub(p, target));
console.log(JSON.stringify({
  centreBefore: centreDistance(position),
  centreAfter: centreDistance(moved),
  wanted,
  sameLine: vdot(direction(position), direction(moved)),
  roundTrip: exported,
  moved,
}));
"""
    out = _run(body, args, tmp_path)
    assert out["centreAfter"] == pytest.approx(out["wanted"], abs=1e-9)
    assert out["centreAfter"] < out["centreBefore"]
    assert out["sameLine"] == pytest.approx(1.0, abs=1e-9)
    assert out["roundTrip"] == pytest.approx(out["moved"], abs=1e-9)


def test_dolly_stops_at_the_closest_approach_when_the_line_misses_the_centre(tmp_path: Path) -> None:
    # The view line runs at distance 10 from the origin, so a wanted distance of 5 is unreachable: the camera
    # stops at the line's nearest point to the origin, (10, 0, 0), and no nearer.
    # line's nearest point to the origin, (10, 0, 0), and no nearer.
    body = """
const moved = dollyPosition([10, 10, 0], [10, -5, 0], 5, 0, Infinity);
console.log(JSON.stringify({ moved, centre: centreDistance(moved) }));
"""
    out = _run(body, {}, tmp_path)
    assert out["moved"] == pytest.approx([10.0, 0.0, 0.0], abs=1e-9)
    assert out["centre"] == pytest.approx(10.0, abs=1e-9)


def test_dolly_is_null_at_the_target_and_clamped_to_the_trackball_minimum(tmp_path: Path) -> None:
    # A camera on its target has no view line to slide along (null). A wanted distance that would take the camera inside
    # minDistance from the target stops it at minDistance, on the same line.
    body = """
const atTarget = dollyPosition([1, 2, 3], [1, 2, 3], 2, 0, Infinity);
const clamped = dollyPosition([30, 0, 0], [0, 0, 0], 2, 5, 100);
console.log(JSON.stringify({ atTarget, clamped }));
"""
    out = _run(body, {}, tmp_path)
    assert out["atTarget"] is None
    assert out["clamped"] == pytest.approx([5.0, 0.0, 0.0], abs=1e-9)
