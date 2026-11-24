"""Locate Blender and run a resolved render plan in it (outer process, stdlib only)."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

KNOWN_LOCATIONS = (
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "~/Applications/Blender.app/Contents/MacOS/Blender",
    "/usr/bin/blender",
    "/usr/local/bin/blender",
    "/snap/bin/blender",
    "C:/Program Files/Blender Foundation/Blender/blender.exe",
)


class BlenderNotFoundError(RuntimeError):
    pass


def find_blender(
    explicit: str | None = None,
    env: Mapping[str, str] | None = None,
    which: Callable[[str], str | None] = shutil.which,
    exists: Callable[[str], bool] = os.path.isfile,
    locations: Sequence[str] | None = None,
) -> str:
    """Resolve the Blender executable: --blender flag, $BLENDER, PATH, then well-known locations."""
    env = os.environ if env is None else env
    locations = KNOWN_LOCATIONS if locations is None else locations
    tried: list[str] = []
    for label, candidate in (("--blender", explicit), ("$BLENDER", env.get("BLENDER"))):
        if candidate:
            expanded = os.path.expanduser(candidate)
            if exists(expanded):
                return expanded
            raise BlenderNotFoundError(f"{label} points to {candidate!r}, which is not a file.")
    found = which("blender")
    if found:
        return found
    tried.append("blender on PATH")
    for location in locations:
        expanded = os.path.expanduser(location)
        if exists(expanded):
            return expanded
        tried.append(location)
    raise BlenderNotFoundError(
        "Blender not found. Install Blender 4.2 or newer, or point to it with --blender PATH or $BLENDER. "
        "Looked in: " + "; ".join(tried)
    )


def build_command(blender: str, plan_path: str, *, gui: bool = False, src_root: Path | None = None) -> list[str]:
    """Blender command line that runs `gemmy _run-plan` with the package importable."""
    root = str(src_root or Path(__file__).resolve().parents[2])
    # Exceptions propagate, so --python-exit-code makes Blender exit non-zero on failure.
    bootstrap = (
        f"import sys; sys.path.insert(0, {root!r}); "
        f"from gemmy.cli import main; main(['_run-plan', '--plan', {plan_path!r}])"
    )
    command = [blender]
    if not gui:
        command.append("-b")
    command += ["--python-exit-code", "1", "--python-expr", bootstrap]
    return command


def run_plan_in_blender(blender: str, plan_path: str, *, gui: bool = False) -> int:
    command = build_command(blender, plan_path, gui=gui)
    print("Running:", " ".join(command[:3]), "...", file=sys.stderr)
    return subprocess.call(command)
