#!/usr/bin/env bash
# Pre-render the start screen's gallery thumbnails into docs/images/gallery/<name>.png: each committed example's page
# in headless Chrome (scripts/render_thumbnails.mjs). Each picture is trimmed to the structure (the background is the
# corner's colour), fitted into 400 x 267 (3:2, the card's shape) with a small margin and centred on that background,
# then optimised (pngquant when installed, else ImageMagick with 96 colours: the protein pictures stay under about 40 KB). No Blender. Needs Google Chrome, Node 22 or later and ImageMagick. Scratch files go
# to a temp dir.
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

examples=(nacl methane-clathrate-si ice-ih stishovite dry-ice uio-66 c60 c60-cage dna-1bna glut1-4pyp nav17-6j8i nucleosome-1kx5 apoferritin)  # the committed examples, never examples/private/
scenes=()
for example in "${examples[@]}"; do
  $gemmy compile "$root/examples/$example/config.toml" --out "$scratch/$example.json" >/dev/null
  scenes+=("$scratch/$example.json")
done
$gemmy view --hosted "${scenes[@]}" --out "$scratch/site" >/dev/null

port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$scratch/site" >/dev/null 2>&1 &
server_pid=$!
for _ in $(seq 50); do curl -fs -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.1; done

mkdir -p "$scratch/raw" "$out"
node "$root/scripts/render_thumbnails.mjs" "http://127.0.0.1:$port/" "$scratch/raw" "${examples[@]}"

for example in "${examples[@]}"; do
  background="$(magick "$scratch/raw/$example.png" -format '%[pixel:p{0,0}]' info:)"
  magick "$scratch/raw/$example.png" -fuzz 4% -trim +repage -filter Lanczos -resize 380x254 -background "$background" \
    -gravity center -extent 400x267 -strip "$scratch/$example.png"
  if command -v pngquant >/dev/null; then
    pngquant --quality 70-95 --force --output "$out/$example.png" "$scratch/$example.png"
  else
    magick "$scratch/$example.png" -colors 96 -dither None -strip -define png:compression-level=9 "PNG8:$out/$example.png"
  fi
  echo "$example.png: $(wc -c < "$out/$example.png" | tr -d ' ') bytes"
done
echo "wrote $out/"
