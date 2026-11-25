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

from gemmy.geom import triad_draw
from gemmy.render.looks import (
    AXES_ARROW_RADIUS,
    AXES_HEAD_LENGTH_RATIO,
    AXES_HEAD_RADIUS_RATIO,
    AXES_LABEL_PAD,
    AXES_LABEL_REACH,
    DEPTH_FADE_MAX,
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


def test_axes_pointing_away_are_faded_and_counted_behind_the_ball(tmp_path: Path) -> None:
    layout = _triad([[1, 0, 0.5], [0, 1, -0.8], [0, 0, 0.9]], tmp_path)
    fades = {item["index"]: item["fade"] for item in layout["items"]}
    assert layout["behind"] == 1
    assert fades[1] == pytest.approx(0.8 * DEPTH_FADE_MAX) and fades[0] == 0.0 and fades[2] == 0.0


def test_page_draw_order_and_fade_are_the_python_ones(tmp_path: Path) -> None:
    # The page's triadLayout and geom.triad_draw must agree on the order, the count under the ball and the fades.
    dirs = [[0.6, 0.0, -0.8], [0.0, 0.6, 0.8], [0.8, 0.0, 0.6]]
    layout = _triad(dirs, tmp_path)
    expected = triad_draw([d[2] for d in dirs], DEPTH_FADE_MAX)
    assert [item["index"] for item in layout["items"]] == list(expected.order)
    assert layout["behind"] == expected.behind
    for item in layout["items"]:
        assert item["fade"] == pytest.approx(expected.fades[item["index"]])


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


# A view turned off the view axis, with its target off the structure's centre: the case a pivot creates.
TURN = [0.21, 0.32, 0.09]
TURN_W = math.sqrt(1 - sum(x * x for x in TURN))
ORIENTATION = [*TURN, TURN_W]
TARGET = [-3.0, 4.0, 1.0]
EXTENT = 9.0
VIEW = {"target": TARGET, "orientation": ORIENTATION, "zoom": 1.3, "projection": "persp", "lens": 50}


def test_pivot_keeps_the_camera_and_moves_the_target_onto_the_hit(tmp_path: Path) -> None:
    # The pivot (view-state.ts pivoted) moves the target along the view ray to the hit and sets the zoom from the new
    # distance. The camera position and the orientation do not change, so the picture does not.
    args = {"view": VIEW, "extent": EXTENT, "hit": 6.2}
    body = """
const { view, extent, hit } = args;
const before = cameraPosition(view, extent);
const next = pivoted(view, hit, 0, extent);
console.log(JSON.stringify({
  before, after: cameraPosition(next, extent), target: view.target, pivot: next.target,
  zoom: view.zoom, next: next.zoom,
  orientation: next.orientation,
}));
"""
    out = _run(body, args, tmp_path)
    assert out["after"] == pytest.approx(out["before"], abs=1e-9)
    assert out["orientation"] == pytest.approx(ORIENTATION, abs=1e-12)
    assert out["pivot"] != pytest.approx(out["target"], abs=1e-6)
    assert out["next"] != pytest.approx(out["zoom"], abs=1e-6)  # the readout follows the new distance


def test_pivot_clamps_a_near_hit_to_minimum_distance_and_skips_a_far_one(tmp_path: Path) -> None:
    # A hit nearer than minDistance pivots at minDistance, on the same ray. A hit not nearer than
    # the target is no pivot.
    args = {"view": VIEW, "extent": EXTENT}
    body = """
const { view, extent } = args;
const position = cameraPosition(view, extent);
const near = pivoted(view, 0.2, 1.5, extent);
const far = pivoted(view, span(position, view.target) + 1, 1.5, extent);
const onRay = vdot(vunit(vsub(near.target, position)), viewForward(view.orientation));
console.log(JSON.stringify({ nearDistance: span(position, near.target), far, onRay }));
"""
    out = _run(body, args, tmp_path)
    assert out["nearDistance"] == pytest.approx(1.5, abs=1e-9)
    assert out["far"] is None
    assert out["onRay"] == pytest.approx(1.0, abs=1e-9)


def test_releasing_the_pivot_keeps_the_camera_and_puts_the_target_at_the_centres_depth(tmp_path: Path) -> None:
    args = {"view": VIEW, "extent": EXTENT}
    body = """
const { view, extent } = args;
const before = cameraPosition(view, extent);
const next = released(view, extent, 0.5, 1000);
const depth = depthOfCentre(before, view.orientation);
console.log(JSON.stringify({
  before, after: cameraPosition(next, extent), depth, target: next.target, zoom: next.zoom,
}));
"""
    out = _run(body, args, tmp_path)
    assert out["after"] == pytest.approx(out["before"], abs=1e-9)
    assert span_of(out["target"], out["before"]) == pytest.approx(out["depth"], abs=1e-9)


def span_of(a: list, b: list) -> float:
    return math.dist(a, b)


def test_rotating_turns_the_camera_about_the_target_at_the_same_distance(tmp_path: Path) -> None:
    args = {"view": VIEW, "extent": EXTENT, "degrees": 25}
    body = """
const { view, extent, degrees } = args;
const next = rotated(view, [0, 1, 0], degrees);
console.log(JSON.stringify({ before: span(cameraPosition(view, extent), view.target),
  after: span(cameraPosition(next, extent), next.target), target: next.target, moved: cameraPosition(next, extent) }));
"""
    out = _run(body, args, tmp_path)
    assert out["after"] == pytest.approx(out["before"], abs=1e-9)
    assert out["target"] == pytest.approx(TARGET)


def test_a_zoom_is_the_base_distance_over_the_camera_distance(tmp_path: Path) -> None:
    args = {"view": VIEW, "extent": EXTENT}
    body = """
const { view, extent } = args;
const distance = span(cameraPosition(view, extent), view.target);
console.log(JSON.stringify({ distance, back: baseDistance(extent) / distance }));
"""
    out = _run(body, args, tmp_path)
    assert out["back"] == pytest.approx(VIEW["zoom"], abs=1e-9)


def test_orientation_from_a_basis_looks_along_back_with_up_on_screen(tmp_path: Path) -> None:
    body = """
const back = [0.3, -0.5, 0.8];
const up = [0, 0, 1];
const q = orientationFromBasis(back, up);
const z = applyQuaternion(q, [0, 0, 1]), y = applyQuaternion(q, [0, 1, 0]);
const along = vscale(vunit(back), vdot(up, vunit(back)));
const want = vunit(vsub(up, along));
console.log(JSON.stringify({ z: vunit(back), got: z, up: y, want, length: Math.hypot(...q) }));
"""
    out = _run(body, {}, tmp_path)
    assert out["got"] == pytest.approx(out["z"], abs=1e-12)
    assert out["up"] == pytest.approx(out["want"], abs=1e-12)
    assert out["length"] == pytest.approx(1.0, abs=1e-12)


def test_orientation_from_a_basis_with_up_along_the_sightline_is_finite_and_looks_back(tmp_path: Path) -> None:
    body = """
const back = [1, 0, 0];
const q = orientationFromBasis(back, [1, 0, 0]);
const z = applyQuaternion(q, [0, 0, 1]);
console.log(JSON.stringify({ q, z, length: Math.hypot(...q) }));
"""
    out = _run(body, {}, tmp_path)
    assert all(math.isfinite(x) for x in out["q"])
    assert out["length"] == pytest.approx(1.0, abs=1e-12)
    assert out["z"] == pytest.approx([1, 0, 0], abs=1e-3)


def test_switching_projection_keeps_the_framing_and_a_fitted_view_stays_fitted(tmp_path: Path) -> None:
    args = {"view": VIEW, "extent": EXTENT, "width": 1000, "height": 600}
    body = """
const { view, extent, width, height } = args;
const frame = { width, height };
const ortho = withProjection(view, "ortho", 50, extent, frame);
const back = withProjection(ortho, "persp", 50, extent, frame);
const fitted = fitZoomFor("persp", 50, extent, frame);
const atFit = withProjection(zoomedTo(view, fitted, extent), "ortho", 50, extent, frame);
const want = fitZoomFor("ortho", 50, extent, frame);
console.log(JSON.stringify({ back: back.zoom, orthoZoom: ortho.zoom, fitted: atFit.zoom, want }));
"""
    out = _run(body, args, tmp_path)
    assert out["back"] == pytest.approx(VIEW["zoom"], abs=1e-9)
    assert out["fitted"] == pytest.approx(out["want"], abs=1e-9)


def test_a_glide_starts_and_ends_at_its_two_views(tmp_path: Path) -> None:
    args = {"from": VIEW, "to": {**VIEW, "target": [0, 0, 0], "zoom": 2.5}}
    body = """
const start = interpolated(args.from, args.to, 0), end = interpolated(args.from, args.to, 1);
const half = interpolated(args.from, args.to, 0.5);
console.log(JSON.stringify({
  start: start.zoom, end: end.zoom, half: half.zoom, target: end.target, mid: half.target,
}));
"""
    out = _run(body, args, tmp_path)
    assert out["start"] == pytest.approx(VIEW["zoom"]) and out["end"] == pytest.approx(2.5)
    assert out["half"] == pytest.approx((VIEW["zoom"] * 2.5) ** 0.5)  # the zoom moves by a constant ratio
    assert out["target"] == pytest.approx([0, 0, 0]) and out["mid"] == pytest.approx([-1.5, 2.0, 0.5])


def test_the_readout_holds_still_through_a_pivot_and_its_release(tmp_path: Path) -> None:
    # The readout is the base distance over the camera's distance from the structure's centre, so the pivot (which moves
    # only the target) and its release (which slides the target along the view line) leave it unchanged.
    args = {"view": VIEW, "extent": EXTENT, "hit": 6.2}
    body = """
const { view, extent, hit } = args;
const before = shownZoom(view, extent);
const pivot = pivoted(view, hit, 0, extent);
const released_ = released(pivot, extent, 0.5, 1000);
console.log(JSON.stringify({ before, pivot: shownZoom(pivot, extent), released: shownZoom(released_, extent) }));
"""
    out = _run(body, args, tmp_path)
    assert out["pivot"] == pytest.approx(out["before"], abs=1e-9)
    assert out["released"] == pytest.approx(out["before"], abs=1e-9)


def test_the_zoom_buttons_set_the_readout_and_keep_the_target(tmp_path: Path) -> None:
    # The zoom buttons slide the camera along its view line: the readout becomes the wanted one, the target and the
    # direction hold, and the camera's own zoom follows the new distance.
    args = {"view": VIEW, "extent": EXTENT, "wanted": 1.1}
    body = """
const { view, extent, wanted } = args;
const moved = zoomedTo(view, wanted, extent);
const direction = (v) => vunit(vsub(cameraPosition(v, extent), v.target));
console.log(JSON.stringify({
  shown: shownZoom(moved, extent), target: moved.target, targetBefore: view.target,
  sameLine: vdot(direction(view), direction(moved)), zoom: moved.zoom,
}));
"""
    out = _run(body, args, tmp_path)
    assert out["shown"] == pytest.approx(1.1, abs=1e-9)
    assert out["target"] == pytest.approx(out["targetBefore"], abs=1e-12)
    assert out["sameLine"] == pytest.approx(1.0, abs=1e-9)
    assert out["zoom"] != pytest.approx(VIEW["zoom"], abs=1e-6)


def test_a_dolly_past_the_line_s_nearest_point_stops_there(tmp_path: Path) -> None:
    # A view line that misses the structure's centre by 10 cannot reach a readout that needs a distance of 5: the camera
    # stops at the line's nearest point to the origin, and no nearer.
    body = """
const view = { target: [10, -5, 0], orientation: [0, 0, 0, 1], zoom: 1, projection: "persp", lens: 50 };
const moved = dollied({ ...view, target: [10, -5, 0] }, 1000, 1);
console.log(JSON.stringify({ centre: Math.hypot(...cameraPosition(moved, 1)) }));
"""
    out = _run(body, {}, tmp_path)
    assert out["centre"] >= 10 - 1e-9
