# Whose turn it is, and the reactions button in its right place

Two fixes from the four-person test with real people. Website only: no database change, no API change.

## What changed (online tables only; games against the computer are unchanged)
1. **A clear "whose turn" line.** Testers had to be told "if the buttons appear, it's your turn". The player on the move was already named, but only in a small grey
   clock line, next to another line that just said "Waiting for the other players…". Now the row above the buttons says, in bold:
   - **"▶ Your turn"** in gold, for the player on the move;
   - **"Carol’s turn"** (the mover's name) for everyone else, or "Your partner’s turn" for the mover's partner.
   The old "Waiting for…" line is gone. The small clock line below it is unchanged (it still shows the time left).
2. **The seat on the move is marked.** Its name gets a gold ▶ and bold type on the other players' boards (at a four-player table, beside the partner, left and right labels; at a two-player table, beside the opponent's name).
3. **The 💬 reactions button no longer floats over the game.** It was a fixed button halfway down the right edge of the screen, which on a phone landed on top of the cards and on the Team B score box.
   It now sits at the right end of the turn bar, in the normal page layout, where it cannot cover anything. Its tray opens pinned to the bottom-right corner of the screen, so it is always fully visible.
   Reactions themselves behave as before (everyone at the table sees them). "To: a chosen player" is agreed (option A) and comes next.

## Apply
Copy the files over your repo; `npm test && npm run lint && npm run build`; commit and push. Nothing else to run.

## A flaw the tests found in my first version
My first placement opened the tray *upward* from the button. When the bar is near the top of the screen (a short phone, or landscape) the tray would land off the top edge and be unreachable.
The browser journey caught it. The tray is now pinned to the bottom corner of the screen instead, which is always visible.

## Verified
- **897 tests across the repo** (176 engine, 430 API, 291 web), none skipped; lint clean; strict Angular compile clean.
- **Real-browser journeys on a freshly rebuilt clean bundle:** two-player **117 checks** (was 111), four-player **124** (was 116), consent journey still **33**.
  New checks: exactly one player is told "Your turn" and everyone else sees that person BY NAME (including "Your partner’s turn"); the ▶ marker appears on the seat on the move on the three other boards and
  on no board for the player on the move; on every board the 💬 button is inside the turn bar and clear of the turn line; at phone width (360 px) the button stays in the bar, nothing scrolls sideways,
  and the opened tray is fully on screen.
- **Nine deliberate breakages caught:** six in the turn wording (the mover told the wrong thing, others shown the wrong name, a turn announced after the match, every seat marked, the marker after the match,
  "Your turn" not flagged as the viewer's own) and three on the screens (the two-player board telling the wrong player it is their turn, the four-player board never marking the seat, the button missing from the bar).

## NOT verified
- **How it looks with your real stylesheet.** My test page does not load your app's real CSS, so I have checked the structure and the positions, not the real appearance. Please look at it on your phone.
- **Extra height.** The turn bar is always shown on an online table and reserves about 40 px, where the old "Waiting…" line appeared only when you were waiting. On a short phone the board may scroll a little more.
  If it feels cramped, say so and I will make the bar slimmer.
- Real devices and real players. The earlier test found these problems; this fix has been tested only by my browser journeys.

## Not done here
- **Who a reaction is for** (finding 2). Agreed as option A (a "To:" choice, shown as "Alice → Bob"); not built yet.
- I have not changed the app version. This is a visible change, so if you ship it alone, the next number after 1.6.0 would be 1.7.0.
