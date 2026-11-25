"""Command-line grammar: tyro builds the flags from the dataclasses below and from `RenderSettings`.

Imported lazily by `cli.main` (tyro is not available inside Blender). Settings flags keep their
dataclass nesting (`--quality.samples`, `--camera.elevation`, `--polyhedron.scale`); no flag is
written by hand. `--settings FILE` is loaded first and the flags override it.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import tyro

from .datafile import read_data
from .settings import RenderSettings


@dataclass(frozen=True)
class Compile:
    """Phase 1: compile a config (TOML or JSON, naming its structure file) into intermediate scene JSON."""

    config: tyro.conf.Positional[Path]
    """Compile config; its `structure` key names the POSCAR."""
    out: Path
    """Output intermediate scene JSON path."""
    poscar: Path | None = None
    """Use this structure instead of the config's (e.g. one config for several structures)."""


@dataclass(frozen=True)
class Render:
    """Phase 2: resolve render settings and write a plan for Blender (then run it)."""

    scene: Path
    """Path to intermediate scene JSON."""
    settings: Path | None = None
    """JSON or TOML file with RenderSettings; flags override it."""
    plan_out: Path | None = None
    """Keep the resolved plan JSON here (default: temp file)."""
    blender: str | None = None
    """Blender executable (default: $BLENDER, PATH, known places)."""
    gui: bool = False
    """Open the Blender UI instead of running in the background."""
    run: bool = True
    """Start Blender; --no-run only resolves settings and writes the plan."""
    overrides: Annotated[RenderSettings, tyro.conf.arg(name="")] = RenderSettings()


@dataclass(frozen=True)
class View:
    """Write scenes as self-contained HTML pages: an interactive three.js viewer (no Blender).

    One scene: --out is the page. Several: --out is a folder for a static site, OUT/<name>/index.html per scene
    (name: the scene file name without extension) with tabs between them, and OUT/index.html opening the first."""

    scenes: tyro.conf.Positional[tuple[Path, ...]]
    """Intermediate scene JSON files."""
    out: Path
    """Output HTML page (one scene) or site folder (several)."""
    title: str | None = None
    """Page title, one scene only (default: the scene file name without extension)."""
    subtitle: str = ""
    """Line under the title."""
    hosted: bool = False
    """Write a hosted site instead (--out is its folder, as for GitHub Pages): one shared viewer, a scene.json.gz per
    scene and a small page for each, view/ for any scene by address or file, and a front page: the viewer with
    every scene as a tab. Needs a web server."""
    gallery: Path | None = None
    """With --hosted: a folder with <scene name>/gallery.json (title and description) for every scene. Writes
    examples.json, the scenes in order, for the site's start screen."""
    thumbnails: Path | None = None
    """With --hosted and --gallery: a folder with <scene name>.png (the start screen's picture of each scene), copied
    into the site. Needed with --gallery, and the other way round."""


@dataclass(frozen=True)
class Serve:
    """Live previewer: compile on start, serve the viewer, recompile and refresh the page when files change.

    Give one or more configs (several show as tabs), or --scene for a fixed scene. With --render, Blender also
    renders the image after every good compile (the render flags are the same as for `render`)."""

    configs: tyro.conf.Positional[tuple[Path, ...]] = ()
    """Compile configs (each watched, with the structure, labels and displacement files it names)."""
    poscar: Path | None = None
    """Use this structure instead of the config's (watched; one config only)."""
    scene: Path | None = None
    """Serve this scene JSON instead of compiling (watched)."""
    port: int = 8000
    """Port (0: any free port)."""
    host: str = "127.0.0.1"
    """Address to listen on."""
    title: str | None = None
    """Page title (default: the config's folder, or the config or scene file name without extension; one config
    only)."""
    open: bool = False
    """Open the page in the default browser."""
    render: Path | None = None
    """Also render this image with Blender after every good compile (one config only)."""
    settings: Path | None = None
    """JSON or TOML file with RenderSettings; flags override it."""
    blender: str | None = None
    """Blender executable (default: $BLENDER, PATH, known places)."""
    overrides: Annotated[RenderSettings, tyro.conf.arg(name="")] = RenderSettings()


Command = (
    Annotated[Compile, tyro.conf.subcommand("compile")]
    | Annotated[Render, tyro.conf.subcommand("render")]
    | Annotated[View, tyro.conf.subcommand("view")]
    | Annotated[Serve, tyro.conf.subcommand("serve")]
)


def parse(argv: list[str]) -> Compile | Render | View | Serve:
    """Parse argv. For `render` and `serve`, the `--settings` file becomes the defaults of a second parse."""
    command = tyro.cli(Command, args=argv, description="gemmy: compile crystal structures, render them in Blender.")
    if isinstance(command, (Render, Serve)) and command.settings is not None:
        from .config import validate_settings

        raw = read_data(command.settings)
        base = dataclasses.replace(command, overrides=validate_settings(raw))
        command = tyro.cli(
            Annotated[type(command), tyro.conf.subcommand(argv[0], default=base)],
            args=argv[1:],
        )
    return command
