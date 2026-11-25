"""The SVG export's bond cuts (web/src/geom/bonds.ts): a bond is cut at the atom spheres it ends on, dashes are
clipped to the visible span, and dots inside an atom are dropped. The module runs in node, bundled by
tests/viewer_bundle.py."""

from __future__ import annotations

import json
import math
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import pytest

from viewer_bundle import available, header

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")
ORIGIN = [0.0, 0.0, 0.0]
BOND_END = [10.0, 0.0, 0.0]


def _run(body: str, args: Any, tmp_path: Path) -> Any:
    script = tmp_path / "bonds.mjs"
    script.write_text(header() + "\nconst args = JSON.parse(process.argv[2]);\n" + body, encoding="utf-8")
    result = subprocess.run(["node", str(script), json.dumps(args)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _trim(Ra: float | None, Rb: float | None, r: float, tmp_path: Path) -> Any:
    args = {"a": ORIGIN, "b": BOND_END, "r": r, "Ra": Ra, "Rb": Rb}
    return _run("console.log(JSON.stringify(trimToSpheres(args.a, args.b, args.r, args.Ra, args.Rb)));", args, tmp_path)


def _close(actual: list[float], expected: list[float]) -> None:
    assert actual == pytest.approx(expected, abs=1e-9)


def test_a_bond_between_undrawn_atoms_is_not_cut(tmp_path: Path) -> None:
    out = _trim(None, None, 1, tmp_path)
    _close(out[0], ORIGIN)
    _close(out[1], BOND_END)


def test_each_end_is_cut_where_the_tube_leaves_its_sphere(tmp_path: Path) -> None:
    # sqrt(R^2 - r^2) from each centre: R = 3, r = 1 gives 2*sqrt(2); the atom at b is not drawn
    out = _trim(3, None, 1, tmp_path)
    _close(out[0], [2 * math.sqrt(2), 0.0, 0.0])
    _close(out[1], BOND_END)


def test_each_end_is_cut_by_its_own_sphere(tmp_path: Path) -> None:
    # asymmetric: R = 3 at a gives sqrt(8) = 2*sqrt(2); R = 2 at b gives sqrt(3), so the cuts differ
    out = _trim(3, 2, 1, tmp_path)
    _close(out[0], [2 * math.sqrt(2), 0.0, 0.0])
    _close(out[1], [10 - math.sqrt(3), 0.0, 0.0])


def test_a_sphere_smaller_than_the_tube_cuts_nothing(tmp_path: Path) -> None:
    out = _run(
        "console.log(JSON.stringify(trimToSpheres(args.a, args.b, 1, 0.5, 0.5)));",
        {"a": ORIGIN, "b": BOND_END},
        tmp_path,
    )
    _close(out[0], ORIGIN)
    _close(out[1], BOND_END)


def test_touching_atoms_leave_no_bond(tmp_path: Path) -> None:
    # each cut is sqrt(35) = 5.92 from its centre, and the two together pass the 10 angstrom bond
    out = _trim(6, 6, 1, tmp_path)
    assert out is None


def test_a_bond_of_no_length_is_dropped(tmp_path: Path) -> None:
    out = _run("console.log(JSON.stringify(trimToSpheres(args.a, args.a, 1, null, null)));", {"a": ORIGIN}, tmp_path)
    assert out is None


def test_a_dash_inside_the_sphere_is_dropped_and_one_across_the_surface_is_cut(tmp_path: Path) -> None:
    # the visible span runs from x = 2 to x = 10; the dash 0..1 lies inside, the dash 1.5..3 crosses the surface
    args = {"s": [2.0, 0, 0], "e": BOND_END, "inside": [[0, 0, 0], [1, 0, 0]], "across": [[1.5, 0, 0], [3, 0, 0]]}
    out = _run(
        """
const inside = clipToSegment(args.inside[0], args.inside[1], args.s, args.e);
const across = clipToSegment(args.across[0], args.across[1], args.s, args.e);
console.log(JSON.stringify({ inside, across }));
""",
        args,
        tmp_path,
    )
    assert out["inside"] is None
    _close(out["across"]["p"], [2.0, 0, 0])
    _close(out["across"]["q"], [3.0, 0, 0])
    assert out["across"]["cutStart"] is True and out["across"]["cutEnd"] is False


def test_a_dash_past_the_far_surface_is_cut_at_the_far_end(tmp_path: Path) -> None:
    args = {"s": [0.0, 0, 0], "e": [5.0, 0, 0], "p": [4.0, 0, 0], "q": [7.0, 0, 0]}
    out = _run("console.log(JSON.stringify(clipToSegment(args.p, args.q, args.s, args.e)));", args, tmp_path)
    _close(out["p"], [4.0, 0, 0])
    _close(out["q"], [5.0, 0, 0])
    assert out["cutStart"] is False and out["cutEnd"] is True


def test_a_dot_is_dropped_only_when_wholly_inside_the_sphere(tmp_path: Path) -> None:
    # the dot radius 0.5 at 4.6 from the centre of a radius-5 sphere pokes out (4.6 + 0.5 > 5); at 4.0 it lies inside
    args = {"c": ORIGIN, "poke": [4.6, 0, 0], "inside": [4.0, 0, 0]}
    out = _run(
        """
console.log(JSON.stringify({
  poke: insideSphere(args.poke, args.c, 0.5, 5),
  inside: insideSphere(args.inside, args.c, 0.5, 5),
  noSphere: insideSphere(args.inside, args.c, 0.5, null),
}));
""",
        args,
        tmp_path,
    )
    assert out == {"poke": False, "inside": True, "noSphere": False}


# An export of two atoms joined by one bond, seen from the default camera (looking down -z, so +z is towards the
# viewer). Atom a sits at the origin and atom b at (2, 0, 2): the bond leaves a toward the viewer and enters b from
# behind, so it must sort over a and under b. The bond is split at its midpoint, one half on each atom.
SPLIT_SCENE = {
    "materials": {"atom": {"base_color": [1.0, 0.0, 0.0, 1.0]}, "bond": {"base_color": [0.0, 1.0, 0.0, 1.0]}},
    "points": [
        {"id": "p0", "element": "O", "position": [0.0, 0.0, 0.0]},
        {"id": "p1", "element": "O", "position": [2.0, 0.0, 2.0]},
    ],
    "topologies": [],
    "primitives": {
        "atoms": [
            {"id": "a0", "point_id": "p0", "radius": 1.0, "material_id": "atom", "element": "O"},
            {"id": "a1", "point_id": "p1", "radius": 1.0, "material_id": "atom", "element": "O"},
        ],
        "bonds": [
            {"id": "b0", "a_point_id": "p0", "b_point_id": "p1", "radius": 0.2, "material_id": "bond",
             "a_element": "O", "b_element": "O", "style": "solid"},
        ],
        "polyhedra": [],
        "displacements": [],
    },
}  # fmt: skip


def _svg(scene: dict, tmp_path: Path) -> str:
    args = {
        "data": scene, "centre": [0.0, 0.0, 0.0], "extent": 3.0, "quaternion": [0.0, 0.0, 0.0, 1.0], "zoom": 1.0,
        "target": [0.0, 0.0, 0.0], "width": 400, "height": 400, "show": {"atoms": True, "box": False},
        "outlines": True, "lattice": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "boxColor": "#000000",
    }  # fmt: skip
    script = tmp_path / "split.mjs"
    script.write_text(header() + "\nconsole.log(buildSvg(JSON.parse(process.argv[2])));\n", encoding="utf-8")
    result = subprocess.run(["node", str(script), json.dumps(args)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return result.stdout


def _centre_x(points: str) -> float:
    xs = [float(pair.split(",")[0]) for pair in points.split()]
    return sum(xs) / len(xs)


def test_a_split_bond_sorts_over_its_atom_it_leaves_and_under_the_other(tmp_path: Path) -> None:
    root = ET.fromstring(_svg(SPLIT_SCENE, tmp_path))
    children = list(root)
    atoms = [(i, c) for i, c in enumerate(children) if c.tag.endswith("circle") and c.get("fill") == "#ff0000"]
    halves = [(i, c) for i, c in enumerate(children) if c.tag.endswith("polygon") and c.get("fill") == "#00ff00"]
    assert len(atoms) == 2 and len(halves) == 2, "two atoms and the two halves of one split bond"
    # atoms: the one at the origin has the smaller cx; halves: the one that starts at a has the smaller centroid
    (index_a, _), (index_b, _) = sorted(atoms, key=lambda item: float(item[1].get("cx")))
    (index_half_a, _), (index_half_b, _) = sorted(halves, key=lambda item: _centre_x(item[1].get("points")))
    assert index_a < index_half_a, "the half that leaves a toward the viewer is drawn over a"
    assert index_half_b < index_b, "the half that enters b from behind is drawn under b"
