# Phase 6, slice 6a: two small polish fixes

Both came from your phone screenshot of a two-player table. Website only: no database change, no API change, no new tests to run beyond the usual.

## What changed
1. **The reaction message no longer covers the bid.** It used to float at the top of the screen, over the status bar, and hid "Bid: 10 (…)" and most of the opponent's name for its four seconds.
   It now appears **over the opponent's face-down cards** (at a four-player table, over the partner's cards at the top), which is the least important thing on the screen. It is still clear of the buttons and your own hand, and it still cannot be tapped.
2. **The reactions tray has a solid background.** Before, your own cards showed faintly through it.

## Apply
Copy the three files over your repo (all under `projects/seep-web/src/app/pages/`): `online/online-game.component.html`, `two-player/two-player.component.html`, `four-player/four-player.component.html`.
Then `npm test && npm run lint && npm run build`, commit and push. Nothing else to run. The app version stays at 1.7.0; if you want a number for it, 1.7.1 is the natural one, or wait and ship it with 6b.

## How it works (for the curious)
Both game screens now have a second slot beside the one for the 💬 button, placed inside the block that holds the opponent's (or partner's) cards. The table screen puts the messages into it. That is how the message can sit over those cards without me needing to know your stylesheet.

## Verified
- Strict Angular compile clean; lint clean; **917 tests** pass (unchanged; this is layout only).
- **Real-browser journeys on a freshly rebuilt clean bundle:** two-player **120 checks**, four-player **137**, consent **33**.
  New checks: the message's container is absolutely positioned (not floating), is inside the opponent's / partner's block, and its top is not above the bottom of the status bar; and the tray's computed background is fully solid.
- **Two deliberate breakages caught:** the tray made see-through again (caught, with the exact value rgba(0, 0, 0, 0.9)); and the message floating again at the top of the screen (caught).

## NOT verified
- **How it looks on your phone with your real stylesheet.** Please check that the message is readable over the blue cards and not cut off. My test page does not load your stylesheet.
- **A weaker check than it sounds.** "Not above the status bar" cannot really fail in my test page, because the status bar there is short, so it passes even for the broken version. The check that does the work is the positioning one (absolute, inside the cards' block), which is what caught the breakage.
- At a four-player table the message appears over the PARTNER's cards, because that row sits at the top. The two side hands do not carry one.

## Mistakes along the way
- An older check of mine (that only the person a reaction is for gets the strong border) failed once. It was a race in my test: Dave's earlier border was still on screen when I started recording. The test now waits for any earlier border to clear. The app was right.
- A new constant of mine landed at the wrong indentation in both journeys, which stopped them parsing; fixed at once.
