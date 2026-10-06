# Phase 6, slice 6c (Learn Seep), part 3: the coach and the Learn page

The visible part of Learn Seep. A new **"Learn Seep"** card on the home page opens `/learn`: the ordinary two-player game against the computer, with a coach. On any decision, including the bid, a **Show me** button gives up to three good options, each with its reasons and a **Play this** button.

## Apply, in this order
This package builds on two earlier ones and will not work without them: **`seep-learn-1-throw-hint.zip`**, then **`seep-learn-2-move-lister.zip`**, then this one. (Its two-player files also carry everything delivered before them: the turn line, the reactions button, and so on.)
Copy the nine files (paths start with `projects/`), run `npm test && npm run lint && npm run build`, commit and push. **No migration, no setting, no server change** (the coach runs entirely in the browser; the engine file is in the API bundle too, but the API does not use it).

## What a player sees
- **A first-time card, "how Seep works in a minute":** the goal, card values, capture, throw, building and cementing houses, points and sweeps, bidding, and how to use the coach. "Got it" closes it; "Rules refresher" brings it back.
- **Show me**, when it is the player's turn (it is not shown while the computer is moving). Up to three suggestions, best first, for example:
  - *Capture 2 cards with your Jack of Diamonds. Wins 1 point (Ace of Spades).*
  - *Build a house of 11: your Queen of Diamonds with Ten of Hearts. You keep another card worth 11, so you can capture this house on a later turn. 3 cards worth 11 are out of your sight, so the opponent might be able to capture it. It is built from several sets at once, so it is cemented.*
  - *Throw the Queen of Clubs. This card could capture something right now, so throwing it gives that up.*
  - For a bid: *Bid 12. You hold 1 card worth 12. A good first move with this bid: capture 2 cards with your Queen of Clubs.*
- **Play this** plays exactly that move, the same way the buttons would. The suggestions vanish the moment the game moves on, however the move was made, so they can never be stale.
- The ordinary "2 Player Seep" page is **unchanged**: no coach panel, no Show me.

## How it works
- **The coach only sees what the player sees.** It is given the player's VIEW of the game (their hand, the floor, both piles of captured cards, the scores, only the NUMBER of the computer's cards), so it cannot look at the computer's hand. To judge a move the engine has to play it out, so the coach builds a stand-in state with placeholder cards for the hidden ones; a test proves that stand-in lists exactly the same legal moves as the real state, at every human turn of 60 simulated games.
- **Every claim is computed, not typed in.** Points, sweep bonuses (the engine decides: 50, 25 on the first move, none on the last card) and whether a house is cemented come from actually playing the move. "Cards out of your sight" is an exact count of the cards of a value that are not in your hand, on the floor (houses included) or in either pile.
- **Only the order is an opinion.** Ranking is by a few weights in one place, `ADVICE_WEIGHTS` in `advice.ts`.
- **It cannot freeze the page:** a time limit (150 ms for the optional moves) returns the simplest options first. With the 24-card hands a two-player game deals (the whole deck, 24 each), it takes between 26 ms on a small floor and about a third of a second on a crowded one on my machine.

## PLEASE REVIEW: the advice is my judgment, not the rules
These are the rules of thumb I encoded. I am not a Seep player, and **someone who plays well should read them and correct me**; each is a number in `ADVICE_WEIGHTS`:
1. **A capture always ranks above building or throwing.** Among captures, more points first; clearing the floor (a Seep) counts a lot.
2. **Building ranks above throwing**, unless it puts a lot of points into a house the opponent might capture. It likes a house you can see every card of, and a cemented one.
3. **Throw the cards worth least** (a spade or an ace costs points).
4. **Throwing a card that could have captured is last** (this only comes up on the opening move).
5. **A bid is judged by the best opening move it allows,** with a small bonus for holding more cards of that value.
The coach also never merges anything it should not: two interchangeable cards (the Six of Clubs and the Six of Hearts, both worth nothing) are one suggestion, not two.

## Verified
- **1,034 tests across the repo** (221 engine, 480 API, 333 web), none skipped; lint clean; strict compile clean.
- **The advisor's 24 engine tests and the sentences' 11 web tests,** including: the stand-in lists the same legal moves and bids as the real state over 60 simulated games; the facts equal what the real engine does over 1,500+ moves; the ranking behaves (more points first, a sweep first, a worthless card thrown before a spade, a capture above any build or throw, never two of the same advice, at most the number asked for, every one a legal move); and over 30 whole games every sentence the coach writes is a real sentence (no "undefined", no "NaN").
- **Real-browser journeys on a freshly rebuilt clean bundle:** the new Learn journey, **49 checks, run repeatedly,** plays 16 consecutive turns of a real game using ONLY the coach's suggestions (bids, captures, builds, throws), and the game accepts every one; it also checks the primer, the phone layout (360 px), that suggestions vanish even when the move is made another way, and that the ordinary page is untouched. The older journeys still pass: consent 33, email confirmation 26 and 3, two-player online 151 and four-player online 158 (those two vary with the deal).
- **Breakages caught:** 14 on the advisor (12 caught; the 2 that survive are guards made redundant by other checks), 3 on its quality rules (all caught), and 6 on the screen (all caught, after I closed one gap in my own test).

## NOT verified
- **How it looks on your phone** with your real stylesheet (I checked only that nothing scrolls sideways at 360 px).
- **Whether the advice is GOOD Seep advice.** The rules and numbers are right (the engine says so); the strategy is the part for you to judge, above.
- **Two-player against the computer only.** Four-player and online games have no coach.
- **Not explained yet:** if a player picks the wrong cards by hand, Capture is simply greyed out; the coach does not comment on moves the player chooses for themselves, only on what it suggests.

## Problems found on the way (all fixed)
- The coach could not be asked while BIDDING, because the screen's own "my turn" test leaves bidding out. The browser journey found it on its first run.
- The coach first recommended throwing a Queen that could capture 12 points, giving only "worth no points" as the reason; it now says the card could have captured, and ranks that throw last.
- "The house becomes a 11" (grammar) and duplicate suggestions (two interchangeable cards) were fixed.
- A 23-card hand looked like a bug and was not: a two-player game deals all 48 cards, 24 each.
- Two of my breakage runs left a deliberate bug behind (a time limit killed one; a mutated test bundle contaminated one baseline). I caught both, restored from a clean copy and confirmed everything.

## Version
This is a visible feature. If 1.7.1 is what is live, **1.8.0** is the natural number for this and the changes before it; say the word and I will prepare it.
