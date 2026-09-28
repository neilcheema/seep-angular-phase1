# Visual polish v2: bug fixed after reviewing your actual styles.css

## A real bug caught and fixed
The first version of `opponent-hand.component.html` applied an inline
`[style.transform]` to every card-back, and for left/right orientations
that inline value was `rotate(0deg)`. Your `styles.css` has:

    .comp-fan--left .card-back  { transform: rotate(90deg); }
    .comp-fan--right .card-back { transform: rotate(-90deg); }

Inline styles always win over CSS class rules, so that `0deg` would have
silently overridden the 90°/-90° rotation and broken Player 2/4's
mobile-compact side hands the moment this was applied — undoing the
mobile-orientation fix from earlier in this conversation. This is exactly
the kind of thing I couldn't have caught without seeing the actual CSS.

**Fixed**: the inline transform is now only ever applied for `'top'`
orientation (`orientation() === 'top' ? '...' : null` — passing `null`
means Angular doesn't set the inline style at all, leaving your existing
CSS class rules completely in control for left/right, exactly as before).

## Everything else, now confirmed safe against your real CSS
- `.hand-row` and `.floor-row` both use flexbox `gap` for spacing, not
  margin-based overlap — so wrapping their children in `.hand-card-slot`/
  `.floor-scatter-slot` doesn't disturb spacing at all, on any screen size.
- The only transform-based interactive state I found (`.card-valid:hover`,
  the lift-and-scale effect when hovering a selectable card) applies to
  the card itself, one level *inside* my wrapper divs — a rotated parent
  and a separately-transformed child compound correctly in CSS, they
  don't fight each other. Confirmed no conflict.
- `.house-stack.selected` and other selection-highlight rules use
  `border-color`/`box-shadow`, never `transform` — no interaction with
  anything in this patch at all.

## Files in this version
Same four files as before (`opponent-hand.component.ts/.html`, both game
page templates, `styles-addition.css`), plus the new
`player-hand.component.ts/.html` fan rotation from the follow-up. Only the
opponent-hand files actually changed from what was delivered previously —
everything else is unchanged and was already correct.

## Still true from before
This is still a visual change built without a live browser to check it
in — the fix above was found through careful reading of your CSS, not by
seeing it rendered. The rotation angles and scatter pattern are a
reasonable first guess. Build it, look at it on your phone, tell me what
to adjust.

## How to apply
1. Copy all files into your repo at the paths shown.
2. Append `styles-addition.css`'s contents to the end of
   `projects/seep-web/src/styles.css` (skip this step if you already
   applied it from the previous delivery — it's unchanged).
3. `npm run build && npm run lint`
