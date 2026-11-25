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
console.log(JSON.stringify(ringPaths([stretch], true, () => [circle], snapTolerance(2))));
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
console.log(JSON.stringify(ringPaths([stretch], false, () => [line], snapTolerance(2))));
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
console.log(JSON.stringify(ringPaths([stretch], false, () => [line], snapTolerance(2))));
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
  const paths = ringPaths(stretches, whole, () => [], snapTolerance(1));
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
