# Release 1.9.4: the complete set, in one go

Your test run showed that some files of the separate packages did not end up as their final versions in your repository (the two game screens and the Clarity files). Several packages change the same two game-screen files, and a package applied later silently replaces what an earlier one put there, so the result depends on the order and on how the files were copied. **This zip removes the order problem: it holds the final version of every file of release 1.9.4, so you extract it once, over everything, and nothing can be overwritten by something older.**

## Use it (Terminal, from the repository root)
```
cd ~/Desktop/seep-angular-phase1
unzip -o ~/Downloads/seep-release-1.9.4-complete.zip
bash verify-release.sh
npm test && npm run lint && npm run build
```
- `unzip -o` overwrites without asking. (Dragging folders in Finder can offer "Skip" or "Keep both", which would leave old files in place, so use the command.)
- `verify-release.sh` checks all 20 files against their fingerprints and prints `ok`, `DIFFERENT` or `MISSING` for each. It should end with "Release 1.9.4 is complete in this repository." Run it **before** deploying, and again if anything looks off.
- The test run should show **1,152 tests, none failing** (480 API, 266 engine, 406 web). If you see 1,146 and six failures in `button-rules.test.ts`, the screens are still old: run `bash verify-release.sh` to see which files.
- Optional: set `"version": "1.9.4"` in the root `package.json` (your last run printed 1.9.1).

## What is in it (20 files)
- **Version:** `version.ts` (1.9.4) and its guard test.
- **Pop-up fix, house buttons:** the two game screens (`.ts` and `.html` each), the engine helpers (`preview.ts`, `public-api.ts`) and their tests, the pop-up and button guard tests.
- **Install guides:** the two PDFs, the home page's two files, the guard test.
- **Clarity:** `analytics-consent.ts`, `analytics.service.ts`, the banner, and the consent tests.

`release-1.9.4.sha256` and `verify-release.sh` are only for checking; you do not need to commit them.
A website change only: no API redeploy, no migration, no setting.
