#!/usr/bin/env bash
# Compile and render this example. Needs gemmy installed (or: GEMMY="uv run gemmy") and Blender
# (found automatically, or set $BLENDER). Output goes to $OUT (default ./renders).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${OUT:-./renders}"
GEMMY="${GEMMY:-gemmy}"
mkdir -p "$out"

$GEMMY compile "$here/config.toml" --out "$out/scene.json"
$GEMMY render --scene "$out/scene.json" --out "$out/ice-ih.png" --camera.azimuth 25 --camera.elevation 25 --camera.projection ortho --camera.zoom 1.15 --cell-box.show True \
  --quality.resolution ${RES:-1200 1200} --quality.samples ${SAMPLES:-64}

