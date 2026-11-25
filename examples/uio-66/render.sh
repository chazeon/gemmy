#!/usr/bin/env bash
# Compile and render this example. Needs gemmy installed (or: GEMMY="uv run gemmy") and Blender
# (found automatically, or set $BLENDER). Output goes to $OUT (default ./renders).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${OUT:-./renders}"
GEMMY="${GEMMY:-gemmy}"
mkdir -p "$out"

$GEMMY compile "$here/config.toml" --out "$out/scene.json"
$GEMMY render --scene "$out/scene.json" --out "$out/uio-66.png" --look.preset 3to2d --polyhedron.opacity 1 --quality.resolution ${RES:-800 800} --quality.samples ${SAMPLES:-64}
