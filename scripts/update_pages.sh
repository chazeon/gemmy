#!/usr/bin/env bash
# Rebuild the gh-pages branch (GitHub Pages) from the committed examples with scripts/build_site.sh, and commit it.
# It does not push: run `git push github gh-pages` afterwards. No Blender.
# The branch holds exactly these files, and nothing else:
#   index.html                    the one page: the viewer, whose start screen lists the examples (with their head metadata)
#   examples.json                 the gallery: each example's name, title, description, structure and thumbnail
#   viewer.<hash>.js              the shared viewer; the hash is the first 10 hex digits of its SHA-256, so a new build
#   style.<hash>.css              is never served a stale copy (GitHub Pages caches ~10 min)
#   compile.<hash>.js            the shared structure compiler
#   <example>/<structure>        its structure file, and config.toml with the files the config names (the page compiles them)
#   <example>/thumbnail.png      its gallery picture (docs/images/gallery/<example>.png)
#   .nojekyll                     serve the files as they are, without Jekyll
# for each committed example (the list in scripts/examples.txt, never examples/private/). The pusher checks this set.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tree="$(mktemp -d)"
trap 'git -C "$root" worktree remove --force "$tree"' EXIT

if git -C "$root" rev-parse --verify -q refs/heads/gh-pages >/dev/null; then
  git -C "$root" worktree add -q "$tree" gh-pages
else
  git -C "$root" worktree add -q --orphan -b gh-pages "$tree"
fi
git -C "$tree" rm -rq --ignore-unmatch .
git -C "$tree" clean -fdxq
OUT="$tree" "$root/scripts/build_site.sh"
touch "$tree/.nojekyll"  # serve the files as they are, without Jekyll
git -C "$tree" add -A
if git -C "$tree" diff --cached --quiet; then
  echo "gh-pages: no changes"
else
  git -C "$tree" commit -qm "pages: examples from $(git -C "$root" rev-parse --short HEAD)"
  echo "gh-pages: committed; publish with: git push github gh-pages"
fi
