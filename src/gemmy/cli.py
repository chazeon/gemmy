from __future__ import annotations

import dataclasses
import json
import sys
import tempfile
from pathlib import Path


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


def main(argv: list[str] | None = None) -> int:
    user_argv = _extract_user_argv(argv)
    if user_argv[:1] == ["_run-plan"]:
        # Entry used inside Blender, where pydantic is unavailable: tyro is not installed there.
        return run_plan(user_argv[user_argv.index("--plan") + 1])

    from .cli_args import Compile, Serve, View, parse

    args = parse(user_argv)

    if isinstance(args, Compile):
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

    if isinstance(args, View):
        from .view import write_hosted_site, write_site, write_viewer

        if not args.scenes:
            print("error: give a scene (gemmy view scene.json --out page.html).", file=sys.stderr)
            return 2
        if len(args.scenes) > 1 and args.title is not None:
            print("error: --title takes one scene; with several, each page is named after its file.", file=sys.stderr)
            return 2
        if (args.gallery is not None or args.thumbnails is not None) and not args.hosted:
            print("error: --gallery and --thumbnails need --hosted.", file=sys.stderr)
            return 2
        try:
            if args.hosted:
                out = write_hosted_site(args.scenes, args.out, args.subtitle, args.gallery, args.thumbnails)
            elif len(args.scenes) == 1:
                out = write_viewer(args.scenes[0], args.out, args.title, args.subtitle)
            else:
                out = write_site(args.scenes, args.out, args.subtitle)
        except (OSError, ValueError, TypeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(f"Wrote viewer -> {out}")
        return 0

    if isinstance(args, Serve):
        return run_serve(args)

    else:
        from .render.launch import BlenderNotFoundError, find_blender, run_plan_in_blender

        try:
            settings = resolve_settings(args)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        plan_json = json.dumps(dataclasses.asdict(settings.resolve(str(Path(args.scene).resolve()))), indent=2)
        blender = None
        if args.run:
            try:
                blender = find_blender(args.blender)
            except BlenderNotFoundError as exc:
                print(f"error: {exc}", file=sys.stderr)
                return 2
        if args.plan_out or not args.run:
            plan_path = Path(args.plan_out or str(args.scene) + ".plan.json")
            plan_path.write_text(plan_json, encoding="utf-8")
            if not args.run:
                print(f"Resolved render plan -> {plan_path}")
                return 0
            return run_plan_in_blender(blender, str(plan_path), gui=args.gui)
        with tempfile.TemporaryDirectory(prefix="gemmy-") as tmp:
            plan_path = Path(tmp) / "plan.json"
            plan_path.write_text(plan_json, encoding="utf-8")
            return run_plan_in_blender(blender, str(plan_path), gui=args.gui)


if __name__ == "__main__":
    raise SystemExit(main())
