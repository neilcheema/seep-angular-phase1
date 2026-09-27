# Real-game dealing: bidding and the opening move happen from 4 cards, not a full hand

## What was different from the physical game
The digital game dealt everyone's full hand immediately at the start of a
hand — before bidding even happened. The bid value was already correctly
computed from just the bidder's first four cards (that part was already
right), but the *data* backing it wasn't: the bidder's entire hand was
already sitting in state, visible, and technically playable for the
opening move — a card from anywhere in their full hand could satisfy the
bid, not only one of the genuine first four. In the physical game, only
four cards are dealt to the bidder and four to the floor before bidding;
everyone else holds nothing yet, and the rest of the deck isn't dealt out
until right after the opening move.

## The corrected sequence (confirmed before implementing)
1. Shuffle. Deal four cards to the floor and four to the bidder. Every
   other seat's hand is empty.
2. Bidding happens from those four cards only.
3. The bidder's opening move (capture or build) is played from those same
   four cards, against the four-card floor.
4. Immediately after the opening move resolves, the rest of the deck is
   dealt: the bidder's hand is topped up to its full size, and every other
   seat receives their complete hand for the first time — all at once in
   four-player, not staggered.
5. The floor itself never receives more cards during this second deal —
   only hands do.

Confirmed explicitly before implementing: the final hand size per player
is unchanged from before, this only affects *when* cards become visible;
the floor doesn't grow during the second deal; and in four-player, all
three non-bidding seats get their hands simultaneously, not in turn order.

## What changed
- **`deck.ts`**: `dealInitialHands` (two-player) and `dealFourPlayerHands`
  (four-player) now split the deck into the floor, the bidder's first
  four, and everything else, instead of handing out full hands directly.
- **Both `GameState` types**: the old `bidderInitialCards` field (which
  only ever affected bid computation, not what was actually dealt) is
  replaced by `pendingDeal` — the cards dealt but held back from every
  hand until the opening move resolves.
- **`legalBids` / `legalFourPlayerBids`**: now read the bidder's actual
  hand directly (which is genuinely just four cards at this point) instead
  of a separately-tracked field.
- **`finishMove` in both engines**: when a move resolves while still in
  the opening-move phase, `pendingDeal` is automatically merged in — the
  acting player's hand (already reduced by whatever they just played) is
  topped up, and everyone else's held-back hand becomes visible, all in
  the same state transition. Ordinary (non-opening) moves are completely
  unaffected — `pendingDeal` is just carried through untouched once it's
  null.

## What did NOT need to change
The UI required zero changes. Both game pages already just render however
many cards happen to be in `state.hands` — with a genuinely 4-card hand
during bidding, the human correctly sees only 4 cards, and opponent hands
correctly render as empty (`OpponentHandComponent` already handles a
count of 0 cleanly) until the second deal happens. The bid-choice UI
already called into `legalBidsFor`, which forwards straight to the fixed
engine functions. This turned out to be a fully contained engine-layer
fix.

## Test changes
Every test file's `makeState` helper referenced the removed
`bidderInitialCards` field and needed updating to set `pendingDeal`
instead (usually `null`, since most tests construct mid-hand states where
the second deal has already happened). A few tests explicitly asserted
"full hand immediately after dealing" and were rewritten to assert the
new staged reality (4 cards dealt, the rest sitting in `pendingDeal`). Two
new tests directly verify the merge itself: the bidder's hand is topped up
and everyone else receives their full hand the moment the opening move
resolves, with `pendingDeal` cleared to null afterward.

## Verified here
128/128 tests passing (5 new), full `tsc` type-check clean, plus the
stricter `--noUnusedLocals --noUnusedParameters` pass — clean. Both
randomized fuzz tests re-run 5 times back to back with no flakiness,
which is a meaningful signal here specifically: they call the same public
engine functions with no awareness of the staging mechanic at all, so
their passing confirms the change is transparent to every consumer of the
engine, not just hand-picked test scenarios.

## How to apply
Copy these eight files into your repo at the paths shown, then:

    npm test
    npm run lint
    npm run build
