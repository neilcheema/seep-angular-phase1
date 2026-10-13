# Release 1.10.0: point cards shown at the end of a hand

**This release replaces 1.9.9, 1.9.8, 1.9.7 and 1.9.6: apply only this one** (it contains everything they did, so it works whether or not you applied any of them). Please delete the older zips so they cannot be applied by mistake.

## What you asked for
When a hand finishes, show the point cards each player captured on the board, where the hand cards were, so that players can see what they won. When the next play is selected, they go.

## What it does
- **When:** as soon as a hand is over, and again after the last hand of a match. The moment the next hand is dealt (Deal next hand) or a new game starts, they disappear by themselves and the normal hands come back.
- **Where, in the two positions where the (now empty) hands were:**
  - two-player: the opponent's point cards at the top and **your** point cards at the bottom;
  - four-player: the cards are pooled by team in this game, so the other team's point cards at the top (where the partner's hand was) and **your team's** at the bottom.
- **What:** only the cards that score points (the spades, the other aces and the Ten of Diamonds), the ones worth most first (the King of Spades leads), face up and smaller so they fit a phone. Under each set is one line, for example "40 card points = 40 this hand", "60 card points + 50 for the Seep = 110 this hand", or "5 card points (under 9, so they score nothing) = 0 this hand". A side that captured nothing that scores says "No point cards this hand."
- The figures come from the game's own totals for the hand, so what you see always agrees with the score.

## Apply
**This feature is a website change only.** It needs nothing new from the server, because the game already sends each side's captured cards and totals. But this release also contains the engine changes of 1.9.6 to 1.9.9 (the choice of combination on every play, and the last-card shortcut for a house you made), which **do** need the API. So: **if you have not yet deployed those to the API, redeploy both the website and the API; if you already have, redeploying the website is enough.**

22 files (paths start with `projects/`). New: `seep-web/src/app/core/point-cards.ts`, `seep-web/src/app/components/point-cards/point-cards.component.ts` and the tests `core/__tests__/point-cards.test.ts` and `point-cards-wiring.test.ts`. Changed for this feature: the two game screens (`two-player` and `four-player`, each `.ts` and `.html`) and the website `version.ts` (**1.10.0**) with its guard test. The remaining files are the earlier engine and screen changes of 1.9.6 to 1.9.9. No migration, no setting.
```
cd ~/Desktop/seep-angular-phase1
unzip -o ~/Downloads/seep-release-1.10.0.zip
bash verify-release.sh
npm test && npm run lint && npm run build
```
`verify-release.sh` should end with "Release 1.10.0 is complete". The tests should report **1,257** passing in total (engine 316, API 480, website 461). `release-1.10.0.sha256` and `verify-release.sh` are only for checking; do not commit them.

## After deploying
Finish a hand (or a whole match) in a two-player game and in a four-player game: the point cards should appear at the top and bottom, and disappear when you press Deal next hand or Play again. Check them on your phone, because the screenshots I made use a stylesheet copy dated 28 September.

## Verified
- **In a real browser (52 checks, passing twice, both screens, desktop and 390 px phone):** after a hand, two point-card areas with the right titles; exactly the cards that score are shown (and not the ones that do not); the King of Spades first; the summaries right, including a Seep bonus, "under 9", and "none"; the empty hand displays replaced; nothing running off the side of a phone; the match-over case; and once a new hand is dealt there are no point cards and the player's hand is back.
- **I looked at the screenshots** of both games on a phone-sized screen (they are attached): the opponent's cards at the top, the floor, "Hand complete" with Deal next hand, and your cards at the bottom.
- **Tests (14 new):** the helper (which cards, the order, the summary sentences, and that what is shown is worth exactly what the game scores for all the captured cards) and a guard on both screens. **Seven deliberate breakages** all caught (every card shown, wrong order, no under-9 note, shown during play, tappable, one area missing, and your area showing the opponent's cards, the last one found by the browser test).
- **Whole suites:** engine 316, API 480, website 461. Strict compile and the Angular and TypeScript lint rules are clean on all 22 files.

## NOT verified
- A real phone, and the deployed site or server. The test positions are made-up hands presented to the real screens, not a game played to the end.
- Online games: they use the same screens and the same view, so they should behave the same, but I have not run one.
- The older whole-app browser tests were lost when my working environment restarted.
