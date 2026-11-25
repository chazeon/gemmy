#!/usr/bin/env bash
# Build a hosted site of the committed examples for GitHub Pages or any static host. No Blender. Writes $OUT (default
# site/): index.html (the front page: the viewer, with every example as a default tab), viewer.<hash>.js and
# style.<hash>.css (the one viewer, shared by every page; the hash is of the file's content), view/index.html (the
# viewer with no scene: ?scene=, ?gist= or a dropped file), and per example <example>/index.html (its page) with
# <example>/scene.json.gz (its scene). See gemmy.view.write_hosted_site.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${OUT:-$root/site}"
gemmy="${GEMMY:-uv run --project $root gemmy}"
scenes="$(mktemp -d)"
trap 'rm -rf "$scenes"' EXIT

files=()
for example in nacl ice-ih stishovite; do  # the committed examples, never examples/private/
  $gemmy compile "$root/examples/$example/config.toml" --out "$scenes/$example.json"
  files+=("$scenes/$example.json")
done
$gemmy view --hosted "${files[@]}" --out "$out"
