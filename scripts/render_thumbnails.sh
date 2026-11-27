#!/usr/bin/env bash
# Pre-render the start screen's gallery thumbnails into docs/images/gallery/<name>.png: each committed example's page
# in headless Chrome (scripts/render_thumbnails.mjs), on a transparent background. Each picture is trimmed to the
# structure on its alpha, fitted into 400 x 267 (3:2, the card's shape) with a small margin and centred on transparency,
# then optimised with its alpha kept (pngquant when installed, else ImageMagick with 96 colours: the protein pictures stay
# under about 40 KB). No Blender. Needs Google Chrome, Node 22 or later and ImageMagick. Scratch files go to a temp dir.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gemmy="${GEMMY:-uv run --project $root gemmy}"
out="$root/docs/images/gallery"
scratch="$(mktemp -d)"
server_pid=""
cleanup() {
  [[ -n "$server_pid" ]] && kill "$server_pid" 2>/dev/null || true
  rm -rf "$scratch"
}
trap cleanup EXIT

examples=($(<"$root/scripts/examples.txt"))  # the committed examples in gallery order, never examples/private/
scenes=()
structures=()
for example in "${examples[@]}"; do
  $gemmy compile "$root/examples/$example/config.toml" --out "$scratch/$example.json" >/dev/null
  scenes+=("$scratch/$example.json")
  structures+=("$example=$root/examples/$example/config.toml")
done
# the site as scripts/build_site.sh builds it (its thumbnails are the old ones, only there for the gallery to list): the
# capture opens each example from the gallery
$gemmy view --hosted "${scenes[@]}" --structure "${structures[@]}" --gallery "$root/examples" --thumbnails "$out" --out "$scratch/site" >/dev/null

port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$scratch/site" >/dev/null 2>&1 &
server_pid=$!
for _ in $(seq 50); do curl -fs -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.1; done

mkdir -p "$scratch/raw" "$out"
# The capture's exit status is checked by hand: a failed capture stops the script with status 1, whatever wraps it.
if ! node "$root/scripts/render_thumbnails.mjs" "http://127.0.0.1:$port/" "$scratch/raw" "${examples[@]}"; then
  echo "render_thumbnails.sh: the Chrome capture failed; no thumbnail was written" >&2
  exit 1
fi
for example in "${examples[@]}"; do
  [[ -s "$scratch/raw/$example.png" ]] || { echo "render_thumbnails.sh: no capture for $example" >&2; exit 1; }
done

for example in "${examples[@]}"; do
  # the capture's background is transparent, so -trim cuts the transparent border and the structure sets the box
  magick "$scratch/raw/$example.png" -fuzz 4% -trim +repage -filter Lanczos -resize 380x254 -background none \
    -gravity center -extent 400x267 -strip "$scratch/$example.png"
  if command -v pngquant >/dev/null; then
    pngquant --quality 70-95 --force --output "$out/$example.png" "$scratch/$example.png"
  else
    magick "$scratch/$example.png" -colors 96 -dither None -strip -define png:compression-level=9 "PNG8:$out/$example.png"
  fi
  echo "$example.png: $(wc -c < "$out/$example.png" | tr -d ' ') bytes"
done
echo "wrote $out/"
