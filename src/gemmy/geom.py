"""Plain-Python geometry for the render side (stdlib only, importable inside Blender).

Everything the Blender backend needs as a number comes from here, so the backend only applies
transforms. Conventions: a camera looks down its local -Z with +Y up; `direction` points from the target
towards the camera; azimuth is measured from +x towards +y, elevation up from the xy plane;
quaternions are (w, x, y, z), the order Blender uses.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from typing import NamedTuple

Vec3 = tuple[float, float, float]
Quat = tuple[float, float, float, float]

_EPS = 1e-9


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length(a: Vec3) -> float:
    return math.sqrt(dot(a, a))


def sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def normalize(a: Vec3) -> Vec3:
    n = length(a)
    if n <= _EPS:
        raise ValueError("cannot normalize a zero vector")
    return (a[0] / n, a[1] / n, a[2] / n)


def direction_from_angles(azimuth_deg: float, elevation_deg: float) -> Vec3:
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    return (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))


# ---- rotations ----------------------------------------------------------------------------------------


def rotate(q: Quat, v: Vec3) -> Vec3:
    """Rotate `v` by the unit quaternion `q`."""
    w, x, y, z = q
    u = (x, y, z)
    t = cross(u, v)
    t = (2 * t[0], 2 * t[1], 2 * t[2])
    c = cross(u, t)
    return (v[0] + w * t[0] + c[0], v[1] + w * t[1] + c[1], v[2] + w * t[2] + c[2])


def quat_inverse(q: Quat) -> Quat:
    """Inverse of a unit quaternion (its conjugate)."""
    return (q[0], -q[1], -q[2], -q[3])


def rotation_from_z(vector: Vec3) -> Quat:
    """Shortest rotation taking +z onto `vector` (any length). Antiparallel turns half a circle about +x."""
    d = normalize(vector)
    if d[2] < -1.0 + 1e-12:
        return (0.0, 1.0, 0.0, 0.0)
    # Half-way vector trick: q = (1 + z.d, z x d), normalised.
    w = 1.0 + d[2]
    x, y, z = -d[1], d[0], 0.0  # (0,0,1) x d
    n = math.sqrt(w * w + x * x + y * y + z * z)
    return (w / n, x / n, y / n, z / n)


def default_up(direction: Vec3) -> Vec3:
    """World +Z up, switching to +Y when looking (almost) straight along Z."""
    d = normalize(direction)
    return (0.0, 1.0, 0.0) if abs(d[2]) > 0.999 else (0.0, 0.0, 1.0)


def camera_basis(direction: Vec3, up: Vec3 | None = None) -> tuple[Vec3, Vec3, Vec3]:
    """Orthonormal (right, up, back) for a camera placed along `direction` from the target."""
    back = normalize(direction)
    hint = normalize(up) if up is not None else default_up(back)
    right = cross(hint, back)
    if length(right) <= _EPS:
        right = cross(default_up(back), back)
    right = normalize(right)
    true_up = cross(back, right)
    return right, true_up, back


def matrix_to_quaternion(right: Vec3, up: Vec3, back: Vec3) -> Quat:
    """Rotation whose columns are (right, up, back), as a unit quaternion."""
    m00, m10, m20 = right
    m01, m11, m21 = up
    m02, m12, m22 = back
    trace = m00 + m11 + m22
    if trace > 0.0:
        s = math.sqrt(trace + 1.0) * 2.0
        q = (0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s)
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2.0
        q = ((m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s)
    elif m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2.0
        q = ((m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s)
    else:
        s = math.sqrt(1.0 + m22 - m00 - m11) * 2.0
        q = ((m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s)
    n = math.sqrt(sum(c * c for c in q))
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def screen_direction(view_direction: Vec3, weights: Vec3, up: Vec3 | None = None) -> Vec3:
    """World direction from screen-relative weights (right, up, towards the viewer) for a camera along
    `view_direction` (with screen-up hint `up`): a light "upper left, in front" is (-0.5, 0.6, 0.6)."""
    right, up, back = camera_basis(view_direction, up)
    return normalize(
        tuple(weights[0] * right[i] + weights[1] * up[i] + weights[2] * back[i] for i in range(3))  # type: ignore[arg-type]
    )


def axis_label_position(direction: Vec3, camera_rotation: Quat, length: float, pad: float) -> Vec3:
    """Where an axis label goes, in camera coordinates (x right, y up, +z towards the viewer) relative to the
    triad origin: just beyond the arrow tip as seen on screen. An axis pointing (almost) at or away from the
    viewer projects to a dot, so its label sits up and to the right of the origin. z is 0 (the label plane)."""
    x, y, _ = rotate(quat_inverse(camera_rotation), normalize(direction))
    flat = math.hypot(x, y)
    ux, uy = (x / flat, y / flat) if flat > 0.15 else (math.sqrt(0.5), math.sqrt(0.5))
    reach = length * flat if flat > 0.15 else 0.0
    return ((reach + pad) * ux, (reach + pad) * uy, 0.0)


class TriadArrow(NamedTuple):
    shaft: tuple[tuple[float, float], ...]  # quad corners, image plane (x right, y up), origin at (0, 0)
    head: tuple[tuple[float, float], ...]  # triangle, empty for an axis pointing (almost) at the viewer
    label: tuple[float, float]  # label centre
    depth: float  # camera-space z of the unit direction: larger is nearer the viewer


def triad_layout(
    directions: tuple[Vec3, ...],
    camera_rotation: Quat,
    length: float,
    *,
    arrow_radius: float,
    head_length_ratio: float,
    head_radius_ratio: float,
    label_reach: float,
    label_pad: float,
) -> tuple[TriadArrow, ...]:
    """The flat a/b/c triad as the image shows it: each axis direction projected on the image plane, as 2D
    shapes around the origin (0, 0). Radii and ratios are fractions of `length`. The web viewer's `triadLayout`
    does the same arithmetic."""
    inverse = quat_inverse(camera_rotation)
    out = []
    for direction in directions:
        dx, dy, dz = rotate(inverse, normalize(direction))
        flat = math.hypot(dx, dy)
        label = axis_label_position(
            direction, camera_rotation, length * (1.0 + label_reach * arrow_radius), label_pad * length
        )
        shaft: tuple[tuple[float, float], ...] = ()
        head: tuple[tuple[float, float], ...] = ()
        if flat > 0.08:
            tx, ty = dx / flat, dy / flat
            nx, ny = -ty, tx
            tip = (dx * length, dy * length)
            head_len = head_length_ratio * length
            head_half = head_radius_ratio * arrow_radius * length
            half = arrow_radius * length
            end = (tip[0] - tx * head_len * 0.5, tip[1] - ty * head_len * 0.5)  # tucked into the head
            base = (tip[0] - tx * head_len, tip[1] - ty * head_len)
            shaft = ((-nx * half, -ny * half), (nx * half, ny * half), (end[0] + nx * half, end[1] + ny * half))
            shaft += ((end[0] - nx * half, end[1] - ny * half),)
            head = (
                tip,
                (base[0] + nx * head_half, base[1] + ny * head_half),
                (base[0] - nx * head_half, base[1] - ny * head_half),
            )
        out.append(TriadArrow(shaft, head, (label[0], label[1]), dz))
    return tuple(out)


def disc(radius: float, sides: int) -> list[tuple[float, float]]:
    """The outline of a flat disc about the origin: `sides` points on a circle of `radius`, in the image plane."""
    return [
        (radius * math.cos(2 * math.pi * k / sides), radius * math.sin(2 * math.pi * k / sides)) for k in range(sides)
    ]


class TriadDraw(NamedTuple):
    order: tuple[int, ...]  # axis indices, back to front: the farthest first, so nearer axes draw over farther ones
    behind: int  # the first `behind` of `order` point away from the viewer: they are drawn under the origin ball
    fades: tuple[float, ...]  # per axis index: the share of the background its colour is mixed with


def triad_draw(depths: Sequence[float], fade_max: float) -> TriadDraw:
    """Draw order and depth fade of the triad's axes, from each axis's camera-space depth (larger is nearer).

    An axis pointing away from the viewer (depth < 0) goes under the origin ball, which covers its root; one pointing
    towards it (depth >= 0) goes over the ball. The further an axis points away, the more it fades, up to `fade_max`.
    """
    order = tuple(sorted(range(len(depths)), key=lambda i: depths[i]))
    behind = sum(1 for depth in depths if depth < 0.0)
    fades = tuple(fade_max * max(0.0, -depth) for depth in depths)
    return TriadDraw(order, behind, fades)


def look_at(target: Vec3, direction: Vec3, distance: float, up: Vec3 | None = None) -> tuple[Vec3, Quat]:
    """Location and rotation of a camera (or light) that looks at `target` from along `direction`."""
    right, true_up, back = camera_basis(direction, up)
    location = (target[0] + back[0] * distance, target[1] + back[1] * distance, target[2] + back[2] * distance)
    return location, matrix_to_quaternion(right, true_up, back)


# ---- primitives -----------------------------------------------------------------------------------------


class CylinderPose(NamedTuple):
    center: Vec3
    rotation: Quat  # takes the cylinder axis (+z) onto a -> b
    length: float


def cylinder_pose(a: Vec3, b: Vec3) -> CylinderPose | None:
    """Where to put a unit-axis cylinder spanning a -> b. None for a zero-length span."""
    delta = sub(b, a)
    span = length(delta)
    if span <= _EPS:
        return None
    center = ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5)
    return CylinderPose(center, rotation_from_z(delta), span)


def lerp(a: Vec3, b: Vec3, t: float) -> Vec3:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def dash_segments(a: Vec3, b: Vec3, dash: float, gap: float) -> list[tuple[Vec3, Vec3]]:
    """A whole number of dashes from a to b, starting and ending with a dash; dash and gap are stretched
    together so they fit exactly. (start, end) per dash."""
    span = length(sub(b, a))
    if span <= _EPS:
        return []
    count = max(1, round((span + gap) / (dash + gap)))
    stretch = span / (count * dash + (count - 1) * gap)
    on, period = dash * stretch / span, (dash + gap) * stretch / span  # as fractions of a -> b
    return [(lerp(a, b, i * period), lerp(a, b, i * period + on)) for i in range(count)]


def dot_centres(a: Vec3, b: Vec3, spacing: float) -> list[Vec3]:
    """Evenly spaced points strictly between a and b (none at the atoms themselves)."""
    span = length(sub(b, a))
    if span <= _EPS:
        return []
    count = max(1, round(span / spacing))
    return [lerp(a, b, (i + 0.5) / count) for i in range(count)]


def arrow_span(atom: Vec3, vector: Vec3, anchor: str) -> tuple[Vec3, Vec3]:
    """Arrow endpoints for a displacement: `tail` starts at the atom, `tip` ends at the atom (the arrow
    sits outside, its head touching the atom)."""
    if anchor == "tip":
        return sub(atom, vector), atom
    return atom, (atom[0] + vector[0], atom[1] + vector[1], atom[2] + vector[2])


class ArrowParts(NamedTuple):
    shaft_end: Vec3  # the shaft runs a -> shaft_end
    head_center: Vec3
    head_length: float
    rotation: Quat  # takes +z onto the arrow direction (the cone axis)


def arrow_parts(a: Vec3, b: Vec3, radius: float, head_length_ratio: float) -> ArrowParts | None:
    """Split an arrow a -> b into shaft and head. The head is `head_length_ratio` of the length, at least
    three radii and at most 80% of the arrow; the shaft keeps at least 20%. None for a zero-length arrow."""
    delta = sub(b, a)
    span = length(delta)
    if span <= _EPS:
        return None
    d = normalize(delta)
    head_len = min(max(span * head_length_ratio, radius * 3.0), span * 0.8)
    shaft_len = max(span - head_len, span * 0.2)
    shaft_end = (a[0] + d[0] * shaft_len, a[1] + d[1] * shaft_len, a[2] + d[2] * shaft_len)
    head_center = (
        shaft_end[0] + d[0] * head_len * 0.5,
        shaft_end[1] + d[1] * head_len * 0.5,
        shaft_end[2] + d[2] * head_len * 0.5,
    )
    return ArrowParts(shaft_end, head_center, head_len, rotation_from_z(d))


# ---- scene extent -----------------------------------------------------------------------------------------


def bounds(points: Iterable[Vec3]) -> tuple[Vec3, float]:
    """Centre of the bounding box and its diagonal (at least 1.0): the structure fits the frame from any view.
    No points: the origin and 1.0."""
    pts = list(points)
    if not pts:
        return (0.0, 0.0, 0.0), 1.0
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    center = ((lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5)
    return center, max(math.dist(lo, hi), 1.0)


def shrink(vertices: Sequence[Vec3], scale: float) -> list[Vec3]:
    """Scale vertices about their centroid (inset), so polyhedron faces end at the atom surface."""
    if scale == 1.0 or not vertices:
        return list(vertices)
    n = len(vertices)
    c = tuple(sum(v[i] for v in vertices) / n for i in range(3))
    return [tuple(c[i] + (v[i] - c[i]) * scale for i in range(3)) for v in vertices]  # type: ignore[misc]


_BOX_CORNERS = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]


def cell_box_edges(origin: Vec3, vectors: Sequence[Vec3]) -> list[tuple[Vec3, Vec3]]:
    """The 12 edges of a cell's display box as (start, end) in scene coordinates. A corner is the origin plus the
    box vectors weighted by its 0/1 coordinates."""

    def corner(c):
        return tuple(origin[x] + sum(c[a] * vectors[a][x] for a in range(3)) for x in range(3))

    edges = []
    for a in _BOX_CORNERS:
        for axis in range(3):
            if a[axis] == 0:
                b = tuple(1 if x == axis else a[x] for x in range(3))
                edges.append((corner(a), corner(b)))
    return edges


# ---- unit meshes ------------------------------------------------------------------------------------------
# Shared by separate objects (placed by location, rotation, scale) and by merged meshes (placed by `place_mesh`).
# All are plain (vertices, faces) with faces as index tuples; caps are n-gons, like Blender's own primitives.

Mesh = tuple[list[Vec3], list[tuple[int, ...]]]
CYLINDER_SIDES = 32
DOT_SEGMENTS, DOT_RINGS = 12, 8


def _ring(sides: int, z: float, radius: float) -> list[Vec3]:
    return [
        (radius * math.cos(2 * math.pi * i / sides), radius * math.sin(2 * math.pi * i / sides), z)
        for i in range(sides)
    ]


def unit_cylinder(sides: int = CYLINDER_SIDES) -> Mesh:
    """Radius 1 around +z, from z=-0.5 to z=0.5, flat-shaded sides and two n-gon caps."""
    verts = _ring(sides, -0.5, 1.0) + _ring(sides, 0.5, 1.0)
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple(range(sides, 2 * sides)))
    return verts, faces


def unit_cone(sides: int = CYLINDER_SIDES) -> Mesh:
    """Base radius 1 at z=-0.5, tip at z=0.5."""
    verts = [*_ring(sides, -0.5, 1.0), (0.0, 0.0, 0.5)]
    faces = [(i, (i + 1) % sides, sides) for i in range(sides)]
    faces.append(tuple(reversed(range(sides))))
    return verts, faces


def unit_sphere(segments: int = DOT_SEGMENTS, rings: int = DOT_RINGS) -> Mesh:
    """Radius 1 UV sphere: `segments` around z, `rings` bands pole to pole (smooth-shade it)."""
    verts: list[Vec3] = [(0.0, 0.0, 1.0)]
    for r in range(1, rings):
        phi = math.pi * r / rings
        verts.extend(_ring(segments, math.cos(phi), math.sin(phi)))
    verts.append((0.0, 0.0, -1.0))
    south = len(verts) - 1
    faces: list[tuple[int, ...]] = [(0, 1 + i, 1 + (i + 1) % segments) for i in range(segments)]
    for r in range(rings - 2):
        top, bottom = 1 + r * segments, 1 + (r + 1) * segments
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((top + i, bottom + i, bottom + j, top + j))
    last = 1 + (rings - 2) * segments
    faces.extend((south, last + (i + 1) % segments, last + i) for i in range(segments))
    return verts, faces


def place_mesh(
    mesh: Mesh, center: Vec3, rotation: Quat, scale: Vec3, vertices: list[Vec3], faces: list[tuple[int, ...]]
) -> None:
    """Append `mesh` scaled, rotated and moved to the running (vertices, faces) lists."""
    ex, ey, ez = (rotate(rotation, axis) for axis in ((scale[0], 0.0, 0.0), (0.0, scale[1], 0.0), (0.0, 0.0, scale[2])))
    cx, cy, cz = center
    base = len(vertices)
    vertices.extend(
        (
            cx + x * ex[0] + y * ey[0] + z * ez[0],
            cy + x * ex[1] + y * ey[1] + z * ez[1],
            cz + x * ex[2] + y * ey[2] + z * ez[2],
        )
        for x, y, z in mesh[0]
    )
    faces.extend(tuple(base + i for i in face) for face in mesh[1])
