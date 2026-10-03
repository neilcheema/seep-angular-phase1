# Table expiry and automatic cleanup

Builds on the four-player zip (it includes that version of `online-game.component.html`, plus one addition).

## Why this matters more than it sounds
On Neon's Free plan, a project that grows past **0.5 GB is suspended rather than billed**, which would take
Seep offline. Tables nobody returns to, and the move history of every finished game, would slowly push towards
that. This keeps the database small automatically.

## The policy (every number can be changed without a redeploy)
| Stage | What | Default |
|---|---|---|
| 1. Close | A table that is still waiting or in play, that **nobody has moved at or even looked at** for this long, is marked *closed* | **7 days** |
| 2. Delete | A finished or closed table is deleted this long **after it ended or was closed**, along with its seats and move log | **30 days** |

Because stage 2 counts from when a table was *closed*, an idle table always gets both stages: closed on day 7,
then a month of notice before it is deleted. A table anybody has open on screen counts as looked at, so it is
never closed from under them. Players who open a closed table see "This table was closed", not a frozen board;
a latecomer using its code is told it is no longer open; after deletion its address says the table was not found.
Closed tables are not listed under Your tables.

## Why the schedule is in your Function App, not in Neon
Neon does support `pg_cron`, but it runs *inside* the database, and Neon's docs say a job doesn't run if the
database is suspended. A Free-plan database suspends after 5 idle minutes and that can't be turned off (only paid
plans can). For a site that is asleep most of the time, a Neon-side schedule would mostly not fire. So a **timer
trigger** in `seep-api` fires daily at **10:30 UTC** (about 3:30am in Victoria), wakes Neon for a moment, and runs
the cleanup there. The work happens in Neon; only the alarm clock is outside it.

## Settings (Function App, Environment variables)
| Name | Default | Meaning |
|---|---|---|
| `CLEANUP_ENABLED` | on | `false` switches it off |
| `CLEANUP_DRY_RUN` | off | `true` only reports what it WOULD do |
| `CLEANUP_ABANDON_DAYS` | 7 | days idle before a table is closed |
| `CLEANUP_DELETE_DAYS` | 30 | days after ending/closing before deletion |
| `CLEANUP_BATCH_SIZE` | 200 | tables deleted per statement (max 1000) |
| `CLEANUP_SIZE_WARN_MB` | 300 | logs a warning if the database is bigger than this |

A mistyped value (0, negative, text) falls back to the default: a typo can never mean "close everything now".

## Apply
1. **Neon** (SQL editor, `production` then `dev`): run `projects/seep-api/db/004_phase4_cleanup_index.sql`. It is only
   an index that keeps the daily lookup fast; safe to run twice, and the cleanup works without it.
2. Copy the files in this zip over your repo, then `npm test && npm run lint && npm run build`, commit and push.
3. **First run in rehearsal mode** (recommended): in the Function App add `CLEANUP_DRY_RUN` = `true`. In the portal
   open Functions, then **cleanup** (it should show a Timer trigger), then Code + Test, then **Test/Run**, to fire
   it now. If you don't see Test/Run, just wait for 10:30 UTC. Read the result in Application Insights (if enabled), Logs:

       traces | where message has "Cleanup" or message has "DRY RUN" | order by timestamp desc

   You should see a line like `DRY RUN, would have closed 3 idle table(s) and deleted 0 old table(s)...`.
4. Delete the `CLEANUP_DRY_RUN` setting (and Save) to go live.

Timer triggers need the Function App's storage account (`AzureWebJobsStorage`), which a normally created Function
App has. Times are UTC.

## Looking at the size yourself (Neon SQL editor)
    SELECT pg_size_pretty(pg_database_size(current_database()));
    SELECT status, count(*), min(updated_at) FROM games GROUP BY status;
    SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
      FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;

## Safe by design
- Each stage is one conditional statement, so a table moved at while the cleanup runs is simply left alone.
- `seats` and `move_log` already cascade from `games`, so a delete cannot leave orphans (tested).
- Running it twice does nothing the second time. A batch limit stops any run from looping on a big backlog.
- Users are never deleted. Failures are not swallowed: they show as a failed run in Application Insights.
- Your smoke-test games are cleaned up by the same policy.

## Verified
- **525 tests across the repo** (36 files), lint clean (your exact toolchain), strict compile clean, bundle builds
  with the timer registered at `0 30 10 * * *`.
- **36 new tests** on real Postgres, at the boundaries (6.9 vs 7.1 days; 29 vs 31), plus the cases where it must
  NOT act: a watched table, a live table, a finished table's age, a typo'd setting, a dry run, switched off, a second run.
- **Twelve deliberate breakages, all caught**, including: ignoring whether anyone is looking, deleting live games,
  not restarting the month, wrong day counts, a dry run that really changes things, an hourly timer, swallowed failures.
- **Real browsers**: a waiting table is left alone at 6 days, closed at 8, vanishes from Your tables, explains itself
  when opened, refuses a latecomer's code, is deleted a month later and then reports "not found". The two-player
  journey is now 61 checks and the four-player journey is still 95, both clean.

## NOT verified
- **The real Azure timer firing**: I can't run the Functions host here. Step 3 above is how you confirm it.
- **Real Neon wake-up behaviour** and the cleanup running against your real data.
- The `FOR UPDATE SKIP LOCKED` clause (skips a table being touched at that instant) is standard Postgres, but my
  single-connection test database can't create the contention to demonstrate it.

## Limits
- **Deleting loses history**: finished games' results aren't kept. If you later want win/loss stats, we'd save a small
  summary row before deleting; say so before relying on history.
- Postgres reuses freed space, but Neon's reported size may not visibly shrink right away. The aim is to stop growth.
- Rough cost: a daily wake is about 0.6 compute-hours a month by my estimate (a small compute stays awake ~5 minutes
  after each wake), against 100 a month on the Free plan.
