import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DELETED_MARKER_HOURS, cleanupSettings } from '../lib/cleanup'
import { clockSettings } from '../lib/turn-clock'

/**
 * The Privacy Policy and Terms make promises in numbers: how long records are kept, how long the turn clock runs.
 * Those numbers live in the website's legal-config.ts and in the pages' text. If the server's real behaviour is ever
 * changed without the pages being updated, the pages would quietly become untrue, so this test fails instead.
 * (It reads the website's files as text, so it needs the whole repository; on its own, the API project skips it.)
 */
// In the repository this folder sits next to seep-api; `npm test` also runs from the repository root. Try both.
const candidates = [
  resolve(__dirname, '../../../seep-web/src/app/pages/legal'),
  resolve(process.cwd(), 'projects/seep-web/src/app/pages/legal'),
]
const legalDir = candidates.find((dir) => existsSync(resolve(dir, 'legal-config.ts'))) ?? candidates[0]!
const present = existsSync(resolve(legalDir, 'legal-config.ts'))
const read = (name: string) => readFileSync(resolve(legalDir, name), 'utf8')
const numberFor = (text: string, key: string): number => Number(new RegExp(`${key}:\\s*(\\d+)`).exec(text)?.[1])

describe.skipIf(!present)('the legal pages state what the server really does', () => {
  it('say tables are closed after, and deleted after, the same number of days the cleanup uses by default', () => {
    const config = read('legal-config.ts')
    const settings = cleanupSettings({})
    expect(numberFor(config, 'abandonAfterDays')).toBe(settings.abandonAfterDays)
    expect(numberFor(config, 'deleteAfterDays')).toBe(settings.deleteAfterDays)
  })

  it('say a deletion marker is kept for as many hours as the cleanup keeps it', () => {
    expect(numberFor(read('legal-config.ts'), 'deletionMarkerHours')).toBe(DELETED_MARKER_HOURS)
  })

  it('describe the turn clock as it really is: a warning after one minute and a forfeit after two', () => {
    const clock = clockSettings({})
    expect(clock.warnAfterMs).toBe(60_000)
    expect(clock.forfeitAfterMs).toBe(120_000)
    expect(read('terms.component.html')).toMatch(/a warning after one minute, and a forfeit after two/)
  })

  it('read the numbers from the shared configuration, not from typed-in copies that could drift', () => {
    for (const page of ['privacy.component.html', 'terms.component.html']) {
      expect(read(page)).not.toMatch(/\b(?:7|30|48) (?:days|hours)\b/) // these must come from {{ legal.retention… }}
    }
  })
})
