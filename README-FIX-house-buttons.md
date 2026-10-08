# Fix: the Add / break house and Build house buttons no longer light up for moves the rules refuse

## What you reported
You had built a house of 13 and held only one King. Selecting the King and the house enabled **both** Capture and Add / break house. You said only Capture should be possible, for you and for the computer alike.

## What was wrong (and what was already right)
- **The rule was already right.** The engine has always refused to cement a house with your last card of its value ("You need another card worth 13 left in hand to cement this house"), because you would have nothing left to capture it with. The computer players cannot do it either, and cannot throw that King, because a card that can capture must capture. I proved that with direct tests for a two-player and a four-player computer (below).
- **The screen was the problem.** The Add / break house button was lit by a rough guess ("a card and one house are selected"); the engine only refused when you pressed it. The Build house button had the same weakness, and did not know the whole-sets rule from the last release (for instance, it lit for 10 + 8 as a "house of 9", which the engine refuses).

## What changed
The buttons now **ask the rules themselves**. A screen only holds the player's view of the game, so the engine gains four small helpers that build a stand-in state from that view (your own hand is real, every hidden card is a placeholder) and try the move on it, returning the engine's own sentence if it is refused. Both game screens use them:
- **Add / break house** is enabled only if the engine would accept the move. With one King, only Capture is enabled (Throw stays greyed, as before).
- **Build house** is enabled only if the engine would accept it.
- **When Add / break house is not possible, the screen says why**, in the engine's words: "Add / break house isn't possible here: You need another card worth 13 left in hand to cement this house." With a second King, adding one is allowed again and no message is shown.

## Apply
Seven files (paths start with `projects/`): in the engine `seep-engine/src/lib/preview.ts`, `seep-engine/src/public-api.ts` (one added line) and `seep-engine/src/lib/__tests__/preview.test.ts`; on the website `seep-web/src/app/pages/two-player/two-player.component.ts` and `.html`, `pages/four-player/four-player.component.ts` and `.html`, and `core/__tests__/button-rules.test.ts`. The two screens' files also carry the pop-up fix, so this package includes it. Then `npm test && npm run lint && npm run build`, commit and push. **A website change only: no migration, no setting, no API redeploy** (the server does not use the new helpers). It ships in version 1.9.4 (see `seep-version-1.9.4.zip`).

## Verified
- **Your bug, reproduced and fixed, in a real browser, on both game screens and at two screen sizes** (a desktop and a 390-pixel phone): with a house of 13 and a single King selected, Capture is enabled and Add / break house and Throw are disabled; the reason is shown; with a second King, Add / break house is enabled and no reason is shown; Build is disabled for 10 + 8 and enabled for 4 + 5. On the OLD screens the same test fails exactly as you described (Add / break house enabled). 32 checks.
- **The helpers always agree with the real engine:** across simulated two-player and four-player games, for every house, card and set of loose cards a player could pick (and every house value to build), the helper says "allowed" exactly when the real engine accepts the move: thousands of comparisons, with plenty of both answers.
- **The computer cannot do it:** with a house of 13 and a single King, a two-player computer and a four-player computer seat each choose a move the engine accepts, never adding the King to the house and never throwing it; and every legal move that uses that King is a capture.
- **Breakages:** five in the engine helpers and three in the screens, all caught. A 6-test guard fails on the old screens.
- **1,152 tests across the repo** (480 API, 266 engine, 406 web), none skipped; lint and strict compile clean; every browser journey still passes.

## NOT verified
- On your phone. My test uses the same checks a player would trigger (selecting a card and a house) but with a stand-in for the game session, on a stylesheet copy dated 28 September.
- The wording is the engine's own; some of its sentences are a little technical (for example "Those cards cannot be split into sets that each add up to 9").
