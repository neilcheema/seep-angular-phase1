import { app, type InvocationContext, type Timer } from '@azure/functions'
import { cleanupSettings, formatSize, runCleanup } from '../lib/cleanup'
import { getDb } from '../lib/db'

/**
 * Runs the daily cleanup (see lib/cleanup.ts). Exported separately from its
 * registration so it can be tested directly. A failure is deliberately NOT
 * caught: it should show up as a failed run in Application Insights.
 */
export async function cleanupHandler(timer: Timer, context: InvocationContext): Promise<void> {
  if (timer.isPastDue) context.log('Cleanup is running late: the app was not running at its scheduled time.')
  const settings = cleanupSettings()
  const result = await runCleanup(getDb(), settings)

  if (result.skipped) {
    context.log('Cleanup is switched off (CLEANUP_ENABLED=false); nothing was done.')
    return
  }
  const verb = result.dryRun ? 'DRY RUN, would have' : 'Cleanup'
  context.log(
    `${verb} closed ${result.abandoned} idle table(s) and deleted ${result.deleted} old table(s) in ${result.batches} batch(es). ` +
      `Database size: ${formatSize(result.sizeBytesBefore)} before, ${formatSize(result.sizeBytesAfter)} after.`,
  )
  if (result.sizeWarning) {
    context.warn(
      `The database is ${formatSize(result.sizeBytesAfter)}, above the ${settings.sizeWarnMb} MB warning level. ` +
        'The Neon Free plan suspends a project that passes 0.5 GB.',
    )
  }
}

// 10:30 UTC every day (about 3:30 in the morning in Victoria), when nobody is playing. Format: second minute hour day month weekday.
app.timer('cleanup', {
  schedule: '0 30 10 * * *',
  handler: cleanupHandler,
})
