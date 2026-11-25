"""The traced SVG's pure parts (web/src/trace: candidates.ts curves and their snapping, curves.ts fitting, stretch.ts
splitting and path data), run in node and bundled by tests/viewer_bundle.py. Each case hands a boundary to ringPaths
or stretchesOf and reads back the path data: a shape on an exact curve is written with its arcs or line, and anything
else falls back to a fitted Bézier."""

from __future__ import annotations

import json
import math
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest

from viewer_bundle import available, header

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")
# A stalled split would hang node, so every run has a limit: a timeout is a failed test, not a stuck suite.
RUN_SECONDS = 60


def _run(body: str, args: Any, tmp_path: Path) -> Any:
    script = tmp_path / "trace.mjs"
    script.write_text(header() + "\nconst args = JSON.parse(process.argv[2]);\n" + body, encoding="utf-8")
    result = subprocess.run(
        ["node", str(script), json.dumps(args)], capture_output=True, text=True, timeout=RUN_SECONDS
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _circle(cx: float, cy: float, r: float, n: int) -> list[list[float]]:
    """n points on a circle, closed by repeating the first one (a boundary ring as the field traces it)."""
    pts = [[cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)] for i in range(n)]
    return pts + [pts[0]]


def test_a_full_circle_snaps_to_one_ellipse(tmp_path: Path) -> None:
    # the sample points of a circle lie exactly on the circle from the scene: the ring is written as four quarter arcs
    args = {"pts": _circle(100, 80, 40, 96), "ellipse": {"cx": 100, "cy": 80, "rx": 40, "ry": 40, "phi": 0}}
    out = _run(
        """
const stretch = { pts: args.pts, label: 0, outlined: true };
const circle = { kind: "ellipse", e: args.ellipse };
console.log(JSON.stringify(ringPaths([stretch], true, () => [circle], 2)));
""",
        args,
        tmp_path,
    )
    assert out["fill"].startswith("M140 80A")  # the start on the circle, at parameter 0
    assert out["fill"].count("A") == 4 and not re.search(r"[CL]", out["fill"])
    assert out["outline"] == out["fill"]  # outlined: the same closed path


def test_a_straight_run_snaps_to_its_line(tmp_path: Path) -> None:
    args = {"pts": [[2.5 * i, 1.0 * i] for i in range(21)], "line": {"a": [0, 0], "b": [50, 20]}}
    out = _run(
        """
const stretch = { pts: args.pts, label: 0, outlined: false };
const line = { kind: "line", a: args.line.a, b: args.line.b };
console.log(JSON.stringify(ringPaths([stretch], false, () => [line], 2)));
""",
        args,
        tmp_path,
    )
    assert out["fill"] == "M0 0L50 20Z"
    assert out["outline"] == ""


def test_a_wavy_run_falls_back_to_a_bezier(tmp_path: Path) -> None:
    # a wave of amplitude 10 px is neither the line it is laid along nor an ellipse: no candidate is within tolerance
    args = {"pts": [[float(i), 10 * math.sin(i / 5)] for i in range(61)], "line": {"a": [0, 0], "b": [60, 0]}}
    out = _run(
        """
const stretch = { pts: args.pts, label: 0, outlined: false };
const line = { kind: "line", a: args.line.a, b: args.line.b };
console.log(JSON.stringify(ringPaths([stretch], false, () => [line], 2)));
""",
        args,
        tmp_path,
    )
    commands = set(re.findall(r"[A-Za-z]", out["fill"]))
    assert "C" in commands and "A" not in commands and "L" not in commands, out["fill"]


def test_stretches_on_single_point_runs_split_and_join_without_stalling(tmp_path: Path) -> None:
    # a 4x4 grid whose region has a one-point stretch between two longer ones (the case that once looped forever)
    args = {"keys": [2, 2, 2, 0, 2, 4, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0], "width": 4, "height": 4}
    out = _run(
        """
const box = { x0: 0, y0: 0, x1: args.width - 1, y1: args.height - 1 };
const keys = new Uint32Array(args.keys);
const n = args.width * args.height;
const passes = new Passes(args.width, args.height, keys, new Float32Array(n), new Uint8Array(n), new Uint32Array(n));
const rings = regionRings(passes, box, (k) => idOf(k) === 1);
const results = rings.map((ring) => {
  const { stretches, whole } = stretchesOf(ring, 1, passes, 1);
  const paths = ringPaths(stretches, whole, () => [], 1);
  return { lengths: stretches.map((s) => s.pts.length), fill: paths.fill };
});
console.log(JSON.stringify(results));
""",
        args,
        tmp_path,
    )
    lengths = [n for result in out for n in result["lengths"]]
    assert 1 in lengths and max(lengths) > 1  # a one-point stretch, next to longer ones
    assert all(result["fill"].startswith("M") and result["fill"].endswith("Z") for result in out)


def test_a_cone_seen_from_the_side_has_two_tangents_to_its_base_and_the_base(tmp_path: Path) -> None:
    # a cone along +y whose base is tilted 60 degrees toward the viewer: the base is an ellipse the apex projects
    # outside of, so the outline is the two tangents from the apex to that ellipse (on opposite sides), and the base
    radius, height = 0.3, 1.0
    args = {"matrix": [radius, 0, 0, 0, 0, height, 0, 0, 0, 0, radius, 0, 0, 0, 0, 1], "tilt": math.radians(60)}
    out = _run(
        """
const t = args.tilt;
const screen = (p) => [200 + 100 * p.x, 200 - 100 * (p.y * Math.cos(t) + p.z * Math.sin(t))];
const curves = coneCurves(args.matrix, screen);
const lines = curves.filter((c) => c.kind === "line");
const samples = Array.from({ length: 120 }, (_, i) => pointAt(curves[0].e, (2 * Math.PI * i) / 120));
console.log(JSON.stringify({
  kinds: curves.map((c) => c.kind),
  apex: lines.length ? lines[0].a : null,
  tangents: lines.map((c) => c.b),
  onBase: lines.map((c) => ellipseRms(curves[0].e, [c.b])),
  base: curves[0].e,
  samples,
}));
""",
        args,
        tmp_path,
    )
    assert out["kinds"] == ["ellipse", "line", "line"]
    assert out["apex"] == pytest.approx([200, 175])
    assert all(rms < 1e-6 for rms in out["onBase"])  # each tangent point is on the base ellipse
    assert out["tangents"][0][0] < 200 < out["tangents"][1][0]  # the two sides of the cone
    apex = out["apex"]
    for tangent in out["tangents"]:  # the base lies on one side of each tangent line: the line touches it
        sides = [
            (tangent[0] - apex[0]) * (p[1] - apex[1]) - (tangent[1] - apex[1]) * (p[0] - apex[0])
            for p in out["samples"]
        ]
        assert min(sides) > -1e-6 or max(sides) < 1e-6


def test_a_cone_seen_tip_on_is_its_base_ellipse_alone(tmp_path: Path) -> None:
    # the axis points at the viewer: the apex projects to the middle of the base, so the outline is the base circle
    radius, height = 0.3, 1.0
    args = {"matrix": [radius, 0, 0, 0, 0, 0, height, 0, 0, radius, 0, 0, 0, 0, 0, 1]}
    out = _run(
        """
const screen = (p) => [200 + 100 * p.x, 200 - 100 * p.y];
const curves = coneCurves(args.matrix, screen);
console.log(JSON.stringify({ kinds: curves.map((c) => c.kind), base: curves[0].e }));
""",
        args,
        tmp_path,
    )
    assert out["kinds"] == ["ellipse"]
    assert out["base"]["cx"] == pytest.approx(200) and out["base"]["cy"] == pytest.approx(200)
    assert out["base"]["rx"] == pytest.approx(30) and out["base"]["ry"] == pytest.approx(30)


def test_lines_cross_at_their_intersection(tmp_path: Path) -> None:
    args = {"a": [[0, 0], [10, 10]], "b": [[0, 10], [10, 0]]}
    out = _run(
        """
const line = (a, b) => ({ kind: "line", a, b });
const p = intersectCurves(line(args.a[0], args.a[1]), line(args.b[0], args.b[1]), [0, 0]);
const parallel = intersectCurves(line([0, 0], [1, 0]), line([0, 1], [5, 1]), [0, 0]);
console.log(JSON.stringify({ p, parallel }));
""",
        args,
        tmp_path,
    )
    assert out["p"] == pytest.approx([5, 5])
    assert out["parallel"] is None  # parallel lines have no crossing


def test_a_line_through_a_circle_has_two_crossings_and_the_hint_picks_one(tmp_path: Path) -> None:
    circle = {"cx": 0, "cy": 0, "rx": 10, "ry": 10, "phi": 0}
    args = {"circle": circle, "line": [[-20, 0], [20, 0]]}
    out = _run(
        """
const c = { kind: "ellipse", e: args.circle };
const l = { kind: "line", a: args.line[0], b: args.line[1] };
console.log(JSON.stringify({
  right: intersectCurves(l, c, [9, 1]),
  left: intersectCurves(l, c, [-9, -1]),
  swapped: intersectCurves(c, l, [9, -1]),
}));
""",
        args,
        tmp_path,
    )
    assert out["right"] == pytest.approx([10, 0])
    assert out["left"] == pytest.approx([-10, 0])
    assert out["swapped"] == pytest.approx([10, 0])


def test_a_line_tangent_to_a_circle_has_no_crossing(tmp_path: Path) -> None:
    args = {"circle": {"cx": 0, "cy": 0, "rx": 10, "ry": 10, "phi": 0}, "line": [[-20, 10], [20, 10]]}
    out = _run(
        """
const l = { kind: "line", a: args.line[0], b: args.line[1] };
const p = intersectCurves(l, { kind: "ellipse", e: args.circle }, [0, 10]);
console.log(JSON.stringify({ p }));
""",
        args,
        tmp_path,
    )
    assert out["p"] is None


def test_two_overlapping_circles_cross_at_two_points_and_the_hint_picks_one(tmp_path: Path) -> None:
    def circle(cx: float) -> dict:
        return {"cx": cx, "cy": 0, "rx": 1, "ry": 1, "phi": 0}

    args = {"c1": circle(0), "c2": circle(1)}
    out = _run(
        """
const c1 = { kind: "ellipse", e: args.c1 };
const c2 = { kind: "ellipse", e: args.c2 };
console.log(JSON.stringify({
  upper: intersectCurves(c1, c2, [0.5, 0.8]),
  lower: intersectCurves(c1, c2, [0.5, -0.8]),
}));
""",
        args,
        tmp_path,
    )
    root = math.sqrt(3) / 2
    assert out["upper"] == pytest.approx([0.5, root], abs=1e-9)
    assert out["lower"] == pytest.approx([0.5, -root], abs=1e-9)


def test_tangent_circles_have_no_crossing(tmp_path: Path) -> None:
    args = {"c1": {"cx": 0, "cy": 0, "rx": 1, "ry": 1, "phi": 0}, "c2": {"cx": 2, "cy": 0, "rx": 1, "ry": 1, "phi": 0}}
    out = _run(
        """
const p = intersectCurves({ kind: "ellipse", e: args.c1 }, { kind: "ellipse", e: args.c2 }, [1, 0]);
console.log(JSON.stringify({ p }));
""",
        args,
        tmp_path,
    )
    assert out["p"] is None


def test_newton_finds_each_crossing_of_two_ellipses_from_a_nearby_hint(tmp_path: Path) -> None:
    # The reference crossings come from a dense scan of the first ellipse for sign changes of the second's implicit
    # function, refined by bisection. Each is then found by Newton from a hint 1.5 px away from it.
    args = {
        "e1": {"cx": 0, "cy": 0, "rx": 40, "ry": 25, "phi": 0.3},
        "e2": {"cx": 30, "cy": 10, "rx": 35, "ry": 18, "phi": -0.6},
    }
    out = _run(
        """
const e1 = args.e1, e2 = args.e2;
const G = (e, p) => { const [u, w] = local(e, p); return (u / e.rx) ** 2 + (w / e.ry) ** 2 - 1; };
const onE1 = (t) => pointAt(e1, t);
const f = (t) => G(e2, onE1(t));
const N = 20000;
const refs = [];
for (let i = 0; i < N; i++) {
  const t0 = (2 * Math.PI * i) / N, t1 = (2 * Math.PI * (i + 1)) / N;
  if (Math.sign(f(t0)) === Math.sign(f(t1))) continue;
  let lo = t0, hi = t1;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(f(mid)) === Math.sign(f(lo))) lo = mid; else hi = mid;
  }
  refs.push(onE1((lo + hi) / 2));
}
const results = refs.map((r) => {
  const hint = [r[0] + 1.5, r[1] - 1.0];
  const p = intersectCurves({ kind: "ellipse", e: e1 }, { kind: "ellipse", e: e2 }, hint);
  return { ref: r, found: p, residual: Math.max(Math.abs(G(e1, p)), Math.abs(G(e2, p))) };
});
console.log(JSON.stringify(results));
""",
        args,
        tmp_path,
    )
    assert len(out) >= 2  # two ellipses like these cross in (up to) four points
    for result in out:
        assert result["found"] == pytest.approx(result["ref"], abs=1e-6)
        assert result["residual"] < 1e-9


def test_two_snapped_neighbours_share_their_exact_junction(tmp_path: Path) -> None:
    # Two stretches on the lines y = 0 and x = 50, joined at the corner (50, 0). The first one's traced points end
    # 0.3 px past the corner, so its projected end is off the corner; the exact corner is the one point both write.
    args = {
        "a": [[2.515 * i, 0.2 * math.sin(i)] for i in range(21)],  # ends at x = 50.3, 0.3 px past the corner
        "b": [[50 + 0.2 * math.sin(j), 2.0 * j] for j in range(21)],
    }
    out = _run(
        """
const sa = { pts: args.a, label: 1, outlined: true };
const sb = { pts: args.b, label: 2, outlined: true };
const lineA = { kind: "line", a: [0, 0], b: [50, 0] };
const lineB = { kind: "line", a: [50, 0], b: [50, 40] };
const cands = (st) => (st.label === 1 ? [lineA] : [lineB]);
const paths = ringPaths([sa, sb], false, cands, 1);
console.log(JSON.stringify(paths));
""",
        args,
        tmp_path,
    )
    # the corner is written once, as the end of the first line and the start of the second: M, corner, far end, Z
    assert out["fill"] == "M0 0L50 0L50 40Z"
