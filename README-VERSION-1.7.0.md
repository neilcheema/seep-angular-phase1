# App version 1.7.0

One step up from 1.6.0. The two files in this zip change nothing but the version number and its guard test; the features below are in the packages you have already applied.

## Apply
1. Copy the two files over your repo:
   - `projects/seep-web/src/app/version.ts`: the same file as the 1.6.0 one with **one line changed** (`APP_VERSION = '1.7.0'`). If you have edited it since, keep your edits and change only the number.
   - `projects/seep-web/src/app/core/__tests__/version.test.ts`: the same guard as before, with its floor raised: the version must be three plain numbers and must **not be older than 1.6.0** (it was 1.5.0).
2. Optional, if you keep it in step: set `"version": "1.7.0"` in your root `package.json` (the spec notes it has stayed at 0.0.0; I cannot see your file).
3. `npm test && npm run lint && npm run build`, then commit and push.

## What 1.7.0 contains (everything since the 1.6.0 package)
- **Analytics only with your permission.** A banner offers Accept or Decline (equal prominence) before Microsoft Clarity runs at all; a "Privacy choices" link changes your mind; sign-in and account screens are marked so Clarity hides their text.
  The Privacy Policy was rewritten to match (it names you as operator, lists Clarity and its cookies, and adds the activity records the game keeps).
- **A clear "whose turn it is" line** on online tables ("▶ Your turn" / "Carol's turn"), with a ▶ marker beside the player on the move, and the 💬 reactions button moved into that bar so it can no longer cover the cards.
- **Reactions can be addressed to one player** at a four-player table ("Alice → Dave: 👍 Nice move!"); everyone at the table still sees it.
- (The hand-by-hand **results screen** was already live with 1.6.0.)

## Before you rely on this number
- **The version number does not deploy anything by itself.** It only labels what is live. Make sure those three packages are applied first: the analytics consent change (with your edit to `app.component.ts` and the Clarity snippet removed), the turn bar, and the addressed reactions.
- **Addressed reactions need migration `009_phase5_reaction_recipient.sql` run in Neon BEFORE the API is deployed**; the 54-check smoke script (not more than twice a minute) is what shows it took effect.
- **Leave `MIN_CLIENT_VERSION` unset.** This release only adds fields; apps on older versions keep working. Setting it to 1.7.0 would force everyone to refresh before they could play online.

## After deploying
- The landing page footer reads **v1.7.0**, and the "notice something off?" note includes `Version: 1.7.0`.
- Someone who already has the site open stays on the old version until they reload.

## Checked
- The strict Angular compile is clean and the compiled output reads 1.7.0; the lint is clean on both files; all 296 web tests pass.
- The guard test **fails** on `v1.7.0`, `1.7`, `1.7.0-beta` and `1.5.9` (below the new floor), and passes on `1.7.0`.
- A real browser loads the landing page and the footer shows **v1.7.0**, with no page errors.
- The new `version.ts` differs from the 1.6.0 file I delivered by exactly one line.

## NOT checked
- Your actual repo (if your `version.ts` has changed since 1.6.0, apply only the one-line change), your root `package.json`, and the deployed site (I have not seen seep.quest show 1.7.0).
- I have not looked at whether all three packages above are live; that is for you to confirm with the smoke script and a glance at the site.
