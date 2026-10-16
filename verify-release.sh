#!/bin/bash
# Checks that every file of release 1.10.3 in THIS repository is exactly the final version.
# Run it from the repository root (the folder that contains "projects"):   bash verify-release.sh
cd "$(dirname "$0")" 2>/dev/null; [ -d projects ] || { echo "Run this from the repository root (the folder that contains 'projects')."; exit 2; }
if command -v shasum >/dev/null 2>&1; then HASH() { shasum -a 256 "$1" | cut -d' ' -f1; }; else HASH() { sha256sum "$1" | cut -d' ' -f1; }; fi
ok=0; bad=0
while read -r want path; do
  [ -z "$path" ] && continue
  if [ ! -f "$path" ]; then echo "MISSING    $path"; bad=$((bad+1)); continue; fi
  if [ "$(HASH "$path")" = "$want" ]; then echo "ok         $path"; ok=$((ok+1)); else echo "DIFFERENT  $path"; bad=$((bad+1)); fi
done < release-1.10.3.sha256
echo; echo "$ok files are the final 1.10.3 version, $bad are not."
[ "$bad" -eq 0 ] && echo "Release 1.10.3 is complete in this repository." || echo "Copy the files marked MISSING or DIFFERENT from seep-release-1.10.3.zip (overwrite), then run this again."
[ "$bad" -eq 0 ]
