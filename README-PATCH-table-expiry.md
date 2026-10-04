# Table expiry and automatic cleanup  (corrected README: supersedes the one in the zip)

Corrections from putting this live on 3–4 October 2026:
- **The Function App needs a storage account connection** (`AzureWebJobsStorage`), which the old README wrongly
  assumed it already had. HTTP functions don't need one; a timer does. See "Before anything else".
- **An HTTP 202 does not mean it worked.** It only means the run was queued. Read the log.
- **Expect zeros** at first (nothing is 7 days idle yet). A dry run executes only the *counting* queries, not the
  real UPDATE and DELETE.

## Why this matters
On Neon's Free plan a project that passes **0.5 GB is suspended rather than billed**, which would take Seep
offline. This keeps the database small automatically.

## The policy (every number can be changed without a redeploy)
| Stage | What | Default |
|---|---|---|
| 1. Close | A table still waiting or in play that **nobody has moved at or even looked at** for this long is marked *closed* | **7 days** |
| 2. Delete | A finished or closed table is deleted this long **after it ended or was closed**, with its seats and move log | **30 days** |

An idle table always gets both stages: closed on day 7, a month of notice, gone by about day 37. A table anybody
has open is never closed from under them. Players who open a closed table see "This table was closed"; a latecomer
using its code is told it is no longer open; after deletion its address says not found.

## Why the schedule is in the Function App, not Neon
Neon's `pg_cron` runs inside the database, and a job doesn't run while the database is suspended. On the Free plan
it suspends after 5 idle minutes and that can't be turned off. So a **timer trigger** in `seep-api` fires daily at
**10:30 UTC** (about 3:30am in Victoria) and wakes Neon for the moment it needs it.

## Settings (Function App, Environment variables, App settings)
| Name | Default | Meaning |
|---|---|---|
| `CLEANUP_ENABLED` | on | `false` switches it off |
| `CLEANUP_DRY_RUN` | off | `true` only reports what it WOULD do (counts only) |
| `CLEANUP_ABANDON_DAYS` | 7 | days idle before a table is closed |
| `CLEANUP_DELETE_DAYS` | 30 | days after ending/closing before deletion |
| `CLEANUP_BATCH_SIZE` | 200 | tables deleted per statement (max 1000) |
| `CLEANUP_SIZE_WARN_MB` | 300 | logs a warning if the database is bigger than this |

A mistyped value (0, negative, text) falls back to the default.

## Before anything else: the storage connection
A timer needs the Function App's storage account. Check Environment variables, App settings, for a setting named
exactly **`AzureWebJobsStorage`**. (`AzureWebJobsSecretStorageType` is a different setting: it only says where function
keys are stored.) If it is missing:
1. Create a storage account in the same resource group and region (West US 2): Standard performance, locally-redundant
   storage, "Blob Storage" as the preferred type, everything else default (leave hierarchical namespace off).
2. Open it, Access keys, Show, and copy the key1 **Connection string**. It contains a key: treat it like a password.
3. Function App, Environment variables, **+ Add**: name `AzureWebJobsStorage`, value = that string. Apply and confirm.

Symptom if it is missing: the log fills with "The listener for function 'Functions.cleanup' was unable to start" and
"Could not create BlobContainerClient for ScheduleMonitor", retried every few minutes.
The storage account is a new cost line (an estimate of pennies a month; check Cost Management after a week).

## Apply
1. **Neon** (SQL editor, `production` then `dev`): run `projects/seep-api/db/004_phase4_cleanup_index.sql`
   (an index only; safe to run twice).
2. Copy the files in the zip over your repo; `npm test && npm run lint && npm run build`; commit and push.
3. Make sure `AzureWebJobsStorage` exists (above).

## Rehearse it (recommended), from Terminal
1. Add the setting `CLEANUP_DRY_RUN` = `true`, Apply.
2. Copy the `_master` key (Function App, **App keys**). It is a password. It may change when storage is added, so copy it fresh.
3. Fire the function (this is what the portal's Test/Run button does; it doesn't depend on that tab being available):

       read -s KEY      # paste the master key, press Enter (nothing shows)
       curl -i -X POST "https://<your-function-app>.azurewebsites.net/admin/functions/cleanup" \
         -H "x-functions-key: $KEY" -H "Content-Type: application/json" -d '{}'
       unset KEY

   `202 Accepted` = queued (NOT necessarily successful). `404` = not deployed. `401` = wrong key (must be `_master`).
4. Read the result in Application Insights, Logs (it can lag a few minutes):

       traces | where message has "Cleanup" or message has "DRY RUN" | order by timestamp desc

   You want `DRY RUN, would have closed 0 idle table(s) and deleted 0 old table(s) ...` plus the database size.
   Zeros are correct while nothing is old. To see startup problems:

       traces | where timestamp > ago(30m) | where message has "unable to start" | count     // want 0

5. Delete the `CLEANUP_DRY_RUN` setting and Apply to go live.

## Confirm the schedule (the only proof the timer fires by itself)
After 10:30 UTC, look for a line near that time that you did not trigger:

    traces | where timestamp > ago(24h) | where message has "Cleanup" | project timestamp, message | order by timestamp desc

The first live run is also the first time the real UPDATE and DELETE statements run on Neon (with nothing to change).

## Looking at the size yourself (Neon SQL editor)
    SELECT pg_size_pretty(pg_database_size(current_database()));
    SELECT status, count(*), min(updated_at) FROM games GROUP BY status;
    SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
      FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;

## Safe by design
- Each stage is one conditional statement, so a table moved at while it runs is left alone; a second run does nothing.
- `seats` and `move_log` cascade from `games`, so a delete cannot leave orphans. Users are never deleted.
- Failures aren't swallowed: they show as a failed run in Application Insights.

## Verified
- 525 tests across the repo; lint clean; 36 new cleanup tests on real Postgres; 12 deliberate breakages caught;
  both stages seen in real browsers through the real cleanup code.
- In production (3–4 Oct 2026, owner-run): the missing-storage failure was found by the rehearsal and fixed; a manual
  dry run then succeeded and reported 0 closed / 0 deleted (per a summary of the logs; raw rows not seen); the live
  smoke test passed 37 of 37 afterwards.

## NOT verified yet
- **The first run on its own schedule** (10:30 UTC), and the real UPDATE/DELETE statements on Neon.
- SKIP LOCKED under true contention (my test database has one connection).
- The storage account's actual cost.

## Limits
- Finished games' results are not kept; statistics would need a summary row saved before deletion.
- Postgres reuses freed space, but Neon's reported size may not visibly shrink right away.
