#!/usr/bin/env bash
set -euo pipefail

# Basic static syntax gate for all JS entrypoints/source files.
# Using Node built-in parser to avoid external tooling requirements.
find . -type f -name "*.js" \
  -not -path "./node_modules/*" \
  -not -path "./dist/*" \
  -print0 | while IFS= read -r -d '' file; do
  node --check "$file" >/dev/null
done

echo "JavaScript syntax lint passed."
