#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

current=$(node -p "require('./package.json').version")
IFS='.' read -r major minor patch <<< "$current"
next="${major}.${minor}.$((patch + 1))"

node -e "const pkg=require('./package.json'); pkg.version='${next}'; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2)+'\n');"

git add package.json
git commit -m "Bump version to ${next}"
git tag "v${next}"
git push && git push origin "v${next}"

echo "Released v${next}"
