#!/usr/bin/env bash
# Compile and render this example. Needs gemmy installed (or: GEMMY="uv run gemmy") and Blender
# (found automatically, or set $BLENDER). Output goes to $OUT (default ./renders).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${OUT:-./renders}"
GEMMY="${GEMMY:-gemmy}"
mkdir -p "$out"

$GEMMY compile "$here/config.toml" --out "$out/scene.json"
$GEMMY render --scene "$out/scene.json" --out "$out/stishovite.png" --look.preset 3to2d --polyhedron.opacity 1 \
  --camera.zoom 0.9 --quality.resolution ${RES:-1200 1200}

# Down c: the edge-sharing octahedron chains seen end on, linked to each other by corners.
$GEMMY render --scene "$out/scene.json" --out "$out/stishovite_c.png" --look.preset 3to2d --polyhedron.opacity 1 \
  --camera.direction 0 0 1 --camera.zoom 1.12 --quality.resolution ${RES:-1200 1200}
