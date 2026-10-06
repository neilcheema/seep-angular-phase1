# App version 1.7.1

A small step up from 1.7.0, to be committed **together with the 6a polish files** (`seep-polish-6a.zip`). The two files in this zip change only the version number and its guard test; the visible changes are in the 6a package.

## Apply, in one commit
1. Copy the three files from `seep-polish-6a.zip` (all under `projects/seep-web/src/app/pages/`):
   `online/online-game.component.html`, `two-player/two-player.component.html`, `four-player/four-player.component.html`.
2. Copy the two files from this zip:
   - `projects/seep-web/src/app/version.ts`: the same file as the 1.7.0 one with **one line changed** (`APP_VERSION = '1.7.1'`). If you have edited it since, keep your edits and change only the number.
   - `projects/seep-web/src/app/core/__tests__/version.test.ts`: the same guard, with its floor raised: the version must be three plain numbers and must **not be older than 1.7.0** (it was 1.6.0).
3. Optional, if you keep it in step: `"version": "1.7.1"` in your root `package.json`.
4. `npm test && npm run lint && npm run build`, then commit and push.

## What 1.7.1 contains (since 1.7.0)
- **The reaction message no longer covers the bid.** It appears over the opponent's face-down cards (the partner's cards at a four-player table) instead of floating over the status bar.
- **The reactions tray has a solid background,** so your own cards no longer show through it.
- Nothing else. No API change and **no database migration**; migrations 005 to 009 are all that are needed, and you have them.

## After deploying
- The landing page footer reads **v1.7.1**, and the "notice something off?" note includes `Version: 1.7.1`.
- Someone who already has the site open stays on the old version until they reload.
- **Leave `MIN_CLIENT_VERSION` unset.** Setting it to 1.7.1 would force everyone to refresh before they could play online, for a change that is only cosmetic.

## Checked
- The strict Angular compile is clean and the compiled output reads 1.7.1; the lint is clean on both files; all 296 web tests pass.
- The guard test **fails** on `v1.7.1`, `1.7`, `1.7.1-beta` and `1.6.9` (below the new floor), and passes on `1.7.1`.
- A real browser loads the landing page and the footer shows **v1.7.1**, with no page errors.
- The new `version.ts` differs from the 1.7.0 file I delivered by exactly one line.

## NOT checked
- Your actual repo (if your `version.ts` has changed since 1.7.0, apply only the one-line change), your root `package.json`, and the deployed site (I have not seen seep.quest show 1.7.1).
- The 6a changes on your phone with your real stylesheet; see the 6a notes for what to look at.
