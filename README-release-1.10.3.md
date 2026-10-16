# Release 1.10.3: the "something felt off" email now carries the table

**This release replaces 1.10.2 (and everything back to 1.9.6): apply only this one.** It contains everything they did. Please delete the older zips.

## What you asked for
Put the player's hand cards in the log, so that when something goes wrong the player can just email the report instead of also sending screenshots.

## What the email now contains
Everything it carried before (what the player wrote, the game, the version, the phase and whose turn, and the latest moves), **plus a "Table now" section**:
- **The player's whole hand**, with the number of cards.
- **What was selected** at the moment the button was pressed (the hand card and the floor cards or piles).
- **The floor**: every pile with its value, who owns it, whether it is cemented and **the cards inside it**, then the loose cards.
- **Counts and scores** (the opponent's cards in hand, or each seat's in four-player, the match score, who bid, how far through the hand), and the rules version the game was using.

For your fourth-house position the email now reads like this (cards are short codes: 4S is the 4 of Spades, 10D the 10 of Diamonds, S/H/D/C for the suits):
```
Table now:
Your hand (6): 3C 7H 4S 5H 4H 10D
Selected: 4S; on the floor: 6C
Floor: Pile-11 (Opponent's, cemented: JH 8H 3S), Pile-12 (Opponent's, cemented: QC 5D 7D), Pile-13 (Yours, cemented: KC 10H 3H), 6C
Opponent holds 6 cards. Score: you 53, Opponent 197. Bidder: Opponent. Played this hand: 22 of 48.
```
Both the two-player and the four-player screens. The panel now also says, in one line, what the email contains ("Sending opens an email that includes your cards, the table and the last few moves, so I can see what you saw"), because the email now includes the player's own cards.

## Details worth knowing
- **Short card codes, not suit symbols**, because the email is a link and each symbol would take nine characters of it.
- **The newest move's "Floor:" line is left out**, because the table section already gives the floor as it is now; that saves room for more moves. Older moves keep theirs.
- **The 1,500-character limit still applies, and now really holds.** The old code added its "N earlier moves omitted" line *after* trimming, so a long log could run up to about 50 characters over. I found this when my own test measured 1,521. The line is now counted.
- **If a mail program shortens a long link**, it cuts from the end, so the table (near the top) survives and only the oldest moves are lost. As a link the email is about 2,100 to 2,200 characters, as before; iPhone Mail and Gmail handle that, but some desktop Outlook versions cut links at about 2,000.
- This release does **not** add the "why is Build grey" line under the buttons that I offered earlier; you did not ask for it.

## Apply
**This is a website change only** (the engine and the API are not touched). 27 files (paths start with `projects/`): for this change `seep-web/src/app/core/table-snapshot.ts` (new), the two game screens (`two-player` and `four-player`, each `.ts` and `.html`), the new tests `core/__tests__/table-snapshot.test.ts` and `report-email-wiring.test.ts`, and `version.ts` (**1.10.3**) with its guard test; the rest are the earlier changes of 1.9.6 to 1.10.2. No migration, no setting, and `styles.css` is not touched.
```
cd ~/Desktop/seep-angular-phase1
unzip -o ~/Downloads/seep-release-1.10.3.zip
bash verify-release.sh
npm test && npm run lint && npm run build
```
`verify-release.sh` should end with "Release 1.10.3 is complete". The tests should report **1,281** passing in total (engine 316, API 480, website 485). `release-1.10.3.sha256` and `verify-release.sh` are only for checking; do not commit them.

## After deploying
Open a game, select a hand card and a floor card, tap "Notice something that doesn't match the rules you know?", type a word, and press **Send note**. The email that opens should contain the "Table now" section with your whole hand.

## Verified
- **In a real browser (28 checks, passing twice, both screens):** it recreates your position (three piles, a loose 6 of Clubs, the 4 of Spades), **taps the real cards**, opens the real panel by tapping the real button, types into the real text box, and reads the email body. The body has the player's own text, the version and rules version, the whole hand, the selection, every pile with its owner and cards, the counts and scores, the table before the log, and the log newest first and cut from the old end. The panel shows the new line. The body fits the limit in both games.
- **Tests (27 new):** the wording of hand, floor and selection, the body builder (newest first, the omitted count right, the newest floor left out, an empty log, a long description), and a check over 0 to 60 moves of five different line lengths that the limit is never exceeded. **Nine deliberate breakages** all caught (the hand, the selection or the floor missing, the screen building its own body again, the panel line missing in either screen, the log reversed, the pile contents dropped, the limit not applied).
- **Whole suites:** engine 316 (unchanged), API 480, website 485. Strict compile and the Angular and TypeScript lint rules are clean on all 27 files.

## NOT verified
- **Pressing "Send note" for real.** A test browser cannot open a mail program, so I tested the body the button builds, not the mail program receiving it. Please try it once on your phone.
- A real phone, and the deployed site. The older whole-app browser tests were lost when my working environment restarted.
