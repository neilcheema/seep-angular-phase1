# Minimum app-version check (closing the last Phase 3 gap)

Section 6 of the plan, item 3: "Add a minimum-app-version check so old
apps can be told to update." Not implemented until now \u2014 added before
closing out Phase 3, not retrofitted later.

## How it works
- New file: src/lib/version-check.ts. Compares a client-declared
  X-App-Version header against MIN_CLIENT_VERSION (an environment
  variable), numerically per version segment \u2014 "1.10.0" correctly
  sorts above "1.9.0", not just lexicographically.
- MIN_CLIENT_VERSION is unset by default: until you explicitly set it
  as an Application Setting, nothing is rejected. Safe default \u2014 no
  risk of an accidental lockout from a forgotten config value.
- A request with no X-App-Version header at all is always let through,
  regardless of MIN_CLIENT_VERSION. The point is telling a client that
  HAS declared an old version to update \u2014 not rejecting every request
  that lacks the header, which would also break the manual curl testing
  used to verify phase 3 end-to-end, and any client written before this
  header existed.
- Wired into me.ts as the first check, before token verification \u2014 a
  client that needs to update should find that out regardless of
  whether its auth token happens to be valid.
- Response on a rejected version: 426 Upgrade Required (the HTTP status
  built for exactly this case), with a message naming both the client's
  version and the minimum required.

## Verified
- 7 new tests for the comparison logic itself (unset minimum, missing
  header, below/equal/above, and the numeric-vs-lexicographic case
  specifically) plus 2 new tests for the me.ts wiring (426 returned and
  logged without touching auth or the database; a set minimum with no
  header still proceeds normally).
- Deliberately poisoned twice, in two different places \u2014 the
  comparison logic itself, and separately the wiring that calls it in
  me.ts \u2014 and confirmed each poisoning was caught by a different,
  correct subset of tests before trusting either, then restored both.
- Full suite: 22 tests now (was 13), strict typecheck, and the esbuild
  deployment bundle all re-verified clean.

## Apply
Three files replace existing ones (me.ts, me.test.ts,
local.settings.json.example), one is new (version-check.ts, plus its
test file). Then from projects/seep-api/: npm test, npm run typecheck,
npm run build \u2014 same three checks as every patch this project.

Nothing to configure on the live Function App unless you actually want
to start enforcing a minimum \u2014 MIN_CLIENT_VERSION stays unset (and
therefore inert) until you deliberately add it as an Application
Setting, which makes sense once there's an actual versioned client
(the Angular app, eventually the Android app) sending this header.
