#!/usr/bin/env sh
# npm run deploy: build the hosted ShaderLab and publish it to GitHub Pages.
#
# Pages serves the gh-pages branch (no Actions workflow, so this works with a
# plain `repo`-scoped token). The build goes in a throwaway worktree so the
# working tree and main are never touched. Run it from main when main is
# green; the site is live at https://joeylovespizza.github.io/ShaderLab/
# about a minute later.
set -eu
cd "$(dirname "$0")/.."

SHADERLAB_BASE=/ShaderLab/ npm run build

tmp=$(mktemp -d)
git worktree add -q --detach "$tmp"
(
  cd "$tmp"
  git checkout -q --orphan gh-pages
  git rm -rfq . >/dev/null 2>&1 || true
  cp -R "$OLDPWD/dist/." .
  touch .nojekyll
  git add -A
  git commit -q -m "Deploy $(git -C "$OLDPWD" rev-parse --short main)"
  git push -q -f origin gh-pages
)
git worktree remove -f "$tmp"
git branch -D gh-pages -q 2>/dev/null || true
echo "deployed main@$(git rev-parse --short main) to gh-pages"
