# App version 1.6.0

One step up from 1.5.0. This is a **website-only** change: no database migration, no API change.

## Apply
1. Copy the two files in this zip over your repo:
   - `projects/seep-web/src/app/version.ts`: the same file as the 1.5.0 one with **one line changed** (`APP_VERSION = '1.6.0'`). If you have edited that
     file since, keep your edits and just change the number.
   - `projects/seep-web/src/app/core/__tests__/version.test.ts`: new. A small guard: the version must be three plain numbers (like `1.6.0`), must not be
     older than 1.5.0, and the feedback address must look like an email address. The server compares versions number by number and silently treats anything
     it cannot read as 0, so a typo like `v1.6` or `1.6` would not fail loudly; this makes it fail.
2. Optional, if you keep it in step: set `"version": "1.6.0"` in your root `package.json`. The comment in `version.ts` asks for this; the spec notes that the
   root file has been `0.0.0` and never maintained. I cannot see your `package.json`, so I have not touched it.
3. `npm test && npm run lint && npm run build`, then commit and push (that deploys the website).

## What 1.6.0 contains (everything since the 1.5.0 bump, which was at the end of the turn-clock work)
- **Four-player online tables:** play with three other people, partners across the table.
- **Display names:** chosen before you join or start an online table, shown in the lobby, the turn clock and, new in this version, on the game boards.
- **Account deletion** from the lobby, and the Privacy Policy and Terms of Use pages.
- **Leave** a table that is still waiting for players.
- **Rematch** button at the end of a two-player match.
- **Quick reactions** (the 💬 button): six preset reactions, with a mute switch.
- Behind the scenes: limits on starting tables, moves and wrong table codes (you only notice them if you hit one), a daily cleanup of idle tables, and a
  health check.

## Before you deploy the website
- The API with migrations **005, 006, 007 and 008** must already be live, because the rematch and reaction buttons call routes that older APIs do not have.
  **Your latest production smoke run (51 of 51) shows that it is.**
- **Leave `MIN_CLIENT_VERSION` unset.** It is the API's switch for refusing apps older than a given number, and it is unset by default. The API changes in this
  release only add fields and routes, so apps on 1.5.0 and below keep working. Only set it if a future change would break older apps. If you ever set it to
  `1.6.0`, everyone has to refresh before they can play online.

## After deploying
- The landing page footer reads **v1.6.0**, and the "notice something off?" note includes `Version: 1.6.0`.
- Someone who already has the site open stays on the old version until they reload the page.

## Checked
- The strict Angular compile is clean and the compiled output reads 1.6.0; the web tests pass (234, three of them new); lint is clean on the new files.
- The guard test **fails** on `v1.6.0`, `1.6`, `1.6.0-beta` and `1.4.9`, and passes on `1.6.0`.
- A real browser loads the landing page and the footer shows **v1.6.0**, with no page errors.
- The new `version.ts` differs from the 1.5.0 file I delivered by exactly one line.

## NOT checked
- Your actual repo. My working copy of the code was out of date (its `version.ts` still said 1.2.0), so I built this from the 1.5.0 file I delivered earlier.
  If your `version.ts` has changed since, apply only the one-line change.
- Your root `package.json`, and the deployed site (I have not seen it show 1.6.0 on seep.quest).
