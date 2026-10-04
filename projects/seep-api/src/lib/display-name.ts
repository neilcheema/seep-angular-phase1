import { BadRequestError } from './errors'

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
