import { randomInt } from 'node:crypto'
import { BadRequestError } from './errors'

// No I, O, 0 or 1: a code read aloud or typed from a screenshot shouldn't be ambiguous.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LENGTH = 6
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${INVITE_CODE_LENGTH}}$`)

export function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

/** Accepts what a person might actually type: any case, stray spaces. */
export function normalizeInviteCode(raw: unknown): string {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!CODE_PATTERN.test(code)) throw new BadRequestError("That doesn't look like a game code.")
  return code
}
