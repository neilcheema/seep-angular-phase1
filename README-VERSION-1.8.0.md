# App version 1.8.0

A step up from 1.7.1, to be committed **together with the packages that make up the release** (list below). The two files in this zip change only the version number and its guard test; the visible changes are in the other packages.

## Apply
1. **Apply these packages first (or in the same commit), in this order:**
   1. `seep-learn-1-throw-hint.zip`: "why can't I throw this?"
   2. `seep-learn-2-move-lister.zip`: the engine's list of legal moves (invisible)
   3. `seep-learn-3-coach.zip`: the Learn Seep page and coach
   Anything you have already applied can be skipped. (The email-confirmation, unique-names and smoke-script packages are already live according to your smoke run; they are part of this release's history but need nothing now.)
2. **Then copy the two files from this zip:**
   - `projects/seep-web/src/app/version.ts`: the same file as the 1.7.1 one with **one line changed** (`APP_VERSION = '1.8.0'`). If you have edited it since, keep your edits and change only the number.
   - `projects/seep-web/src/app/core/__tests__/version.test.ts`: the same guard, with its floor raised: the version must be three plain numbers and must **not be older than 1.7.1** (it was 1.7.0).
3. Optional, if you keep it in step: `"version": "1.8.0"` in your root `package.json`.
4. `npm test && npm run lint && npm run build`, then commit and push.
No migration and no setting in Azure or Neon.

## What 1.8.0 contains (since 1.7.1)
- **Learn Seep:** a "Learn Seep" card on the home page opens a guided two-player game against the computer, with a short how-Seep-works card and a **Show me** button on every decision (bids too) that offers up to three options with reasons.
- **"Why can't I throw this?":** when Throw is greyed out because a card must capture, the screen says why and offers a "Select them" button. This is at every table, online and against the computer.
- **Already live before this version number, now part of it:** email-link confirmation of new accounts, unique display names, the turn line and the moved reactions button with its "To:" choice, and the smoke script's clearer messages.

## After deploying
- The landing page footer reads **v1.8.0**, and the "notice something off?" note includes `Version: 1.8.0`.
- Someone who already has the site open stays on the old version until they reload.
- **Leave `MIN_CLIENT_VERSION` unset.** Setting it to 1.8.0 would force everyone to refresh before they could play online, and nothing in this release needs that.
- Run the smoke script once: it should still pass (56 of 56 with the API key). Nothing in this release changes the server's behaviour.

## Checked
- The strict Angular compile is clean and the compiled output reads 1.8.0; lint is clean on both files; all 333 web tests pass (1,034 across the whole repository at the last full run).
- The guard test **fails** on `v1.8.0`, `1.8`, `1.8.0-beta` and `1.7.0` (below the new floor), and passes on `1.8.0`.
- A real browser loads the landing page: the footer shows **v1.8.0**, the Learn Seep card is there, and there are no page errors.
- The new `version.ts` differs from the 1.7.1 file I delivered by exactly one line.

## NOT checked
- Your actual repo (if your `version.ts` has changed since 1.7.1, apply only the one-line change), your root `package.json`, and the deployed site (I have not seen seep.quest show 1.8.0).
- The Learn Seep feature on a real phone, and whether its advice reads well to someone who plays: please look before you tell anyone about it (see the notes in `seep-learn-3-coach.zip`).
