#!/usr/bin/env bash
# Builds a release of the Modulus system.
#
#   ./build.sh <version> [--no-deploy]
#
# Checks docs/patch-notes.md has a section for the version, sets the version in system.json, builds the
# compendium packs from packs/_source, runs every check (any failure stops the build), zips the system as
# dist/modulus-v<version>.zip, checks every compendium in the zip matches its sources, records the pass in dist/build-<version>.json, then deploys it to the
# Foundry server with deploy.sh.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-}"
DEPLOY=1
for arg in "${@:2}"; do
  case "$arg" in
    --no-deploy) DEPLOY=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: ./build.sh <version> [--no-deploy]   (version like 0.1.1)" >&2
  exit 2
fi

step() { printf '\n== %s\n' "$*"; }
[ -d node_modules ] || { step "Installing tools"; npm ci; }

step "Patch notes"
grep -q "^## ${VERSION//./\\.}\$" docs/patch-notes.md || { echo "docs/patch-notes.md has no \"## $VERSION\" section: add this version's notes first" >&2; exit 1; }
echo "docs/patch-notes.md has notes for $VERSION"

mkdir -p dist
rm -f "dist/build-$VERSION.json"
# Uncommitted changes to shipped files (the version and the built packs are rewritten below, so they don't count).
DIRTY=$(git status --porcelain -- module templates styles lang packs/_source | wc -l | tr -d ' ')

step "Version $VERSION"
node scripts/set-version.mjs "$VERSION"

step "Compendium packs"
node scripts/build-packs.mjs
node harness/compendium-check.mjs

step "Module load"
node harness/load-check.mjs

step "Actions check"
node harness/actions-check.mjs

step "Unit tests"
node --test "tests/**/*.test.js"

step "Zip"
ZIP="dist/modulus-v$VERSION.zip"
rm -f "$ZIP"
node scripts/make-zip.mjs "$ZIP"

step "Compendiums in the zip"
node harness/compendium-check.mjs "$ZIP"
cp system.json "dist/system-$VERSION.json"

SHA=$(sha256sum "$ZIP" | cut -d' ' -f1)
COMMIT=$(git rev-parse HEAD)
cat > "dist/build-$VERSION.json" <<JSON
{ "version": "$VERSION", "zip": "$ZIP", "sha256": "$SHA", "commit": "$COMMIT", "uncommittedFiles": $DIRTY, "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
JSON
step "Passed: $ZIP ($SHA)"

if [ "$DEPLOY" = 1 ]; then
  step "Deploy"
  ./deploy.sh "$ZIP"
else
  echo "Not deployed (--no-deploy)."
fi
