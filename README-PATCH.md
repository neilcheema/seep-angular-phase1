# Building a house: mandatory maximal grouping + smarter AI

## What you asked for
Two things: (1) enforce "combine every matching group" as a default rule
for building/cementing, the same way it's already mandatory for
capturing — not just something the human can optionally do by hand — and
(2) make the AI actually use this.

## What changed

### 1. Mandatory enforcement (both engines, applies to every player)
Once you've committed to a target house value V (by choosing what to
build), you can no longer cherry-pick just some of the matching loose
cards and leave others behind. If building toward 13 and a second,
independent complete 13 is sitting loose on the floor, it must be pulled
into the same house — you can't build a smaller house and leave it there.

**Choosing a different target value entirely remains completely free.**
This only blocks under-including *for the value you've actually chosen* —
it doesn't force you toward any particular value in the first place. A
new test confirms this explicitly: building a 9 is untouched by two loose
Kings sitting nearby, since they're irrelevant to a value-9 house.

### 2. Smarter AI (both computer.ts and computer4p.ts)
Both AIs' build logic (`findBuildOption`, plus the separate opening-move
build search) now computes the full maximal combination — the same
computation the engine itself uses — instead of only ever finding a single
exact-match group. Dead code from the old single-group search
(`subsetSummingTo`, and an unused `isLoose` import) was removed in the
process.

## Something important I found while testing this, worth knowing
I initially expected the AI to start *visibly choosing* to build big
combined houses instead of capturing. Testing that directly, I found it's
actually structurally impossible under the existing priority order, and
it's worth understanding why rather than just taking my word for it:

**Whenever a multi-set build is achievable, a competing capture is always
available too — and capture is checked first, so it always wins.** The
reserve card a build needs (another card of the target value) can always
just capture those same complete matching groups directly instead of
being held back for a build. Concretely: if two loose Kings sit on the
floor and you're holding a third King as your build's reserve, that King
could just capture both loose Kings outright (26 points, guaranteed, right
now) rather than sitting in your hand while a house of 39 gets built and
has to be captured *later* — capture is the safer, better play, and the AI
correctly takes it.

**Practical effect: the AI's build enhancement is a correctness/robustness
fix, not a visible behavior change.** It guarantees the AI never
accidentally submits a partial build selection that the new mandatory rule
would reject — but you won't actually see the AI choosing a multi-set
build over an available capture, because that scenario can't arise. The
multi-set build path (like the one you performed by hand) is really a
*human* strategic option — a deliberate choice to defer value into a house
rather than bank it immediately — not something the AI's priority order is
built to prefer for itself. I've flagged this now rather than let you
discover it as a "why doesn't the AI ever do the cool thing I did"
question later — if you'd like, changing the AI's priority to sometimes
favor a bigger deferred build over an immediate smaller capture is a real,
separate design decision I'm happy to think through with you, but it's a
genuine strategy trade-off (immediate certain value vs. deferred larger
value the opponent might grab first), not a bug fix.

## New tests
Two new describe blocks in each of `game.test.ts` and
`fourPlayerActions.test.ts`:
- Mandatory enforcement: rejects an under-inclusive build when a bigger
  combined option exists for the chosen target; confirms choosing a
  different target value is unaffected by unrelated matching groups.
- AI behavior: confirms the AI correctly captures rather than builds when
  both are available (documenting the finding above), and confirms the
  AI still correctly finds an ordinary single-set build when that's
  genuinely the only option.

## How to apply
Copy these nine files into your repo at the paths shown, then:

    npm test
    npm run lint
    npm run build

No UI files needed for this patch — the human-facing build flow already
goes through this same engine validation (from the previous patch), so it
picks up the new enforcement automatically.

## Verified here
118/118 tests passing (8 new), full `tsc` type-check clean, and the two
randomized fuzz tests re-run 5 times back to back with no flakiness.
