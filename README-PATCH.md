# Patch: "notice something off?" note, sent via email — both games

## What this is
A quiet, opt-in way for you (or anyone playing) to flag something that
seems off about how a hand played out — framed honestly as "a rule might
have been missed while building this," not as filing a bug report against
the user. It unlocks once both sides have played at least one move (so
there's actually a log worth sharing), not on any timer.

## How it works
- **Unlocks after the first real exchange**: once the human has played one
  move (a bid counts) *and* at least one computer seat has played one move
  too, a small pill-shaped button appears in the bottom-right corner:
  "Notice something that doesn't match the rules you know?" It never
  re-locks for the rest of the session, including across new hands/games.
- **Clicking it** opens a small panel with a short explanation, an optional
  textarea, and Cancel / Send note buttons.
- **"Send note"** builds a `mailto:narender.cheema@cheemaclan.org` link —
  subject "Seep — a rule that might need a look" — with what the user
  typed plus as much of the recent move log (each entry's text *and* its
  floor summary from the last patch) as fits in a safe URL length,
  most-recent move first, and opens it. This hands off to the user's own
  email app; nothing is sent automatically from the page itself, since a
  static site with no backend has no way to dispatch email directly. Per
  your earlier choice, this was the no-new-infrastructure option.

## Why the email isn't fully automatic
Genuinely automatic sending would need either a backend (an Azure
Function, real infrastructure) or a third-party form-to-email service
(a new account, an API key baked into the app). You picked the mailto:
approach specifically to avoid both — the tradeoff is the user clicks
"send" once more in their own mail client.

## Files in this patch
- `four-player.component.ts` / `.html` — full-file replacements, carrying
  forward every previous fix (sweep-bonus feedback, cementing-label fix,
  floor-summary log lines) plus this new feature.
- `two-player.component.ts` / `.html` — same, full replacements.
- `styles-addition.css` — **append this to your existing
  `projects/seep-web/src/styles.css`** (don't overwrite the whole file —
  this is new rules to add at the end). Covers `.rule-note-toggle` (the
  small pill button) and `.bug-report-prompt` and its children (the panel
  itself, reusing the same visual language as the move-reveal overlay).

## How to apply
1. Copy the four `.ts`/`.html` files into your repo at the paths shown.
2. Open `projects/seep-web/src/styles.css`, and paste the contents of
   `styles-addition.css` onto the end of it.
3. `npm run build && npm run lint`, commit, push.

## Verified here
No engine changes in this patch — pure UI. As with every UI patch: no full
Angular workspace in this sandbox, so `ng build` couldn't be run directly.
Reviewed by hand for consistency (grepped for leftover old references —
none found; confirmed matching counts of new references in both files).
`npm run build` on your end is the real confirmation.
