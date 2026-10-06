import type { Queryable } from './db'
import { BadRequestError, HttpError } from './errors'

const MIN_LENGTH = 2
const MAX_LENGTH = 20

/** Letters and digits in any script, combining marks (needed for Gurmukhi, Devanagari, accents), and a few separators. */
const ALLOWED = /^[\p{L}\p{M}\p{N} '._-]+$/u

/**
 * Checks and tidies a name a person wants to be called at the table. It is
 * shown to the people they play with, so it is kept plain: letters and digits
 * in any language (Seep is played in many), spaces, and . - _ ' only. No
 * markup, no links, no invisible characters, no emoji.
 *
 * Throws a 400 with a message fit to show the person.
 */
export function cleanDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') throw new BadRequestError('Your name must be text.')

  // One form for the same text, and no runs of spaces or odd whitespace.
  const name = raw.normalize('NFC').replace(/\s+/gu, ' ').trim()

  const length = Array.from(name).length // characters as a person counts them, not UTF-16 units
  if (length < MIN_LENGTH) throw new BadRequestError(`Your name needs at least ${MIN_LENGTH} characters.`)
  if (length > MAX_LENGTH) throw new BadRequestError(`Your name can have at most ${MAX_LENGTH} characters.`)
  if (!ALLOWED.test(name)) {
    throw new BadRequestError("Your name can use letters, numbers, spaces and . - _ ' only.")
  }
  if (!/[\p{L}\p{N}]/u.test(name)) throw new BadRequestError('Your name needs at least one letter or number.')
  // Stacked accents ("zalgo" text) spill over the lines around it. Real writing never stacks this many.
  // Counted on the decomposed form, where every accent is its own character (composing them hides some).
  if (/\p{M}{4,}/u.test(name.normalize('NFD'))) throw new BadRequestError('Your name has too many accent marks in a row.')
  return name
}

/**
 * 409: somebody else already has that name (or one that counts as the same: case, spaces and . - _ ' are ignored). Carries a few free
 * alternatives so the website can offer them as buttons. It says nothing about who has the name.
 */
export class NameTakenError extends HttpError {
  constructor(readonly suggestions: string[]) {
    super(409, 'That name is already taken.', { code: 'name_taken', suggestions })
    this.name = 'NameTakenError'
  }
}

/** True for the database error that means "the unique index on names refused this" (and not some other unique constraint). */
export function isNameTaken(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; message?: unknown }
  return e.code === '23505' && typeof e.message === 'string' && e.message.includes('users_display_name_key')
}

/**
 * Up to `count` variants of a taken name that are still free ("Alex 2", "Alex 3", ...), checked in ONE query with the very same comparison
 * the unique index uses. The numbers that are already taken are skipped. The name is trimmed first so that "Alex 12" still fits in 20 characters.
 */
export async function freeNameSuggestions(db: Queryable, name: string, count = 3): Promise<string[]> {
  const base = Array.from(name).slice(0, 17).join('').replace(/\s+$/u, '')
  const candidates = Array.from({ length: 12 }, (_, i) => `${base} ${i + 2}`)
  const free = await db.query<{ candidate: string }>(
    `SELECT c.candidate
       FROM unnest($1::text[]) WITH ORDINALITY AS c(candidate, n)
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE display_name IS NOT NULL AND seep_name_key(display_name) = seep_name_key(c.candidate))
      ORDER BY c.n
      LIMIT $2`,
    [candidates, count],
  )
  return free.rows.map((r) => r.candidate)
}
