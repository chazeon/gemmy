from __future__ import annotations

import dataclasses
import json
import sys
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any


def _extract_user_argv(argv: list[str] | None = None) -> list[str]:
    raw = list(sys.argv[1:] if argv is None else argv)
    if "--" in raw:
        return raw[raw.index("--") + 1 :]
    return raw


def resolve_settings(command):
    """Parsed `render` command -> validated RenderSettings (pydantic TypeAdapter + `check_settings`)."""
    from .config import validate_settings

    return validate_settings(dataclasses.asdict(command.overrides))


def run_plan(plan_path: str) -> int:
    """Inside Blender: stdlib only, no pydantic."""
    from .render.blender import BlenderBackend
    from .render.runner import render_plan
    from .settings import load_plan

    plan = load_plan(plan_path)
    backend = BlenderBackend()
    scene = render_plan(plan, backend)
    print(
        f"Rendered scene from {plan.scene} (points={len(scene.points)}, atoms={len(scene.primitives.atoms)}, "
        f"bonds={len(scene.primitives.bonds)}, polyhedra={len(scene.primitives.polyhedra)}, "
        f"displacements={len(scene.primitives.displacements)})"
    )
    print("Render settings:", backend.get_render_settings())
    for shot in plan.shots:
        if shot.output:
            print(f"Saved {shot.name}: {shot.output}")
    return 0


def run_serve(args) -> int:
    """`gemmy serve`: check the arguments and Blender first, so a mistake fails at startup, not on the first change."""
    from .serve import BlenderRender, Preview, compile_build, scene_file_build, serve

    if args.scene is not None and (args.poscar is not None or args.configs):
        print("error: give configs, or --scene, not both.", file=sys.stderr)
        return 2
    if len(args.configs) > 1 and (args.poscar or args.title or args.render):
        print("error: --poscar, --title and --render take one config.", file=sys.stderr)
        return 2
    if args.scene is not None:
        builds = [(*scene_file_build(args.scene), args.scene.stem, args.scene.name)]
    elif args.configs:
        builds = [(*compile_build(config, args.poscar), _config_name(config), "scene.json") for config in args.configs]
    else:
        print("error: give a config (gemmy serve config.toml), or --scene.", file=sys.stderr)
        return 2
    render = None
    if args.render is not None:
        from .render.launch import BlenderNotFoundError, find_blender

        try:
            blender = find_blender(args.blender)
            settings = resolve_settings(args)
        except (BlenderNotFoundError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        render = BlenderRender(blender, settings, args.render)
    names = [args.title or name for _, _, name, _ in builds]
    previews = [
        Preview(
            build,
            watch,
            names[k],
            render=render,
            render_output=str(args.render or ""),
            scene_file=scene_file,
            apply_view=render.use_view if render is not None else None,
            tabs=[(name, str(j)) for j, name in enumerate(names)],
            tab=k,
        )
        for k, (build, watch, _, scene_file) in enumerate(builds)
    ]
    return serve(previews, args.host, args.port, open_browser=args.open)


def _config_name(config: Path) -> str:
    """`ice-ih/config.toml` is "ice-ih"; any other config is its file name without extension."""
    return config.resolve().parent.name if config.stem == "config" else config.stem


def run_compile(args) -> int:
    from .compile.pipeline import compile_to_json

    try:
        scene = compile_to_json(args.config, args.out, args.poscar)
    except ValueError as exc:  # no structure named, or an invalid config: the message says which key
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(
        f"Compiled scene -> {args.out} "
        f"(points={len(scene.points)}, atoms={len(scene.primitives.atoms)}, "
        f"bonds={len(scene.primitives.bonds)}, polyhedra={len(scene.primitives.polyhedra)}, "
        f"displacements={len(scene.primitives.displacements)})"
    )
    return 0


def _view_argument_error(args) -> str | None:
    """The reason `gemmy view` cannot run with these arguments, or None. The gallery's pairing (--gallery and
    --thumbnails go together) is checked by write_hosted_site, which takes both."""
    if not args.scenes:
        return "give a scene (gemmy view scene.json --out page.html)."
    if len(args.scenes) > 1 and args.title is not None:
        return "--title takes one scene; with several, each page is named after its file."
    if (args.gallery is not None or args.thumbnails is not None) and not args.hosted:
        return "--gallery and --thumbnails need --hosted."
    if args.structure and not args.hosted:
        return "--structure needs --hosted."
    if args.site_url is not None and not args.hosted:
        return "--site-url needs --hosted."
    if args.hosted and args.title is not None:
        return "the hosted site has one page, named gemmy: --title does not apply."
    if args.hosted and args.subtitle:
        return "the hosted site has no subtitle: its one page has the start screen, and a scene has no line under it."
    return None


def _hosted_structures(pairs: Sequence[str]) -> dict[str, list[Path]]:
    """`--structure NAME=CONFIG` as the hosted site takes it: per scene, the structure file the config names, then the
    files the config names, then the config itself (the names are relative to the config's folder)."""
    from .config import referenced_files
    from .datafile import read_data

    structures: dict[str, list[Path]] = {}
    for pair in pairs:
        name, _, config = pair.partition("=")
        if not name or not config:
            raise ValueError(f"--structure takes NAME=CONFIG, got {pair!r}")
        path = Path(config)
        raw = read_data(path)
        if not isinstance(raw, dict) or not isinstance(raw.get("structure"), str):
            raise ValueError(f"{path} names no structure file")
        folder = path.parent
        structures[name] = [folder / ref for ref in referenced_files(raw)] + [path]
    return structures


def run_view(args) -> int:
    from .site import write_hosted_site
    from .view import write_site, write_viewer

    error = _view_argument_error(args)
    if error is not None:
        print(f"error: {error}", file=sys.stderr)
        return 2
    try:
        if args.hosted:
            out = write_hosted_site(
                args.scenes,
                args.out,
                gallery=args.gallery,
                thumbnails=args.thumbnails,
                structures=_hosted_structures(args.structure),
                site_url=args.site_url,
            )
        elif len(args.scenes) == 1:
            out = write_viewer(args.scenes[0], args.out, args.title, args.subtitle)
        else:
            out = write_site(args.scenes, args.out, args.subtitle)
    except (OSError, ValueError, TypeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote viewer -> {out}")
    return 0


def run_render(args) -> int:
    """`gemmy render`: resolve the plan. With --no-run it is written (to --plan-out, else next to the scene); with
    Blender it is written once, to --plan-out or a temp file that is gone when Blender has read it."""
    from .render.launch import BlenderNotFoundError, find_blender, run_plan_in_blender

    try:
        settings = resolve_settings(args)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    plan_json = json.dumps(dataclasses.asdict(settings.resolve(str(Path(args.scene).resolve()))), indent=2)
    if not args.run:
        plan_path = Path(args.plan_out or f"{args.scene}.plan.json")
        plan_path.write_text(plan_json, encoding="utf-8")
        print(f"Resolved render plan -> {plan_path}")
        return 0
    try:
        blender = find_blender(args.blender)
    except BlenderNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="gemmy-") as tmp:
        plan_path = Path(args.plan_out) if args.plan_out else Path(tmp) / "plan.json"
        plan_path.write_text(plan_json, encoding="utf-8")
        return run_plan_in_blender(blender, str(plan_path), gui=args.gui)


def _commands() -> dict[type, Callable[[Any], int]]:
    """The run function of each parsed command. Their imports stay inside them: `gemmy view` never loads the numbers."""
    from .cli_args import Compile, Render, Serve, View

    return {Compile: run_compile, Render: run_render, View: run_view, Serve: run_serve}


def main(argv: list[str] | None = None) -> int:
    user_argv = _extract_user_argv(argv)
    if user_argv[:1] == ["_run-plan"]:
        # Entry used inside Blender, where pydantic is unavailable: tyro is not installed there.
        return run_plan(user_argv[user_argv.index("--plan") + 1])

    from .cli_args import parse

    args = parse(user_argv)
    return _commands()[type(args)](args)


if __name__ == "__main__":
    raise SystemExit(main())
