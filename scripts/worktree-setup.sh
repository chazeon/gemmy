#!/usr/bin/env bash
# Sets up a worktree to run scripts/check.sh: the Python environment (uv sync) and the viewer's dev tools in
# web/node_modules. When the main checkout has the same web/package-lock.json, web/node_modules is a symlink to its
# install (instant); otherwise it is installed with npm ci. Safe to run again. Run it in the worktree, not the main
# checkout, and never `npm install` inside a symlinked worktree: that changes the main checkout's modules too.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

uv sync --quiet
echo "worktree-setup: .venv ready"

if ! command -v npm >/dev/null; then
  echo "worktree-setup: npm not found, web/node_modules skipped (the viewer's checks skip too)"
  exit 0
fi

same_lock() {
  [[ "$main" != "$here" && -d "$main/web/node_modules" ]] && cmp -s web/package-lock.json "$main/web/package-lock.json"
}

if [[ -L web/node_modules ]]; then
  if same_lock && [[ -d web/node_modules ]]; then
    echo "worktree-setup: web/node_modules already linked to $main"
    exit 0
  fi
  rm web/node_modules  # only the link: npm ci must never run through it
fi
if [[ -d web/node_modules ]]; then
  echo "worktree-setup: web/node_modules is installed here"
  exit 0
fi
if same_lock; then
  ln -s "$main/web/node_modules" web/node_modules
  echo "worktree-setup: web/node_modules linked to $main/web/node_modules (same package-lock.json)"
else
  npm ci --prefix web
  echo "worktree-setup: web/node_modules installed with npm ci"
fi
