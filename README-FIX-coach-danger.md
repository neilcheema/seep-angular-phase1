# Learn coach: it now judges what the opponent can do to you, and always shows the safe throw

## What you reported
In Learn mode "Show me" offered three builds, every one of which the opponent could answer, and no throw at all. You said throwing is the safe move and should be suggested.

## What was actually wrong
1. **It guessed when it could have known.** It said "1 card worth 10 is out of your sight, so the opponent *might* be able to capture it". But in a two-player game the whole deck is dealt, so once play has started **every card you cannot see is in the opponent's hand**. Counting gives their exact hand. (Checked against real games: in ordinary play the count matched the computer's real hand in **2,138 of 2,138 turns**; before the first move, with cards still undealt, it cannot, and the coach still says "might" there.)
2. **It ignored Seeps entirely.** In your second screenshot only the Jack of Hearts was on the floor. Two of the three suggestions kept the Jack there, so the opponent could take the house but not clear the floor. The third, the Two and the Jack as a house of 13, would have left **the house as the only thing on the floor**: an opponent holding a King takes it and clears the floor, a Seep worth 50 points.
3. **Nothing in the ranking measured danger,** so a build always beat a throw whatever the opponent held.

## What the coach does now (in ordinary play)
For each possible move it works out what the opponent could take from the floor afterwards, using the hand it can deduce:
- whether they can take the card or house you just played, and **whether they hold the card to do it**;
- the most points one of their cards could win from the floor;
- **whether one card of theirs could clear the whole floor (a Seep)**. It also knows that on the last card of the hand a Seep earns no bonus, but whoever captures last is given everything still on the floor, and it measures that too.
Moves that hand the opponent points or a Seep are marked down heavily (a Seep most of all); a house the opponent certainly can take is marked down too. And **when there is nothing to capture, the list always includes the safest throw** (one that cannot win the opponent a point or clear the floor), even where a safe build would otherwise outrank it. A throw that would make a Seep possible (for example a Two onto a lone Jack when the opponent holds a King: 2 + 11 = 13) is not offered as safe.
The wording says what is true: *"The opponent holds a card worth 10, so they can take this house on their next turn"*, *"Careful: the opponent holds a card worth 13, and after this it would clear the whole floor: a Seep, worth 50 points to them"*, *"Safe: nothing the opponent holds can win a point or clear the floor after this"*, and *"Nothing the opponent holds can take this house"* when that is so.

## Is this cheating?
No: the coach is still given only the player's view, and it works the opponent's hand out the way a careful player does, by counting the cards in plain sight (your hand, the floor, and both piles of captured cards).

## Apply
Five files (paths start with `projects/`), replacing the versions from `seep-learn-3-coach.zip`, which must already be applied: `seep-engine/src/lib/advice.ts` and its two test files, and `seep-web/src/app/core/advice-text.ts` and its test. Then `npm test && npm run lint && npm run build`, commit and push. **No migration, no setting, no server change** (the coach runs in the browser). If 1.8.0 is not live yet, ship it with this; if it is, say so and I will prepare 1.8.1.

## Verified
- **1,114 tests across the repo** (253 engine, 480 API, 381 web), none skipped; lint and strict compile clean.
- **The danger measurement is checked against the real engine:** for every legal move at every turn of simulated games (over a thousand moves), the points and the Seep the coach predicts the opponent could win are compared with what actually happens when the real opponent hand plays every capture it has. That comparison found a real flaw in my first version (the last-card rule above), now fixed.
- **Your position is a test:** only a Jack on the floor, the opponent holding a King and a Ten. The Two-and-Jack house is flagged as a Seep and kept out of the suggestions; a safe throw leads the list; the two builds that keep the Jack are shown as capturable but not Seeps; throwing the Two onto the Jack is flagged as a Seep risk; and with the King moved to the other side, the same house is safe and is recommended.
- **Fourteen deliberate breakages of the new logic, all caught** (two needed better tests of mine first, including a position I found by searching real games).
- **A real-browser journey on a rebuilt bundle:** the Learn journey, 121 checks. In ordinary play no suggestion guesses ("might"), every house says plainly whether the opponent can take it, and every throw says whether it is safe, costly or could hand over a Seep.
- **Speed is unchanged** on a 24-card hand: 28 to 355 ms (it was 26 to 329).

## NOT verified
- **On your phone, and the deployed site.**
- **Whether the advice is good Seep.** "Safe" means the opponent cannot win a point or clear the floor on their next turn. The coach looks one turn ahead only, does not predict what the computer will actually choose (it may leave a capture alone), and does not weigh what you could do next. Please judge the suggestions against how you play.
- **The opening move** is unchanged: cards are still undealt there, so it keeps the cautious wording and the old reasoning.

## Along the way
- A test of mine used a position where my own thrown Two made 12 with a Ten, so the opponent's Queen really could capture: the coach was right and my test was wrong.
- My first version of the end-of-hand rule was wrong and was found by comparing with the real engine, as above.
