#!/usr/bin/env bash
# Run before every commit: format check, lint, tests. `--blender` also runs the real-Blender suite
# (pytest -m blender, bpy in a separate Python 3.13 environment). `--browser` runs the viewer in headless Chrome
# (pytest -m browser, ~20 s; skipped when Chrome or Node 22 is missing). `--slow` runs the heavy examples and the
# hosted site build (pytest -m slow, about a minute).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
has_node=0
if command -v node >/dev/null && command -v npm >/dev/null; then has_node=1; fi
# The viewer's dev tools; the node tests skip without them.
if [[ $has_node == 1 && ! -d web/node_modules ]]; then npm ci --prefix web; fi
uv run ruff format --check .
uv run ruff check .
uv run pytest -q
if [[ $has_node == 1 ]]; then
  npm --prefix web run check
  npm --prefix web run lint
  built="$(mktemp -d)"
  trap 'rm -rf "$built"' EXIT
  npm --prefix web run build --silent -- "$built"
  diff -r "$built" src/gemmy/viewer || { echo "viewer: built files are stale, run npm --prefix web run build" >&2; exit 1; }
  echo "viewer: types ok, build fresh"
else
  echo "viewer: skipped (node not found)"
fi
for option in "$@"; do
  case "$option" in
    --blender) UV_PROJECT_ENVIRONMENT=.venv-blender uv run --python 3.13 --group blender pytest -q -m blender ;;
    --browser) uv run pytest -q -m browser -rs ;;
    --slow) uv run pytest -q -m slow ;;
    *) echo "check.sh: unknown option $option" >&2; exit 2 ;;
  esac
done
