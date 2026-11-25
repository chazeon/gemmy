#!/usr/bin/env bash
# Rebuild the gh-pages branch (GitHub Pages) from the committed examples with scripts/build_site.sh, and commit it.
# It does not push: run `git push github gh-pages` afterwards. No Blender.
# The branch holds exactly these files, and nothing else:
#   index.html                    the front page: the viewer, with every example as a default tab
#   viewer.<hash>.js              the one viewer, shared by every page; the hash is the first 10 hex digits of its
#   style.<hash>.css              SHA-256, so a new build is never served a stale copy (GitHub Pages caches ~10 min)
#   view/index.html               the viewer with no scene (?scene=, ?gist=, or a dropped file)
#   <example>/index.html          one page per committed example: the viewer, with its scene as the default
#   <example>/scene.json.gz      its compiled scene, gzipped (not hashed: a stale copy of a scene is harmless)
#   .nojekyll                     serve the files as they are, without Jekyll
# for each <example> in nacl, ice-ih and stishovite (scripts/build_site.sh). The pusher checks this set.
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
