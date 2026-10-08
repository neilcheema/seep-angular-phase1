# Fix: on the opening move, build the bid house with any ONE combination (rules version 1.2.0)

## What you reported
The bid was 11, the floor was A♣, 9♦, 9♠, 8♣, and you held 6♥, 2♣, J♣, 2♥. You could not build the house of 11 with the 2♥ and the 9♠: the Build button stayed grey.

## What was wrong
Your 2 can make 11 with the 9♦, with the 9♠, or with the A♣ + 8♣. These are three alternatives. The engine looked for "the best set of groups", and when alternatives tied it silently forced the **first one it found** (the 9♦) and refused the others. The same code made the Jack refuse a 9♠ worth 9 points and take a 9♦ worth none.

## The rule now (engine rules version 1.2.0), on the OPENING MOVE only
- **Any ONE combination** may be used to make a group. In your position, the 2 with either 9, or with the Ace and the Eight: all six builds (two 2s, three ways) are now accepted.
- **Nothing may be left out.** Every separate group that makes the bid house must still be taken. With a 2, a 9 and a 9 on the floor and also a 5 and a 6, you may use either 9, but you must take the 5 and the 6 as well (22 = two sets of 11, cemented). Building 4 + 9 and leaving two Kings that could have joined a house of 13 is still refused.
- **Everything else is unchanged:** the house must be for the bid, you must keep a card to capture it with, and the cards must split into whole sets.
- **From the second play on, nothing changes:** the engine's own pick among equivalents is still required, and captures work as before. (If you want captures and later builds to let the player choose among equivalents too, say so: it is a further change.)

The "How to play" text on both game screens says this.

## Apply
This is a **rules change in the engine, which the server also runs, so redeploy the API as well as the website.** Files (paths start with `projects/`): `seep-engine/src/lib/gameEngine.ts`, `fourPlayerEngine.ts`, `floor.ts`, `moves.ts`, `version.ts` (rules version 1.2.0), and the new test `seep-engine/src/lib/__tests__/openingBuild.test.ts`; on the website `seep-web/src/app/pages/two-player/two-player.component.html` and `four-player/four-player.component.html` (the rules sentence) and `core/__tests__/rules-text.test.ts`. The two screen files also carry the pop-up fix and the house-buttons change, so apply this AFTER `seep-fix-house-buttons`, or simply use `seep-release-1.9.4-complete.zip`, which already includes everything. No migration, no setting. A game already stamped with rules 1.1.0 simply plays under the new rule from its next opening move on.

## Verified
- **Your position, reproduced first:** on the old engine a browser test fails exactly as in your screenshot (the 2 with the 9 of Spades cannot be built); on the new engine it passes on both game screens at two sizes (64 checks in all), including the two-group position, the refused 2 + 9 + 9, and the unchanged rule one play later.
- **17 engine tests:** the six builds in your position; nothing left out (two Kings; the 5 and the 6); the rest of the opening rules; the later-play rule unchanged; four-player; the screens' helper agreeing with the engine; and the move lister offering exactly the builds the engine accepts over 118 real opening positions. 9 of them fail on the old engine.
- **Five breakages**, all caught (the lister, the later-play rule, "nothing left out" in each game type, and the original glitch).
- The two older tests for "nothing left out" are unchanged and still pass.

## NOT verified
- On a real phone, and against the deployed server.
- The computer's own opening move is unchanged (it takes the first complete set it finds); it has not been taught to choose among alternatives.
