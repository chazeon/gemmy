"""The viewer's export math (pure TypeScript in web/src, bundled by tests/viewer_bundle.py) must describe the same view
Blender renders.

The module is run in node: a camera orientation, zoom and target go in,
the settings the page would save come out, and those go through `RenderSettings` -> plan -> `look_at` (what the
Blender backend uses) and are compared with the page's own camera.
"""

from __future__ import annotations

import json
import math
import shlex
import subprocess
import tomllib
from pathlib import Path

import pytest

from gemmy.cli_args import parse
from gemmy.compile.pipeline import compile_to_json
from gemmy.config import validate_settings
from gemmy.geom import look_at
from gemmy.render.looks import camera_distance, ortho_scale
from gemmy.render.runner import _local_camera, scene_bounds
from gemmy.scene import SceneDocument, from_dict
from viewer_bundle import available, header

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")
REPO = Path(__file__).resolve().parents[1]

SCENE = {
    "source_comment": "export fixture",
    "materials": {"m": {"base_color": [1, 0, 0, 1]}},
    "points": [
        {"id": "p0", "element": "O", "position": [0.0, 0.0, 0.0]},
        {"id": "p1", "element": "O", "position": [4.0, 1.5, -2.0]},
    ],
    "primitives": {
        "atoms": [
            {"id": "a0", "point_id": "p0", "radius": 1.0, "material_id": "m", "element": "O"},
            {"id": "a1", "point_id": "p1", "radius": 1.0, "material_id": "m", "element": "O"},
        ]
    },
}

Quaternion = tuple[float, float, float, float]  # x, y, z, w, three.js order


def _run_js(cases: list[dict], tmp_path: Path) -> list[dict]:
    script = tmp_path / "export.mjs"
    script.write_text(
        header()
        + """
const cases = JSON.parse(process.argv[2]);
console.log(JSON.stringify(cases.map((c) => {
  const view = exportView(c);
  return { view, toml: settingsToml(view), json: settingsJson(view), command: renderCommand(view, c.sceneFile),
           frame: orthoFrame(c.extent, c.width, c.height), fit: fitZoom(c.width, c.height),
           position: cameraPosition({ target: c.target, orientation: c.quaternion, zoom: c.zoom,
             projection: c.projection ?? "ortho", lens: c.lens ?? 70 }, c.extent),
           fov: perspFov(c.lens ?? 70, c.width, c.height),
           fitPersp: fitZoomPersp(c.extent, c.lens ?? 70, c.width, c.height),
           roundTrip: perspToOrthoZoom(c.extent, c.lens ?? 70, orthoToPerspZoom(c.extent, c.lens ?? 70, c.zoom)) };
})));
""",
        encoding="utf-8",
    )
    result = subprocess.run(["node", str(script), json.dumps(cases)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _qmul(a: Quaternion, b: Quaternion) -> Quaternion:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def _axis_angle(axis: tuple[float, float, float], degrees: float) -> Quaternion:
    n = math.sqrt(sum(x * x for x in axis))
    s = math.sin(math.radians(degrees) / 2) / n
    return (axis[0] * s, axis[1] * s, axis[2] * s, math.cos(math.radians(degrees) / 2))


def _camera_rotation(*turns: tuple[tuple[float, float, float], float]) -> Quaternion:
    """A page camera orientation made of successive turns (about world axes), like trackball dragging."""
    q: Quaternion = (0.0, 0.0, 0.0, 1.0)
    for axis, degrees in turns:
        q = _qmul(_axis_angle(axis, degrees), q)
    return q


ROTATIONS = {
    "default": _camera_rotation(((1, 0, 0), 62), ((0, 0, 1), 125)),  # a z-up view like "Rotated view"
    "spun": _camera_rotation(((0, 1, 0), 33), ((1, 0, 0), -71), ((0, 0, 1), 200), ((1, 1, 0), 17)),
    "looking_down_z": _camera_rotation(((0, 0, 1), 40)),
    "upside_down": _camera_rotation(((1, 0, 0), 100), ((0, 1, 0), 170)),
}


def _case(name: str, width: int = 1000, height: int = 600, zoom: float = 1.7, target=(0.3, -0.2, 0.5), **extra) -> dict:
    centre, extent = scene_bounds(from_dict(SceneDocument, SCENE))
    return {
        "name": name, "quaternion": ROTATIONS[name], "zoom": zoom, "target": list(target), "centre": list(centre),
        "extent": extent, "box": True, "width": width, "height": height, "sceneFile": "my scene.json", **extra,
    }  # fmt: skip


@pytest.mark.parametrize("name", ROTATIONS)
def test_exported_settings_give_the_pages_camera_in_the_render(name: str, tmp_path: Path) -> None:
    case = _case(name)
    out = _run_js([case], tmp_path)[0]
    settings = validate_settings(tomllib.loads(out["toml"]))
    assert validate_settings(json.loads(out["json"])) == settings
    plan = settings.resolve("scene.json")
    camera = plan.shots[0].camera
    centre, extent = scene_bounds(from_dict(SceneDocument, SCENE))
    assert camera.projection == "ortho" and plan.look.cell_box
    assert settings.quality.resolution == tuple(out["view"]["resolution"])

    local = _local_camera(camera, centre)  # what the runner hands the backend: target relative to the centre
    assert local.target == pytest.approx(case["target"], abs=1e-4)
    assert camera.zoom == pytest.approx(case["zoom"], abs=1e-3)
    _, quat = look_at(local.target, local.direction, camera_distance(extent, camera.zoom), local.up)
    w, x, y, z = quat  # geom order is (w, x, y, z)
    want = case["quaternion"]
    assert abs(x * want[0] + y * want[1] + z * want[2] + w * want[3]) == pytest.approx(1.0, abs=1e-4)


def test_flown_perspective_view_exports_its_target_and_zoom(tmp_path: Path) -> None:
    # W/S fly the target away from the centre in perspective; zoom stays baseDistance / distance, so it still exports.
    case = _case("spun", zoom=1.3, target=(-30.0, -20.0, -20.0), projection="persp", lens=35)
    out = _run_js([case], tmp_path)[0]
    assert out["view"]["projection"] == "persp" and out["view"]["lens"] == 35
    settings = validate_settings(tomllib.loads(out["toml"]))
    camera = settings.resolve("scene.json").shots[0].camera
    centre, _ = scene_bounds(from_dict(SceneDocument, SCENE))
    local = _local_camera(camera, centre)
    assert camera.projection == "persp"
    assert local.target == pytest.approx(case["target"], abs=1e-4)
    assert camera.zoom == pytest.approx(case["zoom"], abs=1e-3)


@pytest.mark.parametrize(("width", "height"), [(1000, 600), (600, 1000), (800, 800), (1280, 543)])
def test_page_frame_is_blenders_ortho_scale(width: int, height: int, tmp_path: Path) -> None:
    centre, extent = scene_bounds(from_dict(SceneDocument, SCENE))
    case = {**_case("default", width, height), "extent": extent}
    frame = _run_js([case], tmp_path)[0]["frame"]
    # Blender: ortho_scale is the LARGER image side (sensor fit AUTO); the three.js camera divides it by its zoom.
    assert 2 * max(frame["halfWidth"], frame["halfHeight"]) == pytest.approx(ortho_scale(extent, 1.0))
    assert frame["halfWidth"] / frame["halfHeight"] == pytest.approx(width / height)
    for zoom in (0.5, 1.0, 2.5):
        assert 2 * max(frame["halfWidth"], frame["halfHeight"]) / zoom == pytest.approx(ortho_scale(extent, zoom))


def test_resolution_keeps_the_aspect_ratio_with_1600_on_the_larger_side(tmp_path: Path) -> None:
    wide, tall = _run_js([_case("default", 1000, 600), _case("default", 500, 800)], tmp_path)
    assert wide["view"]["resolution"] == [1600, 960]
    assert tall["view"]["resolution"] == [1000, 1600]


def test_copied_command_parses_to_the_same_settings(tmp_path: Path) -> None:
    out = _run_js([_case("spun")], tmp_path)[0]
    words = shlex.split(out["command"])
    assert words[:2] == ["gemmy", "render"] and words[words.index("--scene") + 1] == "my scene.json"
    command = parse(words[1:])
    expected = validate_settings(tomllib.loads(out["toml"]))
    got = command.overrides
    assert got.camera == expected.camera
    assert got.quality.resolution == expected.quality.resolution
    assert got.look.preset == "3to2d" and got.cell_box.show is True and got.out == "view.png"


def test_hidden_box_and_rounding(tmp_path: Path) -> None:
    case = {**_case("default"), "box": False, "zoom": 1.23456789, "target": [1 / 3, 0, -0.0]}
    view = _run_js([case], tmp_path)[0]["view"]
    assert view["cellBox"] is False and view["zoom"] == 1.235
    assert all(len(str(x).split(".")[-1]) <= 4 for x in view["direction"] + view["up"] + view["target"])
    assert "show = false" in _run_js([case], tmp_path)[0]["toml"]


@pytest.mark.parametrize(("width", "height"), [(1280, 656), (500, 900), (700, 700), (1920, 400)])
def test_fitted_view_shows_the_whole_structure_in_the_blender_frame(width: int, height: int, tmp_path: Path) -> None:
    centre, extent = scene_bounds(from_dict(SceneDocument, SCENE))
    probe = _case("default", width, height, zoom=1.0, target=(0, 0, 0))
    fit = _run_js([probe], tmp_path)[0]["fit"]
    assert fit == pytest.approx(min(width, height) / max(width, height))  # the shorter side spans ortho_scale
    out = _run_js([{**probe, "zoom": fit}], tmp_path)[0]
    settings = validate_settings(tomllib.loads(out["toml"]))
    camera = settings.camera
    assert camera.zoom == pytest.approx(fit, abs=1e-3) and camera.target == pytest.approx(centre, abs=1e-4)
    res_w, res_h = settings.quality.resolution
    # Blender: the larger image side spans ortho_scale(extent, zoom); the bounding sphere has radius extent / 2
    larger = ortho_scale(extent, camera.zoom)
    half_w, half_h = larger / 2 * res_w / max(res_w, res_h), larger / 2 * res_h / max(res_w, res_h)
    assert extent / 2 <= min(half_w, half_h) * (1 + 1e-6)
    assert min(half_w, half_h) == pytest.approx(ortho_scale(extent, 1.0) / 2, rel=2e-3)


@pytest.mark.parametrize(("width", "height"), [(1000, 600), (600, 1000)])
def test_triad_is_the_size_blender_draws_it(width: int, height: int, tmp_path: Path) -> None:
    from gemmy.settings import Axes

    script = tmp_path / "triad.mjs"
    script.write_text(
        header() + "\nconst dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];\n"
        "console.log(JSON.stringify(triadLayout(dirs, ...JSON.parse(process.argv[2]))));\n",
        encoding="utf-8",
    )
    result = subprocess.run(["node", str(script), json.dumps([width, height])], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    layout = json.loads(result.stdout)
    axes = Axes()
    # Blender: the arrow is `size` of the shorter side; the origin is `margin` in from the left, up from the bottom
    assert layout["length"] == pytest.approx(axes.size * min(width, height))
    assert layout["origin"] == pytest.approx([axes.margin * width, height - axes.margin * height])
    assert layout["fontSize"] == pytest.approx(0.5 * layout["length"])


LENSES = (24.0, 35.0, 50.0, 70.0, 85.0)


@pytest.mark.parametrize("lens", LENSES)
@pytest.mark.parametrize("name", ROTATIONS)
def test_exported_persp_settings_give_the_pages_camera_in_the_render(name: str, lens: float, tmp_path: Path) -> None:
    case = _case(name, zoom=1.3, projection="persp", lens=lens)
    out = _run_js([case], tmp_path)[0]
    settings = validate_settings(tomllib.loads(out["toml"]))
    assert validate_settings(json.loads(out["json"])) == settings
    camera = settings.resolve("scene.json").shots[0].camera
    centre, extent = scene_bounds(from_dict(SceneDocument, SCENE))
    assert camera.projection == "persp" and camera.lens == lens
    local = _local_camera(camera, centre)
    location, quat = look_at(local.target, local.direction, camera_distance(extent, camera.zoom), local.up)
    w, x, y, z = quat
    want = case["quaternion"]
    assert abs(x * want[0] + y * want[1] + z * want[2] + w * want[3]) == pytest.approx(1.0, abs=1e-4)
    # the page camera's position (page coordinates: the structure's centre is the origin) is Blender's
    assert out["position"] == pytest.approx(list(location), abs=2e-3)


def test_ortho_settings_have_no_lens(tmp_path: Path) -> None:
    out = _run_js([_case("default", projection="ortho", lens=50.0)], tmp_path)[0]
    assert "lens" not in out["toml"] and "lens" not in out["json"] and "--camera.lens" not in out["command"]


def test_persp_command_parses_to_the_same_settings(tmp_path: Path) -> None:
    out = _run_js([_case("spun", projection="persp", lens=35.0)], tmp_path)[0]
    command = parse(shlex.split(out["command"])[1:])
    assert command.overrides.camera == validate_settings(tomllib.loads(out["toml"])).camera
    assert command.overrides.camera.projection == "persp" and command.overrides.camera.lens == 35.0


@pytest.mark.parametrize(("width", "height"), [(1000, 600), (600, 1000), (800, 800)])
@pytest.mark.parametrize("lens", LENSES)
def test_page_field_of_view_is_blenders_sensor_fit(width: int, height: int, lens: float, tmp_path: Path) -> None:
    from gemmy.render.looks import SENSOR_WIDTH

    fov = _run_js([_case("default", width, height, projection="persp", lens=lens)], tmp_path)[0]["fov"]
    # Blender: sensor width SENSOR_WIDTH (fit AUTO) is the LARGER image side; the other side is scaled by the aspect
    sensor_h = SENSOR_WIDTH * min(width, height) / max(width, height) if width >= height else SENSOR_WIDTH
    assert fov == pytest.approx(math.degrees(2 * math.atan(sensor_h / 2 / lens)))


@pytest.mark.parametrize(("width", "height"), [(1280, 656), (500, 900), (700, 700), (1920, 400)])
@pytest.mark.parametrize("lens", LENSES)
def test_persp_fit_shows_the_whole_bounding_sphere(width: int, height: int, lens: float, tmp_path: Path) -> None:
    from gemmy.render.looks import SENSOR_WIDTH

    centre, extent = scene_bounds(from_dict(SceneDocument, SCENE))
    probe = _case("default", width, height, zoom=1.0, target=(0, 0, 0), projection="persp", lens=lens)
    fit = _run_js([probe], tmp_path)[0]["fitPersp"]
    out = _run_js([{**probe, "zoom": fit}], tmp_path)[0]
    camera = validate_settings(tomllib.loads(out["toml"])).camera
    assert camera.zoom == pytest.approx(fit, abs=1e-3) and camera.target == pytest.approx(centre, abs=1e-4)
    res_w, res_h = validate_settings(tomllib.loads(out["toml"])).quality.resolution
    shorter_sensor = SENSOR_WIDTH * min(res_w, res_h) / max(res_w, res_h)
    half_angle = math.atan(shorter_sensor / 2 / camera.lens)
    # a sphere of radius R at distance d is inside a cone of half angle a when R / d <= sin(a)
    assert (extent / 2) / camera_distance(extent, camera.zoom) <= math.sin(half_angle) * (1 + 1e-3)
    assert (extent / 2) / camera_distance(extent, camera.zoom) >= 0.8 * math.sin(half_angle)  # and it is a fit


def test_lens_choices_include_the_default_lens(tmp_path: Path) -> None:
    from gemmy.render.looks import DEFAULT_LENS
    from gemmy.settings import CameraSettings

    script = tmp_path / "c.mjs"
    script.write_text(header() + "\nconsole.log(JSON.stringify(GEMMY));\n", encoding="utf-8")
    consts = json.loads(subprocess.run(["node", str(script)], capture_output=True, text=True).stdout)
    assert consts["defaultLens"] == DEFAULT_LENS == CameraSettings().lens
    assert DEFAULT_LENS in consts["lenses"] and {24, 35, 50, 85} <= set(consts["lenses"])


def test_switching_projection_keeps_the_framing_at_the_target(tmp_path: Path) -> None:
    out = _run_js([_case("default", zoom=1.9, projection="persp", lens=50.0)], tmp_path)[0]
    assert out["roundTrip"] == pytest.approx(1.9)


# ---- the page's scene bounds (sceneBounds, web/src/scene/bounds.ts) against gemmy.render.runner.scene_bounds ----
BOUNDS_CASES = [
    "nacl",
    "ice-ih",
    "stishovite",
    "rocksalt-tail-arrows",
    "tail-and-tip-arrows",
    "no-points",
    "under-one-angstrom",
    "duplicate-point-id",
]
TAIL_AND_TIP = {
    "source_comment": "bounds fixture",
    "materials": {"m": {"base_color": [1, 0, 0, 1]}},
    "points": [
        {"id": "p0", "element": "O", "position": [1.0, 2.0, 3.0]},
        {"id": "p1", "element": "O", "position": [-2.0, 0.5, 4.0]},
    ],
    "primitives": {
        "atoms": [],
        "bonds": [],
        "polyhedra": [],
        "displacements": [
            {"id": "d0", "start_point_id": "p0", "vector": [0.5, -1.0, 0.25], "anchor": "tail", "material_id": "m"},
            {"id": "d1", "start_point_id": "p1", "vector": [3.0, 0.0, -2.0], "anchor": "tip", "material_id": "m"},
        ],
    },
}


def _bounds_scene(name: str, tmp_path: Path) -> dict:
    if name in ("nacl", "ice-ih", "stishovite"):
        out = tmp_path / f"{name}.json"
        compile_to_json(REPO / "examples" / name / "config.toml", out)  # the page gets the compiled scene.json
        return json.loads(out.read_text(encoding="utf-8"))
    if name == "rocksalt-tail-arrows":  # a fixture with displacement arrows (all "tail")
        return json.loads((Path(__file__).parent / "fixtures/rocksalt/scene.golden.json").read_text(encoding="utf-8"))
    if name == "tail-and-tip-arrows":
        return TAIL_AND_TIP
    if name == "duplicate-point-id":  # the id p0 appears twice: the later position wins, in JS and in Python
        return {
            **SCENE,
            "points": [
                {"id": "p0", "element": "O", "position": [0.0, 0.0, 0.0]},
                {"id": "p1", "element": "O", "position": [4.0, 0.0, 0.0]},
                {"id": "p0", "element": "O", "position": [10.0, 0.0, 0.0]},
            ],
            "primitives": {"atoms": [], "bonds": [], "polyhedra": [], "displacements": []},
        }
    if name == "under-one-angstrom":  # two points 0.2 apart: the box diagonal is floored at 1 (geom.bounds)
        return {
            **SCENE,
            "points": [
                {"id": "p0", "element": "O", "position": [0.0, 0.0, 0.0]},
                {"id": "p1", "element": "O", "position": [0.2, 0.0, 0.0]},
            ],
            "primitives": {"atoms": [], "bonds": [], "polyhedra": [], "displacements": []},
        }
    return {
        "source_comment": "no points",
        "materials": {},
        "points": [],
        "primitives": {"atoms": [], "bonds": [], "polyhedra": [], "displacements": []},
    }


@pytest.fixture(scope="module")
def _bounds_cache(tmp_path_factory: pytest.TempPathFactory) -> dict[str, tuple[dict, dict]]:
    """Per case: the scene and the page's sceneBounds result (one node run for all cases)."""
    tmp_path = tmp_path_factory.mktemp("bounds")
    scenes = {name: _bounds_scene(name, tmp_path) for name in BOUNDS_CASES}
    script = tmp_path / "bounds.mjs"
    script.write_text(
        header()
        + """
const scenes = JSON.parse(process.argv[2]);
console.log(JSON.stringify(scenes.map((scene) => sceneBounds(scene))));
""",
        encoding="utf-8",
    )
    result = subprocess.run(["node", str(script), json.dumps(list(scenes.values()))], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    js = json.loads(result.stdout)
    return {name: (scenes[name], got) for name, got in zip(BOUNDS_CASES, js, strict=True)}


@pytest.mark.parametrize("name", BOUNDS_CASES)
def test_page_bounds_match_blender_scene_bounds(name: str, _bounds_cache: dict) -> None:
    scene, got = _bounds_cache[name]
    centre, extent = scene_bounds(from_dict(SceneDocument, scene))
    assert got["centre"] == pytest.approx(list(centre), abs=1e-9)
    assert got["extent"] == pytest.approx(extent, abs=1e-9)


def test_empty_scene_frames_the_origin_at_unit_size(_bounds_cache: dict) -> None:
    _, got = _bounds_cache["no-points"]
    assert got == {"centre": [0, 0, 0], "extent": 1}
    assert scene_bounds(from_dict(SceneDocument, _bounds_cache["no-points"][0])) == ((0.0, 0.0, 0.0), 1.0)


def test_a_tiny_scene_is_floored_to_one_angstrom(_bounds_cache: dict) -> None:
    _, got = _bounds_cache["under-one-angstrom"]
    assert got["extent"] == pytest.approx(1.0, abs=1e-12)
    assert got["centre"] == pytest.approx([0.1, 0.0, 0.0], abs=1e-12)
    centre, extent = scene_bounds(from_dict(SceneDocument, _bounds_cache["under-one-angstrom"][0]))
    assert extent == pytest.approx(1.0) and centre == pytest.approx((0.1, 0.0, 0.0))


def test_tail_and_tip_arrows_both_reach_the_box(_bounds_cache: dict) -> None:
    # Points span x -2..1, y 0.5..2, z 3..4. The tail arrow runs (1, 2, 3) -> (1.5, 1, 3.25), and the tip arrow ends
    # at its atom: (-5, 0.5, 6) -> (-2, 0.5, 4). So the box is x -5..1.5, y 0.5..2, z 3..6.
    _, got = _bounds_cache["tail-and-tip-arrows"]
    assert got["centre"] == pytest.approx([-1.75, 1.25, 4.5], abs=1e-9)
    assert got["extent"] == pytest.approx(math.dist((-5, 0.5, 3), (1.5, 2, 6)), abs=1e-9)
