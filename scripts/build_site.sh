#!/usr/bin/env bash
# Build a hosted site of the committed examples for GitHub Pages or any static host. No Blender. Writes $OUT (default
# site/): index.html, the one page: the viewer, whose start screen lists the examples and opens one when chosen (or any
# scene by address or file); viewer.<hash>.js, style.<hash>.css and compile.<hash>.js (the shared viewer, stylesheet and
# structure compiler, named by the hash of their content); examples.json (the gallery, in order, with the titles from each
# example's gallery.json); and per example <example>/: its structure file and config.toml with the files the config names
# (labels, displacements), copied as they are so the page compiles them in the browser, and thumbnail.png. No scene file:
# each example's config is compiled here to check it. The examples and their order are scripts/examples.txt. SITE_URL is
# the site's absolute address (default https://chazeon.github.io/gemmy/): the front page's canonical address and social
# tags use it. See gemmy.site.write_hosted_site.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${OUT:-$root/site}"
site_url="${SITE_URL:-https://chazeon.github.io/gemmy/}"  # the absolute address of the site (canonical and og:url)
gemmy="${GEMMY:-uv run --project $root gemmy}"
scenes="$(mktemp -d)"
trap 'rm -rf "$scenes"' EXIT

files=()
structures=()
for example in $(<"$root/scripts/examples.txt"); do  # the committed examples in gallery order, never examples/private/
  $gemmy compile "$root/examples/$example/config.toml" --out "$scenes/$example.json"  # checks the config compiles
  files+=("$scenes/$example.json")
  structures+=("$example=$root/examples/$example/config.toml")
done
$gemmy view --hosted "${files[@]}" --structure "${structures[@]}" --gallery "$root/examples" --thumbnails "$root/docs/images/gallery" --out "$out" --site-url "$site_url"  # examples.json from each gallery.json
