#!/usr/bin/env bash
#
# Build the site and publish it to the `gh-pages` branch (GitHub Pages).
#
# GitHub Pages serves a *project* site from a sub-path
# (https://<user>.github.io/<repo>/), so the build needs a base path. This
# script sets BASE_PATH and pushes the built `dist/` to a fresh `gh-pages`
# branch — no GitHub Actions, no extra dependencies.
#
# Usage:
#   export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v22.19.0/installation/bin:$PATH"
#   tools/deploy-pages.sh              # publishes to origin
#
# Env overrides: BASE_PATH (default /web-node/), REMOTE (default origin)
set -euo pipefail

cd "$(dirname "$0")/.."

BASE_PATH="${BASE_PATH:-/web-node/}"
REMOTE="${REMOTE:-origin}"

echo "==> building (BASE_PATH=$BASE_PATH)"
rm -rf dist
BASE_PATH="$BASE_PATH" npm run build

echo "==> staging dist/ for the gh-pages branch"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -R dist/. "$tmp/"
# Jekyll would otherwise drop files/dirs that start with an underscore.
touch "$tmp/.nojekyll"

git -C "$tmp" init -q -b gh-pages
git -C "$tmp" add -A
git -C "$tmp" \
  -c user.name="$(git config user.name)" \
  -c user.email="$(git config user.email)" \
  commit -q -m "deploy: web-node site $(date -u +%Y-%m-%dT%H:%M:%SZ)"

url="$(git remote get-url "$REMOTE")"
git -C "$tmp" remote add origin "$url"

echo "==> pushing to $REMOTE gh-pages ($url)"
git -C "$tmp" push -f origin gh-pages

echo "==> done. GitHub Pages will rebuild shortly."
