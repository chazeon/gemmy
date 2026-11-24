#!/usr/bin/env bash
# Run before every commit: format check, lint, tests. `--blender` also runs the real-Blender suite
# (pytest -m blender, bpy in a separate Python 3.13 environment).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
uv run ruff format --check .
uv run ruff check .
uv run pytest -q
if [[ "${1:-}" == "--blender" ]]; then
  UV_PROJECT_ENVIRONMENT=.venv-blender uv run --python 3.13 --group blender pytest -q -m blender
fi
