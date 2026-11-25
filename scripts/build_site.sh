#!/usr/bin/env bash
# Build a hosted site of the committed examples for GitHub Pages or any static host. No Blender. Writes $OUT (default
# site/): index.html (the front page: the start screen, which lists the examples and opens one when chosen), viewer.<hash>.js and
# style.<hash>.css (the one viewer, shared by every page; the hash is of the file's content), view/index.html (the
# viewer with no scene: ?scene=, ?gist= or a dropped file), and per example <example>/index.html (its page) with
# <example>/scene.json.gz (its scene), and examples.json (the examples in order, with the titles from each example's
# gallery.json). The examples and their order are scripts/examples.txt. See gemmy.site.write_hosted_site.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${OUT:-$root/site}"
gemmy="${GEMMY:-uv run --project $root gemmy}"
scenes="$(mktemp -d)"
trap 'rm -rf "$scenes"' EXIT

files=()
for example in $(<"$root/scripts/examples.txt"); do  # the committed examples in gallery order, never examples/private/
  $gemmy compile "$root/examples/$example/config.toml" --out "$scenes/$example.json"
  files+=("$scenes/$example.json")
done
$gemmy view --hosted "${files[@]}" --gallery "$root/examples" --thumbnails "$root/docs/images/gallery" --out "$out"  # examples.json from each gallery.json
