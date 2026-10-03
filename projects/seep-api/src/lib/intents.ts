import { type Card, Face, type Intent, Suit } from 'seep-engine'
import { BadRequestError } from './errors'

/**
 * Structural validation of an intent received from a client.
 *
 * The engine validates the RULES of a move (is it your turn, is that card
 * in your hand, does the capture add up) but trusts the SHAPE: handed a
 * capture with no `card`, it fails deep inside with "Cannot read
 * properties of undefined". That's fine when the only caller is our own
 * UI; it is not fine for a public endpoint. So the server rebuilds every
 * intent from scratch out of validated pieces — nothing from the request
 * body reaches the engine, or the stored move log, except fields checked
 * here. Unknown extra properties are dropped, not passed along.
 */

const FACES: ReadonlySet<string> = new Set(Object.values(Face))
const SUITS: ReadonlySet<string> = new Set(Object.values(Suit))

// A hand has at most 12 cards and the floor never holds more than 52 items;
// these bounds exist to reject absurd payloads, not to encode rules.
const MAX_IDS = 52
const MAX_ID_LENGTH = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCard(raw: unknown, path: string): Card {
  if (!isRecord(raw)) throw new BadRequestError(`${path} must be a card, like {"face":"King","suit":"Spades"}.`)
  const face = raw['face']
  const suit = raw['suit']
  if (typeof face !== 'string' || !FACES.has(face)) throw new BadRequestError(`${path}.face is not a valid card face.`)
  if (typeof suit !== 'string' || !SUITS.has(suit)) throw new BadRequestError(`${path}.suit is not a valid suit.`)
  return { face: face as Face, suit: suit as Suit }
}

function parseIdList(raw: unknown, path: string): string[] {
  if (!Array.isArray(raw)) throw new BadRequestError(`${path} must be a list of item ids.`)
  if (raw.length > MAX_IDS) throw new BadRequestError(`${path} has too many entries.`)
  return raw.map((id, i) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
      throw new BadRequestError(`${path}[${i}] must be a non-empty item id.`)
    }
    return id
  })
}

function parseCount(raw: unknown, path: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 1000) {
    throw new BadRequestError(`${path} must be a whole number.`)
  }
  return raw
}

function parseId(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ID_LENGTH) {
    throw new BadRequestError(`${path} must be an item id.`)
  }
  return raw
}

/** Both game types accept the identical five intent shapes. */
export function parseIntent(raw: unknown): Intent {
  if (!isRecord(raw)) throw new BadRequestError('intent must be an object.')
  switch (raw['type']) {
    case 'bid':
      return { type: 'bid', value: parseCount(raw['value'], 'intent.value') }
    case 'capture':
      return {
        type: 'capture',
        card: parseCard(raw['card'], 'intent.card'),
        targetItemIds: parseIdList(raw['targetItemIds'], 'intent.targetItemIds'),
      }
    case 'build':
      return {
        type: 'build',
        card: parseCard(raw['card'], 'intent.card'),
        looseItemIds: parseIdList(raw['looseItemIds'], 'intent.looseItemIds'),
        targetValue: parseCount(raw['targetValue'], 'intent.targetValue'),
      }
    case 'modify': {
      const extra = raw['extraLooseItemIds']
      return {
        type: 'modify',
        card: parseCard(raw['card'], 'intent.card'),
        houseId: parseId(raw['houseId'], 'intent.houseId'),
        extraLooseItemIds: extra === undefined ? undefined : parseIdList(extra, 'intent.extraLooseItemIds'),
      }
    }
    case 'throw':
      return { type: 'throw', card: parseCard(raw['card'], 'intent.card') }
    default:
      throw new BadRequestError('intent.type must be one of: bid, capture, build, modify, throw.')
  }
}
