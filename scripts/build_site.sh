#!/usr/bin/env bash
# Build a static site of the committed examples, one tab each, for GitHub Pages or any static host. No Blender.
# Writes $OUT (default site/): <example>/index.html per example and an index.html that opens the first.
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
$gemmy view "${files[@]}" --out "$out"
