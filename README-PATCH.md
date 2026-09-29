# Phase 1: server-ready engine (5 of 6 pieces)

Everything in this patch is additive or a same-behavior change — nothing
here is visible to a player, and nothing changes what seep.quest does
today. 164 tests passing (up from 146), full `tsc` type-check clean
including the stricter `--noUnusedLocals --noUnusedParameters` pass, and
the full suite re-run 5 times back to back with no flakiness.

## What's in this patch

### 1. `applyMove` / `applyFourPlayerMove` — one entry point per engine
A new `Intent` type (`FourPlayerIntent` in the four-player engine) covers
bid/capture/build/modify/throw as one JSON-serializable shape, and
`applyMove(state, playerId, intent)` dispatches to the existing
`placeBid`/`playCapture`/`playBuildHouse`/`playModifyHouse`/`playThrow`
functions. This is what a future server would actually call — one
function, one shape — instead of a caller needing to know which of five
differently-shaped functions to reach for. It adds no new validation of
its own; every one of those functions already throws on anything illegal.
12 new tests confirm each intent type produces an identical result to
calling the underlying function directly, plus a JSON round-trip check.

### 2. `viewFor` / `viewForSeat` — the actual redaction functions
This is the piece that matters most for hiding information from a future
client. Given a `GameState` and a viewing player, it returns a `GameView`
with:
- The other player's hand (or, in four-player, every other seat's hand)
  reduced to a card count, never the actual cards.
- `pendingDeal` (cards dealt but not yet given to any visible hand) gone
  entirely — not even as a count, since a client never legitimately needs
  to know how many cards are waiting to be dealt to anyone.
- `nextItemId` dropped too, as pure internal bookkeeping with no meaning
  to a client.

Verified with a test that plays out many full randomized matches and
checks, after every single move, that no card from a hidden hand or the
pending-deal pool appears anywhere in the view — for both viewers, at
every phase. I deliberately broke the redaction first to confirm this
test actually catches a real leak (it did, immediately, with a clear
message naming exactly which card leaked) before trusting it.

### 3. Seedable, cryptographically random shuffle
`shuffleDeck(deck, seed?)` — omit the seed and it shuffles with the Web
Crypto API instead of `Math.random()`, which was never suitable for
anything where unpredictability actually matters. Pass a seed and you get
the exact same deal every time, including misdeal retries staying
deterministic — this is what "replay this exact reported game" or a
reproducible test needs. Threaded through `dealHand`/`startMatch`/
`dealNextHand` and their four-player equivalents.

### 4. Engine version stamp
A new `ENGINE_VERSION` constant (`version.ts`), stamped onto every game as
`engineVersion` at creation. This is what will let an in-flight game
finish under the rules it started with, once a rule is corrected while
games are already running on a server.

### 5. The AI already only reasons from what it can see — now proven, not just believed
Rather than rewiring the live AI to take a `GameView` instead of a full
`GameState` (a bigger, riskier change to code already shipping), I wrote
a test that swaps in a completely different, unrelated set of cards for
every hand a given AI can't see, and confirms its decision doesn't
change. If a decision ever depended on a hidden hand's contents, it would
depend on which of two unrelated card sets got substituted there — which
is exactly what a redacted view being all the AI has actually amounts to.

## The honest part: this test failed my own verification twice before I trusted it

I don't want to undersell this, because it's a good example of exactly
the kind of mistake a "does this test actually work" check is supposed to
catch, and I want you to have the full picture rather than just a
passing test file.

**First failure**: my first draft of the blindness test built its
game-in-progress state by hand — filtering the floor, filtering hands —
instead of calling the real engine functions. That silently skipped the
step that merges `pendingDeal` into a hand after the opening move, so the
"hidden" hand I was swapping was empty for the entire test, in both the
real and decoy case. An elaborate no-op that would have shown green
forever without ever comparing anything.

**Second failure, after fixing the first**: I rewrote the test to use the
real `playCapture`/`playThrow` functions, confirmed the hand was
genuinely populated (23 cards, correctly), then deliberately injected an
actual leak — a branch that changes the AI's decision if a specific card
is in the "hidden" hand — to confirm the test would catch it. It didn't.
Digging in, the leak I'd written checked `card.face === "A"`, but this
engine's `Face.Ace` is the string `"Ace"`, not `"A"` — so the leak I
injected as a test of my test was itself dead code that could never
fire, for a reason that had nothing to do with the actual engine or the
actual test logic. Once the poison was written correctly, the test
failed immediately and clearly, showing exactly which card and which
decision differed. I ran the identical check against the four-player AI
too rather than assuming the same fix generalized — it did, and caught
an equivalently-written leak just as cleanly.

Both `computer.ts` and `computer4p.ts` were used only to run these
checks and are back to byte-for-byte their prior state (confirmed with
`diff`) — neither file is part of this patch, since neither actually
changed.

## What Phase 1 still needs
Extending the two randomized fuzz tests to also run every move through
`applyMove`/`applyFourPlayerMove` as a cross-check against the direct
function calls, and — deliberately last, and its own separate,
carefully-isolated step — the monorepo restructuring, since that's the
one piece touching the deploy pipeline rather than just application
code.

## Files in this patch
`deck.ts`, `gameEngine.ts`, `fourPlayerEngine.ts`, `version.ts` (new),
and seven test files (two new: `redaction.test.ts`, `aiBlindness.test.ts`;
five updated for the new `engineVersion` field and seeded-shuffle tests).

## How to apply
Copy these files into your repo at the paths shown, then:

    npm test
    npm run lint
    npm run build
