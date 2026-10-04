# Phase 5, slice 5c: rate limits, table caps, Leave, health check, and a monitoring checklist

This builds on slice 5b: **apply the 5b package first** (several files are in both, and these are the newer versions).

## READ THIS FIRST: the order matters
1. **Run `projects/seep-api/db/006_phase5_rate_limits.sql` in Neon (production, then dev) BEFORE you deploy.** The new code records an
   event in a new table, `rate_events`, whenever someone starts a table, makes a move, or enters a wrong table code. Deploy first and
   **creating tables, joining and moving all fail until the migration is run.** (It creates one small table and is safe to run twice.)
2. Copy the files in this zip over your repo; `npm test && npm run lint && npm run build`; commit and push.
3. Open `https://<your API>/api/v1/health?deep=1`. It should say `"schema":"ok"`. If it says `"out-of-date"`, a migration is missing
   (the details are in the log). This check exists because we have now been bitten twice by migration order.
4. Run the smoke test: **46 of 46** (it was 41).

## What it does
- **Rate limits** (per person; counted in the database, so they hold if Azure runs several copies of the app):
  | What | Default | Setting |
  |---|---|---|
  | Starting tables | 10 per hour | `LIMIT_CREATE_PER_HOUR` |
  | Moves | 120 per minute | `LIMIT_MOVES_PER_MINUTE` |
  | WRONG table codes (unknown or malformed) | 10 per 10 minutes | `LIMIT_FAILED_JOINS_PER_10_MIN` |
  | Tables waiting for players, at once | 5 | `LIMIT_MAX_WAITING_TABLES` |
  | Matches in play, at once | 20 | `LIMIT_MAX_ACTIVE_TABLES` |
  | Switch every limit off | on | `LIMITS_ENABLED=false` |
  Set these in the Function App's Environment variables; no redeploy. A mistyped value (0, negative, text) falls back to the default.
  A refusal is a **429** with a plain message and a `Retry-After` header. Caps are a **409** that names the way out.
- **Polling is never limited and never touches the limiter.** A *right* table code, even for a full table, uses none of the wrong-code
  allowance; only wrong guesses count (that is the route to guessing someone else's table).
- **Leave**, on any table still waiting for players (in Your tables). It frees your seat (the table stays open for the others) or closes
  the table if nobody else is there. It exists because a cap with no way out would lock people out. A match under way cannot be left
  this way (that would be a forfeit).
- **Health check:**
  - `GET /api/v1/health` answers `{"status":"ok"}` at once and **never touches the database**. Point an uptime monitor at this one.
  - `GET /api/v1/health?deep=1` also checks the database is reachable and that every migration has been run. It is for people, smoke
    tests and a look right after a deploy, **not for a monitor**: each real check wakes Neon, and a monitor pinging it every minute would
    keep Neon running all month and use up the Free plan's compute hours. It is also throttled: within 30 seconds of the last deep
    check it repeats the same answer instead of asking the database again.
- **Cleanup** also removes rate-limit records older than a day.
- **The smoke script** adds the two health checks and a leave-a-throwaway-table check.

## Monitoring and cost alerts: a checklist (NOT tested; these are Azure settings I cannot try from here)
The steps and menu names are from general knowledge of the Azure portal and may differ a little. After creating each alert, use Azure's
"test action group" option to confirm an email really arrives, and remember a new alert can take several minutes to start evaluating.

**Set up once:** Application Insights (open it from the Function App's Overview) -> Alerts -> Create -> Alert rule, type "Custom log search".
Create an **action group** that emails you, and reuse it for every rule below.

| Alert | Query (paste into the rule) | Fire when | Check every |
|---|---|---|---|
| Server errors | `requests \| where timestamp > ago(15m) \| where toint(resultCode) >= 500 \| summarize errors = count()` | errors > 5 | 5 min |
| **Cleanup did not run** (alert on absence) | `traces \| where timestamp > ago(26h) \| where message startswith "Cleanup" or message startswith "DRY RUN" \| summarize runs = count()` | runs < 1 | 1 hour |
| Cleanup failed | `exceptions \| where timestamp > ago(1h) \| where operation_Name has "cleanup" \| summarize n = count()` | n > 0 | 15 min |
| Database getting big | `traces \| where timestamp > ago(1d) \| where message has "MB warning level" \| summarize n = count()` | n > 0 | 1 hour |
| A health check found a problem | `traces \| where timestamp > ago(1h) \| where message startswith "Health check:" \| summarize n = count()` | n > 0 | 15 min |
| Possible abuse | `traces \| where timestamp > ago(1h) \| where message startswith "Rate limit reached" \| summarize hits = count()` | hits > 50 | 15 min |

A job that never runs looks exactly like a job with nothing to do, which is why "Cleanup did not run" alerts on the *absence* of its daily log line.
(The first day after you set it up it may fire once until the first run has been logged.) The "Database getting big" message is the
cleanup's own warning; its level is `CLEANUP_SIZE_WARN_MB` (default 300 MB), and Neon's Free plan suspends a project that passes 0.5 GB.

**Uptime:** use a free external uptime monitor on `https://<your API>/api/v1/health` (every 5 minutes; expect HTTP 200). Do NOT use
Application Insights' old "URL ping" availability test: **Microsoft retired it on 30 September 2026.** Its replacement, the "Standard
test", is billed per execution, so check the price first. Never point any monitor at `?deep=1`.

**Cost:**
- Azure Cost Management -> Budgets -> Add: a monthly budget on the subscription or resource group, with email alerts at 50% and 90% of
  actual spend and at 100% of forecast. Pick an amount that would genuinely surprise you.
- Function App -> Alerts -> a metric alert on "Function Execution Count" (Total, per day) above about 30,000. The free grant is 1,000,000
  executions a month, about 33,000 a day. Check the metric's exact name in the portal.
- Neon: look at the console's usage page about once a month (storage against 0.5 GB, and compute hours). I do not know whether Neon emails
  usage alerts for your plan; check its notification settings. Our own database-size warning (above) covers storage.
- Glance at Cost Management a week after the cleanup's storage account was created, as noted before.

## Try it by hand in production
1. Health: open both URLs above; expect `ok`, and `schema: ok`.
2. Temporarily set `LIMIT_MAX_WAITING_TABLES` = 2 (Environment variables, Apply). In Play online start three tables: the third is refused with
   a message pointing at Leave. Press Leave on one; starting a table works again. Then delete the setting.
3. Temporarily set `LIMIT_FAILED_JOINS_PER_10_MIN` = 3. Enter three wrong codes; the fourth try says "Too many wrong table codes". Delete the
   setting (the wait is 10 minutes if you do not).

## Verified
- **721 tests across the repo** (176 engine, 361 API, 184 web), **none skipped**; lint clean (your exact toolchain); strict Angular compile
  clean; the API bundle builds.
- **Real browsers:** two-player journey 94 checks, four-player 97, no unexpected errors. The new part: three waiting tables listed with Leave
  buttons; a fourth refused with the message naming Leave; Leave removing a table and a new one then starting; a wrong code explained; the fourth
  wrong code refused.
- **The smoke script passes 46 of 46** against my test server (it has not been run against your real Azure).
- **Twenty-one deliberate breakages caught** (20 server, 1 screen). Two survived at first and made the tests better: a test where the
  "full table" attempt came from a different person than the one whose allowance was being checked, and a "never wait 0 seconds" guard that
  could not be reached through the database (it is now a small function with its own tests).

## NOT verified
- Anything against your real Azure, Firebase and Neon. The defaults are judgement calls; tune them in the settings.
- The monitoring and cost steps above (untested, as said).

## Known limits
- **Limits are per account, not per person or per network address.** Sign-up is open and needs no email verification, so someone willing to
  create many accounts can get around them. These limits stop floods and code-guessing from one account; they are not a defence against a
  determined attacker with many accounts. That would need limits on network addresses (Azure Front Door or a firewall, which costs money) and/or
  email verification, and is not built.
- They are soft limits: two requests at the very same instant can both slip through at the edge.
- The smoke test makes 3 tables per run for one account, so more than 3 runs in an hour trips the creation limit. After many runs the cap of 20
  matches in play can block joining until the daily cleanup closes idle ones (a table nobody has touched for 7 days). Only a burst of debugging runs
  would see either.
- There is no "resign" for a match in progress (leaving one means the turn clock or deleting the account).
