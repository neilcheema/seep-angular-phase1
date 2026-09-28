# Feedback address and version bump

## Changes
- **Address**: the "notice something off?" note now goes to
  info@seep.quest (was narender.cheema@cheemaclan.org).
- **Version**: 1.1.0 -> 1.2.0. It appears in the page footers and in the
  "Version:" line of every note, so notes sent from the new build are
  identifiable.

## Where they live now
Both are constants in `version.ts` (APP_VERSION, FEEDBACK_EMAIL). Both game
pages read them from there, so the address is no longer written out in two
components; future changes are one line in one file.

## Why 1.2.0
Since 1.1.0: the computer players stopped reading hidden hands and reason from
what has been played, the deal is staged as in the physical game, four-player
dealer rotation follows the score, houses can be captured with separate loose
groups, and the table layout was reworked. Nothing was removed, so I treated it
as a minor bump. If you would rather call the rules changes a major release,
it is one string.

## Two things I can't do from here
1. **package.json**: set the "version" field in your root package.json to
   1.2.0 to match.
2. **Landing page footer**: I don't have that file. If it shows a hardcoded
   "v1.1.0", change it to 1.2.0 (or import APP_VERSION as the game pages do,
   so it can't drift again).

## Check the mailbox exists
The note opens the visitor's mail app addressed to info@seep.quest. It only
reaches you if that mailbox or a forwarding rule exists for the domain. Send
yourself a test note after deploying.

## Files
version.ts, four-player.component.ts, two-player.component.ts (full-file
replacements; no template or CSS changes, so nothing to merge).

## Apply
Copy over your repo, then `npm run build && npm run lint`.
Verified here: all three files parse cleanly and the old address no longer
appears anywhere in them. I could not run `ng build` (no Angular workspace
here).
