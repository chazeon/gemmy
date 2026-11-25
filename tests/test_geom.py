"""Unit tests for gemmy.geom, including the degenerate inputs."""

from __future__ import annotations

import math

import pytest

from gemmy import geom as g
from gemmy.render.looks import VIEW_DIRECTIONS


def _close(a, b, tol=1e-9) -> bool:
    return all(abs(x - y) < tol for x, y in zip(a, b, strict=True))


# vectors -------------------------------------------------------------------------------------------------


def test_vector_helpers() -> None:
    assert g.dot((1, 2, 3), (4, 5, 6)) == 32
    assert g.cross((1, 0, 0), (0, 1, 0)) == (0, 0, 1)
    assert g.length((3, 4, 0)) == 5
    assert g.sub((3, 2, 1), (1, 1, 1)) == (2, 1, 0)
    assert _close(g.normalize((0, 0, 5)), (0, 0, 1))


def test_normalize_zero_vector_rejected() -> None:
    with pytest.raises(ValueError):
        g.normalize((0, 0, 0))


def test_angles_to_direction() -> None:
    assert _close(g.direction_from_angles(0, 0), (1, 0, 0))
    assert _close(g.direction_from_angles(90, 0), (0, 1, 0))
    assert _close(g.direction_from_angles(0, 90), (0, 0, 1))
    assert _close(g.direction_from_angles(-45, 35.264), (0.57735, -0.57735, 0.57735), 1e-4)


# rotations -------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("v", [(0, 0, 1), (0, 0, 5), (1, 0, 0), (0, -2, 0), (1, 1, 1), (-1, 2, -3), (1e-6, 0, 1)])
def test_rotation_from_z_maps_z_onto_vector(v) -> None:
    q = g.rotation_from_z(v)
    assert math.isclose(sum(c * c for c in q), 1.0)
    assert _close(g.rotate(q, (0, 0, 1)), g.normalize(v), 1e-7)


def test_rotation_from_z_parallel_is_identity() -> None:
    assert g.rotation_from_z((0, 0, 3)) == pytest.approx((1.0, 0.0, 0.0, 0.0))


def test_rotation_from_z_antiparallel_flips() -> None:
    q = g.rotation_from_z((0, 0, -2))
    assert _close(g.rotate(q, (0, 0, 1)), (0, 0, -1), 1e-9)


def test_rotation_from_z_zero_vector_rejected() -> None:
    with pytest.raises(ValueError):
        g.rotation_from_z((0, 0, 0))


def test_quat_inverse_undoes_rotation() -> None:
    q = g.rotation_from_z((1, 2, 3))
    v = (0.3, -0.4, 0.5)
    assert _close(g.rotate(g.quat_inverse(q), g.rotate(q, v)), v, 1e-9)


@pytest.mark.parametrize("name", list(VIEW_DIRECTIONS))
def test_look_at_faces_target_with_upright_camera(name: str) -> None:
    direction = VIEW_DIRECTIONS[name]
    target = (1.0, -2.0, 3.0)
    loc, q = g.look_at(target, direction, 10.0)
    forward = g.rotate(q, (0, 0, -1))
    assert _close(forward, g.normalize(g.sub(target, loc)), 1e-7)
    assert math.dist(loc, target) == pytest.approx(10.0)
    if abs(g.normalize(direction)[2]) < 0.999:
        assert g.rotate(q, (0, 1, 0))[2] > 0  # world up stays up


def test_top_down_view_has_y_up_and_front_has_z_up() -> None:
    _, q = g.look_at((0, 0, 0), (0, 0, 1), 5.0)
    assert _close(g.rotate(q, (0, 1, 0)), (0, 1, 0), 1e-7)
    _, q = g.look_at((0, 0, 0), (0, 0, -1), 5.0)  # straight from below also stays well defined
    assert _close(g.rotate(q, (0, 0, -1)), (0, 0, 1), 1e-7)
    _, q = g.look_at((0, 0, 0), (0, -1, 0), 5.0)
    assert _close(g.rotate(q, (0, 1, 0)), (0, 0, 1), 1e-7)
    assert _close(g.rotate(q, (1, 0, 0)), (1, 0, 0), 1e-7)


def test_explicit_up_and_parallel_up_fallback() -> None:
    right, up, _ = g.camera_basis((1, 0, 0), up=(1, 0, 0))
    assert abs(g.dot(right, up)) < 1e-9


def test_zero_direction_rejected() -> None:
    with pytest.raises(ValueError):
        g.camera_basis((0, 0, 0))


@pytest.mark.parametrize("branch", ["x", "y", "z", "trace"])
def test_matrix_to_quaternion_covers_every_branch(branch: str) -> None:
    # Rotations by 180 degrees about each axis hit the non-trace branches; identity hits the trace branch.
    basis = {
        "trace": ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
        "x": ((1, 0, 0), (0, -1, 0), (0, 0, -1)),
        "y": ((-1, 0, 0), (0, 1, 0), (0, 0, -1)),
        "z": ((-1, 0, 0), (0, -1, 0), (0, 0, 1)),
    }[branch]
    q = g.matrix_to_quaternion(*basis)
    assert _close(g.rotate(q, (1, 0, 0)), basis[0], 1e-9)
    assert _close(g.rotate(q, (0, 1, 0)), basis[1], 1e-9)
    assert _close(g.rotate(q, (0, 0, 1)), basis[2], 1e-9)


# primitives ------------------------------------------------------------------------------------------------


def test_cylinder_pose() -> None:
    pose = g.cylinder_pose((0, 0, 0), (0, 0, 4))
    assert pose.center == (0, 0, 2) and pose.length == 4
    assert _close(g.rotate(pose.rotation, (0, 0, 1)), (0, 0, 1))
    pose = g.cylinder_pose((1, 1, 1), (1, 3, 1))
    assert _close(g.rotate(pose.rotation, (0, 0, 1)), (0, 1, 0), 1e-9)


def test_cylinder_pose_zero_length_is_none() -> None:
    assert g.cylinder_pose((1, 2, 3), (1, 2, 3)) is None


def test_arrow_parts_split() -> None:
    parts = g.arrow_parts((0, 0, 0), (0, 0, 10), radius=0.1, head_length_ratio=0.22)
    assert parts.head_length == pytest.approx(2.2)
    assert _close(parts.shaft_end, (0, 0, 7.8))
    assert _close(parts.head_center, (0, 0, 8.9))
    assert _close(g.rotate(parts.rotation, (0, 0, 1)), (0, 0, 1))


def test_arrow_head_is_at_least_three_radii_and_at_most_80_percent() -> None:
    short_head = g.arrow_parts((0, 0, 0), (0, 0, 10), radius=1.0, head_length_ratio=0.01)
    assert short_head.head_length == pytest.approx(3.0)
    long_head = g.arrow_parts((0, 0, 0), (0, 0, 10), radius=0.1, head_length_ratio=0.9)
    assert long_head.head_length == pytest.approx(8.0)
    owner_default = g.arrow_parts((0, 0, 0), (0, 0, 10), radius=0.1, head_length_ratio=0.6)
    assert owner_default.head_length == pytest.approx(6.0)  # not clipped


def test_arrow_span_tail_and_tip() -> None:
    assert g.arrow_span((1, 0, 0), (0.5, 0, 0), "tail") == ((1, 0, 0), (1.5, 0, 0))
    assert g.arrow_span((1, 0, 0), (-0.5, 0, 0), "tip") == ((1.5, 0, 0), (1, 0, 0))  # outside, head on the atom


def test_arrow_pointing_down_and_zero_length() -> None:
    down = g.arrow_parts((0, 0, 0), (0, 0, -10), radius=0.1, head_length_ratio=0.2)
    assert _close(g.rotate(down.rotation, (0, 0, 1)), (0, 0, -1), 1e-9)
    assert g.arrow_parts((1, 1, 1), (1, 1, 1), 0.1, 0.2) is None


# scene extent ----------------------------------------------------------------------------------------------


def test_bounds() -> None:
    center, extent = g.bounds([(0, 0, 0), (2, 4, 4)])
    assert center == (1, 2, 2) and extent == pytest.approx(6.0)


def test_bounds_degenerate() -> None:
    assert g.bounds([]) == ((0.0, 0.0, 0.0), 1.0)
    assert g.bounds([(5, 5, 5)]) == ((5, 5, 5), 1.0)  # a single point still gets a unit frame


def test_shrink_about_centroid() -> None:
    vertices = [(0, 0, 0), (2, 0, 0), (0, 2, 0), (0, 0, 2)]
    assert g.shrink(vertices, 1.0) == vertices
    half = g.shrink(vertices, 0.5)
    assert _close(half[0], (0.25, 0.25, 0.25)) and _close(half[1], (1.25, 0.25, 0.25))
    assert g.shrink([], 0.5) == []


# screen-relative directions and axis labels --------------------------------------------------------------


def test_screen_direction_follows_the_screen_up() -> None:
    # Looking down -z with +x up on screen, "up" on screen is +x and "right" is -y.
    assert _close(g.screen_direction((0, 0, 1), (0, 1, 0), up=(1, 0, 0)), (1, 0, 0))
    assert _close(g.screen_direction((0, 0, 1), (1, 0, 0), up=(1, 0, 0)), (0, -1, 0))


def test_screen_direction_is_relative_to_the_camera() -> None:
    d = g.screen_direction((0, 0, 1), (0, 0, 1))  # straight towards the viewer
    assert _close(d, (0, 0, 1))
    right, up, back = g.camera_basis((1, -1, 0.75))
    sun = g.screen_direction((1, -1, 0.75), (-0.5, 0.6, 0.6))
    assert g.dot(sun, right) < 0 < g.dot(sun, up) and g.dot(sun, back) > 0  # upper left, towards the viewer
    assert g.length(sun) == pytest.approx(1.0)


def _cam(direction):
    return g.look_at((0, 0, 0), direction, 1.0)[1]


def test_axis_label_follows_the_projected_tip() -> None:
    q = _cam((0, -1, 0))  # looking along +y: x to the right, z up
    x = g.axis_label_position((1, 0, 0), q, length=2.0, pad=0.5)
    z = g.axis_label_position((0, 0, 1), q, length=2.0, pad=0.5)
    assert _close(x, (2.5, 0, 0), 1e-9) and _close(z, (0, 2.5, 0), 1e-9)


def test_axis_label_of_an_axis_pointing_at_the_viewer_sits_beside_the_dot() -> None:
    q = _cam((0, 0, 1))  # top-down: c points at the viewer
    x, y, z = g.axis_label_position((0, 0, 1), q, length=2.0, pad=0.5)
    assert x == pytest.approx(y) and x > 0 and z == 0
    assert math.hypot(x, y) == pytest.approx(0.5)  # at the pad distance from the origin, not at the tip


def _layout(direction, q, length=2.0):
    kw = dict(arrow_radius=0.05, head_length_ratio=0.2, head_radius_ratio=2.0, label_reach=2.0, label_pad=0.1)
    return g.triad_layout((direction,), q, length, **kw)[0]


def test_triad_arrow_is_the_projected_axis() -> None:
    q = _cam((0, -1, 0))  # x right, z up
    arrow = _layout((1, 0, 0), q)
    assert arrow.head[0] == pytest.approx((2.0, 0.0))  # tip at length along the screen direction
    xs = [p[0] for p in arrow.head]
    assert max(xs) == pytest.approx(2.0) and min(xs) == pytest.approx(2.0 - 0.4)
    assert arrow.shaft[0][0] == pytest.approx(0.0) and arrow.shaft[0][1] == pytest.approx(-0.1)
    assert arrow.shaft[2][0] == pytest.approx(2.0 - 0.2) and arrow.shaft[2][1] == pytest.approx(0.1)
    assert arrow.label == pytest.approx(g.axis_label_position((1, 0, 0), q, 2.0 * 1.1, 0.2)[:2])
    up = _layout((0, 0, 1), q)
    assert up.head[0] == pytest.approx((0.0, 2.0), abs=1e-9)


def test_triad_arrow_pointing_at_the_viewer_has_no_shape_and_is_nearest() -> None:
    q = _cam((0, 0, 1))
    arrow = _layout((0, 0, 1), q)
    assert arrow.shaft == () and arrow.head == () and arrow.depth == pytest.approx(1.0)
    assert _layout((1, 0, 0), q).depth == pytest.approx(0.0, abs=1e-9)


def test_label_font_first_existing_candidate_wins(tmp_path) -> None:
    from gemmy.render.looks import label_font

    present = tmp_path / "b.ttf"
    present.write_bytes(b"")
    missing = str(tmp_path / "a.ttf")
    assert label_font(None, (missing, str(present))) == str(present)
    assert label_font(None, (missing,)) is None
    assert label_font(str(present), ()) == str(present)
    with pytest.raises(FileNotFoundError):
        label_font(missing)


# broken lines --------------------------------------------------------------------------------------------


def test_dashes_fit_exactly_and_start_and_end_with_a_dash() -> None:
    dashes = g.dash_segments((0, 0, 0), (1, 0, 0), dash=0.12, gap=0.08)
    assert len(dashes) == 5  # (1 + 0.08) / 0.2 = 5.4
    assert _close(dashes[0][0], (0, 0, 0)) and _close(dashes[-1][1], (1, 0, 0))
    lengths = [b[0] - a[0] for a, b in dashes]
    gaps = [dashes[i + 1][0][0] - dashes[i][1][0] for i in range(len(dashes) - 1)]
    assert max(lengths) - min(lengths) < 1e-12 and max(gaps) - min(gaps) < 1e-12
    assert lengths[0] / gaps[0] == pytest.approx(0.12 / 0.08)
    assert g.dash_segments((0, 0, 0), (0.01, 0, 0), dash=0.12, gap=0.08) == [((0, 0, 0), (0.01, 0, 0))]
    assert g.dash_segments((1, 1, 1), (1, 1, 1), dash=0.1, gap=0.1) == []


def test_dots_sit_between_the_atoms() -> None:
    dots = g.dot_centres((0, 0, 0), (0, 0, 2), spacing=0.5)
    assert [d[2] for d in dots] == pytest.approx([0.25, 0.75, 1.25, 1.75])
    assert g.dot_centres((0, 0, 0), (0, 0, 0), spacing=0.5) == []


def _volume(mesh) -> float:
    """Signed volume (positive when every face winds counter-clockwise seen from outside)."""
    vertices, faces = mesh
    total = 0.0
    for face in faces:
        for k in range(1, len(face) - 1):
            a, b, c = vertices[face[0]], vertices[face[k]], vertices[face[k + 1]]
            total += g.dot(a, g.cross(b, c)) / 6
    return total


def test_unit_meshes_are_closed_outward_solids() -> None:
    n = g.CYLINDER_SIDES
    assert _volume(g.unit_cylinder()) == pytest.approx(0.5 * n * math.sin(2 * math.pi / n) * 1.0)
    assert _volume(g.unit_cone()) == pytest.approx(0.5 * n * math.sin(2 * math.pi / n) / 3)
    sphere = g.unit_sphere(48, 32)
    assert 0.98 * 4 / 3 * math.pi < _volume(sphere) < 4 / 3 * math.pi
    assert len(sphere[0]) == 48 * 31 + 2 and len(sphere[1]) == 48 * 32


def test_place_mesh_scales_rotates_and_offsets() -> None:
    vertices, faces = [], []
    pose = g.cylinder_pose((0, 0, 0), (0, 2, 0))
    g.place_mesh(g.unit_cylinder(), pose.center, pose.rotation, (0.1, 0.1, pose.length), vertices, faces)
    g.place_mesh(g.unit_cylinder(), (5, 0, 0), (1, 0, 0, 0), (1, 1, 1), vertices, faces)
    n = len(g.unit_cylinder()[0])
    ys = [v[1] for v in vertices[:n]]
    assert min(ys) == pytest.approx(0.0) and max(ys) == pytest.approx(2.0)
    assert max(abs(v[0]) for v in vertices[:n]) == pytest.approx(0.1)
    assert faces[len(g.unit_cylinder()[1])][0] >= n and min(v[0] for v in vertices[n:]) == pytest.approx(4.0)


def test_disc_outline_is_on_its_circle() -> None:
    points = g.disc(0.5, 8)
    assert len(points) == 8 and points[0] == pytest.approx((0.5, 0.0))
    assert all(math.hypot(x, y) == pytest.approx(0.5) for x, y in points)


def test_triad_draw_straight_on_has_no_fade_and_no_axis_behind_the_ball() -> None:
    draw = g.triad_draw([0.5, 0.9, 0.2], fade_max=0.35)
    assert draw.order == (2, 0, 1) and draw.behind == 0
    assert draw.fades == (0.0, 0.0, 0.0)


def test_triad_draw_edge_on_is_not_faded_and_draws_over_the_ball() -> None:
    draw = g.triad_draw([0.0, -0.0, 0.3], fade_max=0.35)  # exactly edge-on counts as towards the viewer
    assert draw.behind == 0 and draw.fades == (0.0, 0.0, 0.0)


def test_triad_draw_away_axes_go_under_the_ball_farthest_first() -> None:
    draw = g.triad_draw([-1.0, 0.3, -0.5], fade_max=0.35)
    assert draw.order == (0, 2, 1) and draw.behind == 2  # order[:2] under the ball, axis 1 over it
    assert draw.fades == pytest.approx((0.35, 0.0, 0.175))  # straight away is the full fade, half-away half of it
