# Curved side hands + centred floor (four-player)

## What you reported
1. Floor cards sat too far to the left instead of the middle.
2. Player 2 and Player 4 were still straight lines instead of curved fans.

## What was actually going on (found by rendering it, not guessing)
I rebuilt your table in a browser using your real styles.css, reproduced
your screenshot exactly, and traced each problem:

- **Floor off-centre**: the four-player floor row had no `justify-content:
  center` (the two-player one already did). Houses are wide, so each wrapped
  onto its own row and hugged the left edge.
- **Floor overlapping Player 2**: the side cards were portrait cards rotated
  90 degrees. CSS rotation doesn't change layout size, so each column reserved
  the *narrow* width but was drawn *wide*, spilling into the floor area.
- **A bug I hadn't noticed**: the last card in each side column stuck out
  sideways. An old rule, `.comp-fan .card-back { margin-right: -22px }`, applies
  to every card except the last, and in a vertical column that shifts them.
- **Straight lines**: nothing ever varied the angle down the stack.

## What changed (2 files, no CSS to merge)
**opponent-hand.component.ts / .html**
- Side seats: cards are laid landscape (width/height swapped) so the column's
  footprint matches what you see. Each card tilts a little more than the last
  down the stack, and outer cards ease toward the screen edge, so the column
  bulges toward the table like a real fan seen from the side. Tighter overlap
  also makes the columns roughly half as tall, which gives the floor room.
- Top seat: same look as before, but a full hand no longer wraps to a second
  row on tablet-width screens.
- All of it is inline styles in the component, so it overrides the old CSS
  rules without you touching styles.css.

**four-player.component.html**: floor row now centred (one inline style).
This is the full file, so it carries forward your earlier how-to-play and
floor-scatter changes.

## Verified
- Compiled with the real Angular AOT compiler with `strictTemplates` on: clean.
- Rendered the compiled component in Chromium at 375, 390, 430 and 768 px wide
  with 12, 10, 4, 1 and 0 cards: no clipping, no overlap with the floor.
- Before/after image included.

## Not verified
The floor cards in my test were simplified stand-ins, since I don't have your
floor-item component, and I haven't seen this on a real iPhone. Expect the
centring to be right to within a few pixels, not exact.

## If you want to tune it
All in `cardStyle()` in opponent-hand.component.ts:
- `-0.55` (side overlap): more negative = tighter stack.
- `3.5` and `40` (tilt per card / total cap, degrees): fan width.
- `radius = 210`: smaller = stronger arc, larger = flatter.

## Optional cleanup
The `.comp-fan--left` / `.comp-fan--right` blocks in styles.css (added in the
earlier mobile patch) are now overridden and do nothing. Safe to delete.

## Apply
Copy the two folders over your repo, then `npm run build && npm run lint`.
