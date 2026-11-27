#!/usr/bin/env bash
# Build the vendored fastatoms (VASP, XYZ, CIF, LAMMPS and neighbour lists, as WebAssembly) into web/vendor/fastatoms/.
# Usage: scripts/build_fastatoms.sh [<commit-sha>]   (default: ca3d236, branch wasm-core of chazeon/fastatoms)
# It clones that commit into a scratch directory (removed on exit), builds the wasm with js/scripts/build-wasm.sh
# (--gemmy, LAMMPS on, single file; emsdk at $EMSDK or ~/emsdk), builds the TypeScript wrapper with npm, and copies
# js/dist/*.js, *.d.ts and dist/wasm/fastatoms.mjs with its fastatoms.d.mts (the glue stays in wasm/) plus
# LICENSE into a staging directory beside web/vendor/fastatoms/. It writes SOURCE there: repo, commit, build arguments,
# emscripten version and the sizes of fastatoms.mjs, and package.json with "type": "module". The staging tree is
# validated, then swapped in; if anything fails before the swap, the existing tree is left as it was.
# See docs/plans/ts-compile.md section 3.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sha="${1:-ca3d236}"
repo="https://github.com/chazeon/fastatoms"
build_args=(--gemmy -DFASTATOMS_WITH_LAMMPS=ON -DFASTATOMS_WASM_SINGLE_FILE=ON)
vendor="$root/web/vendor"
out="$vendor/fastatoms"

work="$(mktemp -d)"
staging=""
trap 'rm -rf "$work"; if [ -n "$staging" ]; then rm -rf "$staging"; fi' EXIT
src="$work/fastatoms"

git clone --quiet "$repo" "$src"
git -C "$src" checkout --quiet "$sha"
commit="$(git -C "$src" rev-parse HEAD)"

# The wasm build sources emsdk itself when emcmake is not on PATH.
(cd "$src" && bash js/scripts/build-wasm.sh "${build_args[@]}")
(cd "$src/js" && npm ci --silent && npm run build --silent)

# Staging is a sibling of the output, so the final swap is a rename within one directory.
staging="$(mktemp -d "$vendor/.fastatoms-staging.XXXXXX")"
mkdir -p "$staging/wasm"
# The JavaScript here is ES modules; this file says so, so node loads them without a module-type warning.
printf '{\n  "type": "module"\n}\n' > "$staging/package.json"
cp "$src"/js/dist/*.js "$src"/js/dist/*.d.ts "$staging/"
cp "$src/js/dist/wasm/fastatoms.mjs" "$src/js/dist/wasm/fastatoms.d.mts" "$staging/wasm/"
cp "$src/LICENSE" "$staging/"

if ! command -v emcc >/dev/null 2>&1; then
  source "${EMSDK:-$HOME/emsdk}/emsdk_env.sh" >/dev/null
fi
emcc_version="$(emcc --version 2>&1 | sed -n 1p)"
mjs="$staging/wasm/fastatoms.mjs"
raw="$(wc -c < "$mjs" | tr -d ' ')"
gz="$(gzip -9c "$mjs" | wc -c | tr -d ' ')"

cat > "$staging/SOURCE" <<EOF2
repo: $repo
commit: $commit
build: bash js/scripts/build-wasm.sh ${build_args[*]}
emscripten: $emcc_version
wasm/fastatoms.mjs: $raw bytes raw, $gz bytes gzip -9
EOF2

# Validate before touching the output: every file the package needs must exist and be non-empty.
for required in wasm/fastatoms.mjs wasm/fastatoms.d.mts index.js LICENSE SOURCE package.json; do
  if [ ! -s "$staging/$required" ]; then
    echo "build_fastatoms: staging is missing $required; $out is unchanged" >&2
    exit 1
  fi
done

# Swap: move the old tree aside, move the staging tree in, and put the old one back if the second move fails.
backup="$(mktemp -u "$vendor/.fastatoms-previous.XXXXXX")"
if [ -e "$out" ]; then mv "$out" "$backup"; fi
if ! mv "$staging" "$out"; then
  if [ -e "$backup" ]; then mv "$backup" "$out"; fi
  echo "build_fastatoms: could not move the new tree into $out; the previous tree is restored" >&2
  exit 1
fi
staging=""
rm -rf "$backup"

echo "build_fastatoms: $commit -> $out ($raw bytes raw, $gz bytes gzip -9)"
