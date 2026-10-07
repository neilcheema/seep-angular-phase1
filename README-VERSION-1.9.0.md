# App version 1.9.0

This replaces `seep-version-1.8.0.zip`: **do not apply the 1.8.0 package**; go straight to 1.9.0. The two files in this zip change only the version number and its guard test. The release itself is the six packages below, so apply all of them (in this order, so a later file always replaces an earlier one that it builds on).

## Apply
1. `seep-learn-1-throw-hint.zip`: "Why can't I throw this?"
2. `seep-learn-2-move-lister.zip`: the engine's list of legal moves (invisible)
3. `seep-learn-3-coach.zip`: the Learn Seep page and coach
4. `seep-fix-house-sets.zip`: **rules fix: a house must be made of whole sets** (engine rules version 1.1.0; the move log now names the cards)
5. `seep-6d-iphone-web-app.zip`: Seep as an iPhone web app
6. `seep-fix-coach-danger.zip`: the coach now judges what the opponent can do to you
7. **This zip:** `projects/seep-web/src/app/version.ts` (the same file as the 1.7.1 and 1.8.0 ones with **one line changed**: `APP_VERSION = '1.9.0'`; if you have edited it, keep your edits and change only the number) and `projects/seep-web/src/app/core/__tests__/version.test.ts` (the guard: three plain numbers, and **not older than 1.8.0**; it was 1.7.1).
Optional, if you keep it in step: `"version": "1.9.0"` in your root `package.json`.
Then `npm test && npm run lint && npm run build`, commit and push. **No migration and no setting** in Azure or Neon. Anything you have already applied can be skipped, but check that the files you have match the latest zip they appear in (several screens were touched by more than one package).

## What 1.9.0 contains (since 1.7.1)
- **Learn Seep:** a "Learn Seep" card on the home page opens a guided game against the computer, with a short how-Seep-works card and a **Show me** button that offers up to three options with reasons. The coach counts the cards in plain sight to know exactly what the opponent holds, warns about **Seeps**, and always shows the safest throw when nothing can be captured.
- **A rules correction:** a house, when built or cemented, must now be made of **whole sets** of its value (9, or 4 + 5, or 3 + 6). Before, any total that divided evenly was accepted, so Jack + Queen + King was wrongly allowed as a cemented "house of 9". Both the two-player and four-player engines are fixed.
- **The move log names its cards** ("built a house using J of Clubs plus Q of Hearts and K of Clubs") instead of counting them.
- **"Why can't I throw this?":** when Throw is greyed out because a card must capture, the screen says why and offers "Select them". At every table, online and against the computer.
- **Seep on an iPhone:** it can be added to the Home Screen and opens full screen, with an icon, a friendly offline page, and a hint on the home page for iPhone and iPad browsers.
- **Already live before this number:** email-link confirmation, unique display names, the turn line, and the smoke script's clearer messages.

## Before and after deploying
- **The API must be redeployed with the website** (your push does both), because the rules fix lives in the engine that the server runs. Until then an online game would still accept the old, wrong house. Games already under way are left alone: only moves made after the deploy are checked.
- **Leave `MIN_CLIENT_VERSION` unset.** Setting it to 1.9.0 would force everyone to refresh before they could play online, and nothing here needs that: an old copy of the site that tries an invalid house is simply refused by the server with a clear message.
- The landing page footer should read **v1.9.0**, and the "notice something off?" note includes `Version: 1.9.0`. Someone who already has the site open stays on the old version until they reload (installed Home Screen copies refresh themselves after a long sleep, but never mid-game).
- Run the smoke script once (**56 of 56**): nothing in this release changes the server's behaviour except the house rule.
- **Then try the iPhone checklist** in the README of `seep-6d-iphone-web-app.zip` (start by removing your old test icon from the Home Screen). That feature has not been seen on a real iPhone yet.

## Checked
- The strict compile is clean and the compiled output reads 1.9.0; lint is clean; **1,114 tests pass across the whole repository** (253 engine, 480 API, 381 web), none skipped.
- The guard test **fails** on `v1.9.0`, `1.9`, `1.9.0-beta` and `1.7.9` (below the new floor), and passes on `1.9.0`.
- A real browser loads the landing page on a freshly built bundle: the footer shows **v1.9.0**, the Learn Seep card is there, and there are no page errors.
- The new `version.ts` differs from the 1.8.0 file I delivered by exactly one line.
- Each of the six packages was verified on its own, with the real-browser journeys passing at the time (Learn 121, iPhone app 28, two-player online 143, four-player online 162, consent 33, email confirmation 26 and 3), and deliberately breaking each piece to confirm its tests notice.

## NOT checked
- Your actual repo (if `version.ts` has changed since 1.8.0, apply only the one-line change), your root `package.json`, and the deployed site: I have not seen seep.quest show 1.9.0.
- Everything on a real phone: the Learn page's layout and wording, and the iPhone web app.
- That the six packages go together cleanly **in your repo**: I tested them together in my working copy, not in yours.
