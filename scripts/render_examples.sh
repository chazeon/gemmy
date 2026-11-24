#!/usr/bin/env bash
# Render every example and copy the pictures into docs/images/ for the README.
# Needs Blender (found automatically, or set $BLENDER) and ImageMagick. Scratch output goes to $OUT (default a temp dir).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${OUT:-$(mktemp -d)}"
export GEMMY="${GEMMY:-uv run --project $root gemmy}" RES="${RES:-800 800}" SAMPLES="${SAMPLES:-64}"
mkdir -p "$root/docs/images"

for example in nacl ice-ih stishovite; do
  OUT="$out/$example" "$root/examples/$example/render.sh"
done
# 600 px, 256-colour PNG: tens of KB each instead of ~600 KB. Needs ImageMagick.
for png in "$out/nacl/nacl.png" "$out/ice-ih/ice-ih.png" "$out/stishovite/stishovite.png" "$out/stishovite/stishovite_c.png"; do
  magick "$png" -resize 600x600 -colors 256 -strip -define png:compression-level=9 "PNG8:$root/docs/images/$(basename "$png")"
done
echo "wrote $root/docs/images/"
