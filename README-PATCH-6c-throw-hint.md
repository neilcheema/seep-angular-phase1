# Phase 6, slice 6c (Learn Seep), part 1: "why can't I throw this?"

When you pick a card and **Throw is greyed out because you must capture with it**, the game now says so, says which cards the capture takes, and offers a **"Select them"** button that picks exactly those cards so **Capture** is ready to press. This is the case that stopped a real player in your first four-person game ("Neil's Throw button was greyed out": 3 + 6 + Ace made 10).

It appears at **every** table, not only a future practice mode: against the computer and online, at two-player and four-player tables. It is the first piece of Learn Seep and is useful to everyone.

## What a player sees
Above the action buttons, when it is your turn and a card you have selected must capture:
- **"You must capture with the Ten of Hearts."** then, depending on the table:
  - one matching card: "It matches the Six on the table."
  - cards that add up: "It takes the Three, the Six and the Ace (together 10)."
  - cards sharing a face: "It takes two Sixes (together 12)."
  - several matching sets (all are taken at once): "It takes every matching set at once: the Ten, and the Three and the Seven (together 10)."
  - a house: "There is a house of 9 on the table, and this card matches it." or "It takes the house of 9 and the Nine together."
- A small **Select them** button beside it. After tapping it the hint disappears and Capture is ready.
- A card that **may** be thrown shows no hint, and Throw is available, exactly as before. Nothing is shown during the opening move (there the card has to match your bid).

## Apply
Copy the eight files over your repo (paths start with `projects/`), run `npm test && npm run lint && npm run build`, commit and push. **No migration, no setting.** The engine file is part of both the API and the website bundle, but the API's behaviour is unchanged (it only gains one helper function), so nothing changes for the server and I did not bump the engine's rules version.

## How it works
- A new engine helper, `requiredCaptureIds`, returns exactly the floor items a capture must take (a house of the card's value plus every disjoint group of loose cards that add up to it). The engine's own `playCapture` enforces the same rule.
- The two game screens used to carry their own copy of that formula for the Capture button (a comment in the code records that the copy drifted from the engine once). **They now use the shared helper**, so the hint, the Capture button and the engine cannot disagree.
- The wording is a small separate function; it does not touch the rules.

## Verified
- **985 tests across the repo** (183 engine, 480 API, 322 web), none skipped; lint clean; strict compile clean; the API bundle builds.
- **The helper is proved against the engine itself:** 400 random positions (more than 80 with a capture, more than 80 without, more than 60 with a house): it is non-empty exactly when a capture exists; `playCapture` accepts exactly that set and refuses it with any card left out or added; and `playThrow` refuses the card exactly then. The hint wording is also checked on 300 random positions.
- **Real-browser journeys on a freshly rebuilt clean bundle:** the two-player journey now probes every turn for a card that must capture and one that may be thrown, and checks on the REAL page: the hint text, Throw greyed out, "Select them" making the hint disappear and Capture ready, and no hint for a throwable card. It insists both cases really happened. Same for the four-player page. Results: two-player 143 checks and four-player 170 (**these numbers vary from run to run**, because how many forced captures turn up depends on the deal), email confirmation 26 and 3, consent 33.
- **Thirteen deliberate breakages caught:** 4 in the engine helper (house ignored; only the first group required; a house hiding the loose groups; the wrong value), 6 in the wording (hint when throwable; "the Six and the Six"; wrong total; suit missing; "Select them" missing a card; a house described as a card), and 3 on the real screen (the hint never going away; "Select them" selecting nothing; a throwable card also getting a hint).

## NOT verified
- **How it looks on your phone** with your real stylesheet: the line sits just above the buttons and wraps on a narrow screen, and I could not see your layout. It could nudge the buttons down when it appears.
- **The wording read by someone who plays well.** The cards named are right (the engine says so), but whether the sentences are what you would say is your call; tell me and I will change them.
- **Not covered yet:** if the player picks the WRONG cards to capture by hand, Capture is greyed out with no explanation (a later part of this feature), and a throw refused during the opening move gets no hint.

## Mistakes and finds along the way
- The browser journey found a wording flaw that my own examples missed: "It takes the Six and Six (together 12)". It now says "two Sixes", with tests.
- My first browser check read the page the instant after a click and failed once; I replaced a pause with a proper wait and ran it repeatedly.
- My first breakage-runner had a bug (it read a name where it needed a path) and failed before changing anything; I fixed it and re-ran.
