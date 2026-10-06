# Phase 6, slice 6c (Learn Seep), part 2: the move lister

**Nothing a player can see changes.** This is the foundation the rest of Learn Seep stands on: a function that lists every legal move for the player to move, so that later parts can rank them and explain the best two or three. It is engine-only (three files). No migration, no setting.

## Apply
Copy the three files over your repo (paths start with `projects/seep-engine/src/`): `lib/moves.ts`, `lib/__tests__/legalMoves.test.ts`, `public-api.ts`. Then `npm test && npm run lint && npm run build`, commit and push. Nothing uses the new function yet, so it is safe to hold back and ship together with the next part if you prefer. The engine's rules version is NOT bumped (no rule changed).

## What it is
`legalMoves(state, playerId?, { maxLooseCards?, budgetMs? })` returns every legal move (a capture, a build, adding to or breaking a house, or a throw) for that player in the opening move or ordinary play. It is empty when it is not that player's turn or in another phase (bidding already has `legalBids`).

## How it stays right
**Every move it lists has been accepted by the engine's own `applyMove`**, so it cannot list an illegal move and cannot drift from the rules. What a test must prove instead is that nothing legal is MISSING; that is where almost all of the testing went (below).

## How it stays fast (the part that took three tries)
My first version was correct and far too slow: **0.3 s with 8 loose cards on the floor, 13 s with 10, over a minute with 11 or more**, because a house can fold in almost any subset of the floor (3,112 legal moves on a ten-card floor) and the engine takes about a millisecond to confirm each. In a browser that would freeze the page. So:
1. **Cheap arithmetic first.** Candidates the rules certainly refuse (wrong card totals; a house of that value already exists; no card left to capture the new house with; the opening move not matching the bid) are dropped before the engine is asked. The rule that a new house must pull in every matching group is worked out once per card and target, not once per candidate; measured: 81 ms against 179 ms on a busy position, with the same 394 moves either way.
2. **A limit on loose cards per build or house change: 4 by default** (`DEFAULT_MAX_LOOSE_CARDS`). Captures and throws are always complete. **In 2,952 simulated computer turns the limit never hid the computer's own move.** A bigger `maxLooseCards` gives the exact list (slow on a crowded floor).
3. **An optional time budget (`budgetMs`).** The list is built simplest-first: captures and throws (always complete), then builds and house changes using 0 loose cards, then 1, 2, 3, 4. If time runs out it returns what it has. With no budget (the default, and in all tests) the result is exact and identical on every machine. A realistic hand on a 14-card floor takes about 125 ms.

## Verified
- **999 tests across the repo** (197 engine, 480 API, 322 web), none skipped; lint clean; strict compile clean.
- **The lister's 14 tests, stable over repeated runs:**
  - hand-worked positions (the forced capture, a build that is and is not allowed, cementing, breaking a house up, a cemented house that cannot be broken, other players' turns, the opening move);
  - **an exact match with a brute-force search of every possible move** (any capture selection, any subset of loose cards, any house value from 1 to 20) over 110 random positions, with no limit, with the default limit, and with a limit of one;
  - **an exact match with the original slow version** on 40 bigger positions (6 to 8 loose cards plus houses);
  - **across 80 simulated whole games, the computer player's own move was always in the list, and the player to move always had at least one move** (hundreds of captures, throws and builds met);
  - the time budget: captures and throws are always complete (including on a position that really has throws), nothing illegal ever appears, more time never loses a move, plenty of time equals no limit, the order is simplest-first, and a position that takes seconds without a limit returns promptly.
- **Twelve deliberate breakages: eleven caught** (the budget ignored; throws skipped when there is no time; built biggest-first; captures never listed; houses only built for 9; never broken up; never cemented; never built from the played card alone; throws never listed; the engine not asked; the loose-card limit ignored). **One survives and I believe it should:** removing the pull-in shortcut changes only speed (same results, 2 times slower on a busy position).

## NOT verified
- **No screen uses it yet**, so none of this has been seen by a player.
- **Speed on your phone.** The timings are from my test machine. A crowded 12-card hand on a ten-card floor, with the default limit and no budget, still takes seconds there; the budget exists so the screen never waits for that.
- Two-player games only. A four-player lister would be a separate piece of work.

## Mistakes and slips along the way
- My first version was too slow to use; I found it by measuring, not by reading.
- **A gap in my own test:** my "throws survive a zero time budget" test used a position with no throws at all, so it could not fail. I measured (12 captures, 0 throws), wrote a test on a position that really has throws, and re-ran the breakage: now caught.
- A first breakage I reported as "survived" was a broken file; I redid it properly. My timing tests twice went silent when killed by a time limit, and I used shell features the tool's shell lacks. None of it affects what is delivered.
