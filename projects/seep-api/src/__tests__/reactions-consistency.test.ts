import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REACTION_CODES } from '../lib/reactions'

/**
 * The server and the website each keep a list of the quick reactions. If one gains or loses a reaction without the other,
 * a button would send a code the server refuses, or a code would arrive that the screen cannot word. This fails instead.
 * (It reads the website's file as text, so it needs the whole repository; on its own the API project skips it.)
 */
const candidates = [resolve(__dirname, '../../../seep-web/src/app/core/reactions.ts'), resolve(process.cwd(), 'projects/seep-web/src/app/core/reactions.ts')]
const file = candidates.find((f) => existsSync(f))

describe.skipIf(!file)('the quick reactions on the server and on the website', () => {
  const codesOnTheWebsite = () => [...readFileSync(file!, 'utf8').matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]!)

  it('are the same list, in the same order', () => {
    expect(codesOnTheWebsite()).toEqual([...REACTION_CODES])
  })

  it('have no free-text option anywhere in the website’s list', () => {
    const text = readFileSync(file!, 'utf8')
    expect(text).not.toMatch(/input|textarea|prompt\(/i)
  })
})
