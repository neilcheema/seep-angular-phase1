# Mobile layout: side-seated opponents' hands now run vertically

## What changed
Player 2 (left) and Player 4 (right) now hold their cards as a vertical
stack, each card rotated to face the table center — like an actual
side-seated player's hand — instead of a horizontal row. This makes their
"side-hand" columns much narrower, freeing up horizontal width for the
floor to actually be visible on narrow mobile screens. Player 3 (the
partner, at the top) is unchanged — still a horizontal fan, since a
top-seated player's hand naturally reads left-to-right same as yours.

## Files
- `opponent-hand.component.ts` / `.html` — added an `orientation` input
  (`'top' | 'left' | 'right'`, defaults to `'top'` so the two-player
  opponent and the four-player partner render exactly as before with no
  changes needed there).
- `four-player.component.html` — passes `orientation="left"` to Player 2's
  hand and `orientation="right"` to Player 4's, full-file replacement
  carrying forward every previous fix to this file.
- `styles-addition.css` — **append to your existing
  `projects/seep-web/src/styles.css`**, don't replace the whole file.

## Important honest caveat: the exact spacing is a guess
I don't have your actual `.card`/`.card-back` CSS dimensions in front of
me in this session, so the `-34px` overlap value between stacked cards in
`styles-addition.css` is a reasonable starting estimate, not something
I've verified against your real card size. It'll very likely need tuning
once you actually see it on a phone:

- **Cards too far apart / stack too tall**: make the value more negative
  (e.g. `-40px`, `-44px`) to overlap them more.
- **Cards overlapping too much / hard to tell how many are held**: make it
  less negative (e.g. `-26px`, `-20px`).

The rotation direction (90° for left, -90° for right) should be correct
regardless of exact card size — only the overlap spacing is a guess.

## How to apply
1. Copy `opponent-hand.component.ts`/`.html` and `four-player.component.html`
   into your repo at their paths (full-file replacements).
2. Append `styles-addition.css`'s contents to the end of
   `projects/seep-web/src/styles.css`.
3. `npm run build && npm run lint`
4. Test on an actual phone (or your browser's device-simulation mode) and
   adjust the `-34px` value if needed — a quick change, no rebuild logic
   needed, just that one number.
5. Commit, push.

## Verified here
No engine changes — pure UI/CSS. As always with UI patches: no full
Angular workspace in this sandbox to run `ng build` against, and this one
in particular has a real visual-tuning step I can't do blind — genuinely
needs your eyes on a phone screen to get the spacing right.
