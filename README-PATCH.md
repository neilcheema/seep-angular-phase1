# How-to-play text updated to match the pagat.com-verified rules

Both games' "How to play" sections rewritten to be accurate and clearer,
using plain language close to pagat.com's own phrasing where it helped.

## Four-player — what changed
- **Removed an actively wrong line**: *"A house can only ever be captured
  on its own — never combined with other loose floor cards in the same
  move, even if the totals would add up."* This was exactly the rule just
  corrected in the engine patch — leaving this text in would have actively
  misled players about how the game now works.
- **Added**: capture values (was missing entirely before), the staged
  dealing explanation (bidding/opening move from just four cards), the
  multi-set cementing rule, the corrected mandatory-and-combined capture
  rule (with the house-value-never-arithmetically-combined caveat spelled
  out), and the new win/lose-based dealer rotation.
- **Kept**: partnership/pooled-capture rules, house founding/breaking/
  adding rules, sweep tiers, scoring, and the match win condition —
  reworded in a few places for clarity but unchanged in substance.

## Two-player — what changed
Same treatment for everything that applies equally to both games: added
capture values context and the staged-dealing note, updated the cementing
line to cover multi-set builds, and rewrote the capture rule to state the
corrected mandatory-and-combined behavior with the same arithmetic-value
caveat. The two-player game's own structure (a single continuous hand, no
team play, no dealer rotation) is left exactly as it was, since that
matches your instruction not to touch the two-player dealing structure —
only the shared mechanics that were actually corrected are reflected here.

## Files
Both are full-file HTML replacements — templates only, no `.ts` changes
needed for this patch (this was purely a text/content update).

## How to apply
Copy these two files into your repo at the paths shown, then:

    npm run build
    npm run lint

No engine changes in this patch — pure content. As with every UI-only
patch: no full Angular workspace in this sandbox to run `ng build`
against directly — reviewed by hand for accuracy against both the
pagat.com source and the actual corrected engine behavior.
