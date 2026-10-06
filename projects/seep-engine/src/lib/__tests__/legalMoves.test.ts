import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card, captureValue, isHouseValue } from '../card.ts'
import { chooseComputerBid, chooseComputerMove, chooseComputerOpeningMove } from '../computer.ts'
import type { FloorItem, House } from '../floor.ts'
import { type GameState, type Intent, applyMove, dealNextHand, legalBids, placeBid, startMatch } from '../gameEngine.ts'
import { DEFAULT_MAX_LOOSE_CARDS, legalMoves } from '../moves.ts'
import { isHouse, isLoose } from '../floor.ts'
import { MAX_HOUSE_VALUE, MIN_HOUSE_VALUE } from '../card.ts'
import { ENGINE_VERSION } from '../version.ts'

const card = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, face: Face, suit: Suit): FloorItem => ({ kind: 'loose', id, card: card(face, suit) })
const house = (id: string, value: number, cemented = false): House => ({ kind: 'house', id, cards: [card(Face.Four, Suit.Clubs), card(Face.Five, Suit.Clubs)], captureValue: value, cemented, owners: ['player'] })

function makeState(over: Partial<GameState>): GameState {
  return {
    floor: [],
    hands: { player: [], opponent: [card(Face.Two, Suit.Diamonds)] },
    captures: { player: [], opponent: [] },
    sweepPoints: { player: 0, opponent: 0 },
    matchScores: { player: 0, opponent: 0 },
    bidder: 'player',
    turn: 'player',
    phase: 'playing',
    bidValue: null,
    pendingDeal: null,
    lastCapturer: null,
    cardsPlayedThisHand: 10,
    totalPlayableThisHand: 48,
    nextItemId: 100,
    log: [],
    winner: null,
    lastHandTotals: null,
    misdeals: 0,
    engineVersion: ENGINE_VERSION,
    ...over,
  }
}

const cardKey = (c: Card) => `${c.face}-${c.suit}`
/** One canonical string per move, so lists can be compared whatever the order of ids inside a move. */
function keyOf(i: Intent): string {
  const ids = (xs: string[] | undefined) => [...(xs ?? [])].sort().join(',')
  switch (i.type) {
    case 'throw': return `throw|${cardKey(i.card)}`
    case 'capture': return `capture|${cardKey(i.card)}|${ids(i.targetItemIds)}`
    case 'build': return `build|${cardKey(i.card)}|${ids(i.looseItemIds)}|${i.targetValue}`
    case 'modify': return `modify|${cardKey(i.card)}|${i.houseId}|${ids(i.extraLooseItemIds)}`
    case 'bid': return `bid|${i.value}`
  }
}
/** How many loose cards a build or modify move (in keyOf's format) folds in. Captures and throws use none by this count. */
function looseUsed(key: string): number {
  const parts = key.split('|')
  const ids = key.startsWith('build') ? parts[2] : key.startsWith('modify') ? parts[3] : ''
  return ids ? ids.split(',').length : 0
}
const popcount = (x: number) => { let c = 0; for (; x; x &= x - 1) c++; return c }
const accepted = (state: GameState, who: 'player' | 'opponent', i: Intent): boolean => {
  try {
    applyMove(state, who, i)
    return true
  } catch {
    return false
  }
}

describe('legalMoves: a few positions worked out by hand', () => {
  it('lists the one capture a card must make, never a throw of that card, and a throw of a card that cannot capture', () => {
    const state = makeState({ floor: [loose('a', Face.Nine, Suit.Spades)], hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const keys = legalMoves(state).map(keyOf)
    expect(keys).toContain('capture|Nine-Hearts|a')
    expect(keys).not.toContain('throw|Nine-Hearts') // it must capture
    expect(keys).toContain('throw|Two-Clubs')
  })

  it('lists a house that can be built, and one that cannot', () => {
    // 9 + 4 + 5 = 18 = two sets of 9: building a cemented 9 is legal because a second Nine stays in hand.
    const floor = [loose('a', Face.Four, Suit.Spades), loose('b', Face.Five, Suit.Diamonds)]
    const ok = legalMoves(makeState({ floor, hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })).map(keyOf)
    expect(ok).toContain('build|Nine-Hearts|a,b|9')
    // The same position with only ONE Nine in hand: nothing is left to capture the house with, so the build is not legal.
    const bad = legalMoves(makeState({ floor, hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })).map(keyOf)
    expect(bad.some((k) => k.startsWith('build|Nine-Hearts'))).toBe(false)
  })

  it('lists adding to a house (cementing) and breaking one up, and refuses to break a cemented house', () => {
    const floor = [house('h', 9), loose('a', Face.Two, Suit.Spades)]
    const cement = legalMoves(makeState({ floor, hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })).map(keyOf)
    expect(cement.some((k) => k.startsWith('modify|Nine-Hearts|h|'))).toBe(true)
    // Break the 9 up to an 11 with a Two: legal because a Jack (worth 11) stays in hand to capture it with.
    const withJack = { player: [card(Face.Two, Suit.Hearts), card(Face.Jack, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] }
    expect(legalMoves(makeState({ floor, hands: withJack })).map(keyOf)).toContain('modify|Two-Hearts|h|')
    // The same without a Jack in hand: nothing could capture an 11, so breaking it is not legal.
    const noJack = { player: [card(Face.Two, Suit.Hearts), card(Face.Ten, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] }
    expect(legalMoves(makeState({ floor, hands: noJack })).map(keyOf).some((k) => k.startsWith('modify|Two-Hearts'))).toBe(false)
    // A CEMENTED house can never be broken.
    const cemented = [house('h', 9, true), loose('a', Face.Two, Suit.Spades)]
    expect(legalMoves(makeState({ floor: cemented, hands: withJack })).map(keyOf).some((k) => k.startsWith('modify|Two-Hearts'))).toBe(false)
  })

  it('is empty when it is not that player’s turn, or the game is in another phase', () => {
    const base = { hands: { player: [card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } }
    expect(legalMoves(makeState({ ...base, turn: 'opponent' }), 'player')).toEqual([])
    expect(legalMoves(makeState({ ...base, phase: 'bidding' }))).toEqual([])
    expect(legalMoves(makeState({ ...base, phase: 'hand-over' }))).toEqual([])
    expect(legalMoves(makeState({ ...base, phase: 'match-over' }))).toEqual([])
  })

  it('in the opening move, lists only moves that match the bid', () => {
    const state = makeState({
      phase: 'opening-move', bidValue: 9, floor: [loose('a', Face.Four, Suit.Spades), loose('b', Face.Five, Suit.Diamonds)],
      hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Clubs), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] },
    })
    const keys = legalMoves(state).map(keyOf)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((k) => k.includes('Nine'))).toBe(true) // a Two cannot be used for the opening move
    expect(keys.some((k) => k.startsWith('modify'))).toBe(false) // and there is nothing to add to
  })
})

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The first, slow, obviously-correct version of the lister: try every candidate whose card totals could work and ask the engine about each
 * one, with no shortcuts at all. legalMoves now takes shortcuts to be fast, so on bigger floors (too big for a brute-force search of EVERY
 * possible move) it is compared with this.
 */
function referenceLegalMoves(state: GameState, cap: number): Intent[] {
  const loose = state.floor.filter(isLoose)
  const houses = state.floor.filter(isHouse)
  const n = loose.length
  const out: Intent[] = []
  for (const c of state.hands.player) {
    out.push({ type: 'throw', card: c })
    out.push({ type: 'capture', card: c, targetItemIds: [] }) // replaced below by the required set when there is one
    for (let mask = 0; mask < 1 << n; mask++) {
      if (popcount(mask) > cap) continue
      let total = captureValue(c)
      const ids: string[] = []
      for (let i = 0; i < n; i++) if (mask & (1 << i)) { total += captureValue(loose[i]!.card); ids.push(loose[i]!.id) }
      for (let t = MIN_HOUSE_VALUE; t <= MAX_HOUSE_VALUE; t++) if (total % t === 0) out.push({ type: 'build', card: c, looseItemIds: ids, targetValue: t })
      for (const h of houses) out.push({ type: 'modify', card: c, houseId: h.id, extraLooseItemIds: ids })
    }
    // every way of selecting floor items to capture is too many for a big floor; the capture a card must make is exactly the engine's rule
    for (let m = 1; m < 1 << state.floor.length; m++) out.push({ type: 'capture', card: c, targetItemIds: state.floor.filter((_, i) => m & (1 << i)).map((x) => x.id) })
  }
  return out.filter((i) => accepted(state, 'player', i))
}

describe('legalMoves is COMPLETE: it misses nothing the engine would accept', () => {
  it('agrees with the original slow lister on bigger floors (6 to 8 loose cards), where the shortcuts matter most', () => {
    const rand = mulberry32(777)
    const faces2 = Object.values(Face), suits2 = Object.values(Suit)
    let compared = 0, builds = 0
    for (let n = 0; n < 40; n++) {
      const deck = suits2.flatMap((su) => faces2.map((f) => card(f, su)))
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j]!, deck[i]!] }
      const handSize = 4 + Math.floor(rand() * 5)
      const looseCount = 6 + Math.floor(rand() * 3)
      const floor: FloorItem[] = deck.slice(handSize, handSize + looseCount).map((c, i) => ({ kind: 'loose', id: `L${i}`, card: c }))
      const hv = [9, 10, 11, 12, 13].sort(() => rand() - 0.5).slice(0, Math.floor(rand() * 3))
      hv.forEach((v, i) => floor.push(house(`H${i}`, v, rand() < 0.3)))
      const state = makeState({ floor, hands: { player: deck.slice(0, handSize), opponent: [card(Face.Two, Suit.Diamonds)] } })
      const got = new Set(legalMoves(state).map(keyOf))
      expect(got, `sample ${n} (default limit)`).toEqual(new Set(referenceLegalMoves(state, DEFAULT_MAX_LOOSE_CARDS).map(keyOf)))
      const exact = new Set(legalMoves(state, 'player', { maxLooseCards: 99 }).map(keyOf))
      expect(exact, `sample ${n} (no limit)`).toEqual(new Set(referenceLegalMoves(state, 99).map(keyOf)))
      compared++
      builds += [...got].filter((k) => k.startsWith('build')).length
    }
    expect(compared).toBe(40)
    expect(builds).toBeGreaterThan(15) // builds are what the shortcuts touch most, so the comparison must have met some
  }, 120_000)

  const faces = Object.values(Face)
  const suits = Object.values(Suit)

  it('equals a brute-force search of every possible move, over many random positions', () => {
    const rand = mulberry32(61006)
    const counts = { positions: 0, capture: 0, build: 0, modify: 0, throw: 0, opening: 0, capEngaged: 0 }
    for (let n = 0; n < 110; n++) {
      const deck = suits.flatMap((s) => faces.map((f) => card(f, s)))
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
      }
      const handSize = 2 + Math.floor(rand() * 4)
      const looseCount = 1 + Math.floor(rand() * 5)
      const hand = deck.slice(0, handSize)
      const floor: FloorItem[] = deck.slice(handSize, handSize + looseCount).map((c, i) => ({ kind: 'loose', id: `L${i}`, card: c }))
      const houseValues = [9, 10, 11, 12, 13].sort(() => rand() - 0.5).slice(0, Math.floor(rand() * 3))
      houseValues.forEach((v, i) => floor.push(house(`H${i}`, v, rand() < 0.3)))
      const houseOptions = hand.map(captureValue).filter(isHouseValue)
      const opening = rand() < 0.2 && houseOptions.length > 0
      const state = makeState({ floor, hands: { player: hand, opponent: [card(Face.Two, Suit.Diamonds)] }, ...(opening ? { phase: 'opening-move' as const, bidValue: houseOptions[0]! } : {}) })

      // Brute force: every capture selection, every build (any subset, any value 1 to 20), every modify (any subset), every throw.
      const looseIds = floor.filter((i) => i.kind === 'loose').map((i) => i.id)
      const allIds = floor.map((i) => i.id)
      const everything: Intent[] = []
      for (const c of hand) {
        everything.push({ type: 'throw', card: c })
        for (let m = 1; m < 1 << allIds.length; m++) everything.push({ type: 'capture', card: c, targetItemIds: allIds.filter((_, i) => m & (1 << i)) })
        for (let m = 0; m < 1 << looseIds.length; m++) {
          const ids = looseIds.filter((_, i) => m & (1 << i))
          for (let v = 1; v <= 20; v++) everything.push({ type: 'build', card: c, looseItemIds: ids, targetValue: v })
          for (const h of floor.filter((i) => i.kind === 'house')) everything.push({ type: 'modify', card: c, houseId: h.id, extraLooseItemIds: ids })
        }
      }
      const expected = new Set(everything.filter((i) => accepted(state, 'player', i)).map(keyOf))
      const got = legalMoves(state, 'player', { maxLooseCards: 99 }) // no limit: must equal the brute-force search exactly
      const gotKeys = got.map(keyOf)
      expect(new Set(gotKeys).size, `sample ${n}: no move is listed twice`).toBe(gotKeys.length)
      expect(new Set(gotKeys), `sample ${n}: hand ${hand.map(cardKey)} floor ${floor.map((i) => i.id + ':' + (i.kind === 'house' ? 'H' + i.captureValue : cardKey(i.card)))}`).toEqual(expected)
      for (const cap of [DEFAULT_MAX_LOOSE_CARDS, 1]) {
        const capped = new Set([...expected].filter((k) => looseUsed(k) <= cap))
        expect(new Set(legalMoves(state, 'player', { maxLooseCards: cap }).map(keyOf)), `sample ${n}: with a limit of ${cap} loose card(s)`).toEqual(capped)
        if (cap === 1 && capped.size < expected.size) counts.capEngaged++
      }

      counts.positions++
      if (opening) counts.opening++
      for (const i of got) counts[i.type === 'bid' ? 'throw' : i.type]++
    }
    // The comparison only means something if it met every kind of move.
    expect(counts.capture).toBeGreaterThan(20)
    expect(counts.build).toBeGreaterThan(10)
    expect(counts.modify).toBeGreaterThan(5)
    expect(counts.throw).toBeGreaterThan(100)
    expect(counts.opening).toBeGreaterThan(5)
    expect(counts.capEngaged).toBeGreaterThan(5) // the limit really did remove moves in some positions, so the capped comparison means something
  }, 120_000)

  it('always lists the move the computer player chooses, and always lists at least one move, across whole simulated games', () => {
    const seen = { moves: 0, computerTurns: 0, build: 0, capture: 0, throw: 0, modify: 0, hiddenByLimit: 0 }
    for (let g = 0; g < 80; g++) {
      const rand = mulberry32(900 + g)
      let s = startMatch(g % 2 === 0 ? 'player' : 'opponent', 4000 + g)
      for (let step = 0; step < 400 && s.phase !== 'match-over'; step++) {
        if (s.phase === 'hand-over') {
          if (g % 3 === 0) break // most games stop after one hand; some play on
          s = dealNextHand(s, 7000 + g)
          continue
        }
        if (s.phase === 'bidding') {
          s = placeBid(s, s.bidder, s.bidder === 'opponent' ? chooseComputerBid(s) : legalBids(s)[0]!)
          continue
        }
        const moves = legalMoves(s, s.turn, { maxLooseCards: 99 })
        expect(moves.length, `game ${g} step ${step}: the player to move always has a move`).toBeGreaterThan(0)
        for (const m of moves) seen[m.type === 'bid' ? 'throw' : m.type]++
        if (s.turn === 'opponent') {
          const action = s.phase === 'opening-move' ? chooseComputerOpeningMove(s) : chooseComputerMove(s)
          const { reason, ...intent } = action // the computer explains itself in `reason`; the move is the rest
          void reason
          seen.computerTurns++
          expect(moves.map(keyOf), `game ${g} step ${step}: the computer's choice (${action.type}) is in the list`).toContain(keyOf(intent as Intent))
          if (looseUsed(keyOf(intent as Intent)) > DEFAULT_MAX_LOOSE_CARDS) seen.hiddenByLimit++
          s = applyMove(s, 'opponent', intent as Intent)
        } else {
          s = applyMove(s, 'player', moves[Math.floor(rand() * moves.length)]!)
        }
        seen.moves++
      }
    }
    expect(seen.computerTurns).toBeGreaterThan(300)
    expect(seen.capture).toBeGreaterThan(300)
    expect(seen.throw).toBeGreaterThan(300)
    expect(seen.build).toBeGreaterThan(20)
    // How much does the default limit cost in real play? The computer's own choice would be hidden by it only this rarely.
    expect(seen.hiddenByLimit / seen.computerTurns).toBeLessThan(0.02)
  }, 120_000)
})

describe('legalMoves with a time budget', () => {
  /** A crowded position: a full 12-card hand and ten loose cards, which has over a thousand legal builds and house changes. */
  function crowded(): GameState {
    const faces = Object.values(Face)
    const suits = Object.values(Suit)
    const deck = suits.flatMap((su) => faces.map((f) => card(f, su)))
    const floor: FloorItem[] = deck.slice(12, 22).map((c, i) => ({ kind: 'loose', id: `L${i}`, card: c }))
    floor.push(house('H1', 10))
    return makeState({ floor, hands: { player: deck.slice(0, 12), opponent: [card(Face.Two, Suit.Diamonds)] } })
  }
  const kind = (k: string) => k.split('|')[0]!

  it('always returns every capture and every throw, even with no time at all', () => {
    const state = crowded()
    const exact = legalMoves(state, 'player', { budgetMs: undefined, maxLooseCards: 2 }).map(keyOf)
    const none = legalMoves(state, 'player', { budgetMs: 0, maxLooseCards: 2 }).map(keyOf)
    const simple = (keys: string[]) => keys.filter((k) => kind(k) === 'capture' || kind(k) === 'throw').sort()
    expect(simple(none)).toEqual(simple(exact))
    expect(simple(none).length).toBeGreaterThan(0)
  })

  it('keeps every THROW too, with no time at all, on a position that really has throws (the crowded one has none)', () => {
    // A floor of Kings, Queens and Jacks only: no small card can capture anything, so they can all be thrown.
    const suits2 = Object.values(Suit)
    const high: FloorItem[] = [...suits2.map((su) => card(Face.King, su)), ...suits2.map((su) => card(Face.Queen, su)), card(Face.Jack, Suit.Spades), card(Face.Jack, Suit.Hearts)].map((c, i) => ({ kind: 'loose', id: `L${i}`, card: c }))
    high.push(house('H1', 10))
    const hand = [...Object.values(Face).slice(0, 10).map((f) => card(f, Suit.Spades)), card(Face.Jack, Suit.Clubs), card(Face.Jack, Suit.Diamonds)]
    const state = makeState({ floor: high, hands: { player: hand, opponent: [card(Face.Two, Suit.Diamonds)] } })
    const exact = legalMoves(state, 'player', { maxLooseCards: 2 }).map(keyOf)
    const throws = exact.filter((k) => kind(k) === 'throw')
    expect(throws.length).toBeGreaterThan(5) // the position must really offer throws, or this test proves nothing
    expect(exact.filter((k) => kind(k) === 'capture').length).toBeGreaterThan(0)
    const none = legalMoves(state, 'player', { maxLooseCards: 2, budgetMs: 0 }).map(keyOf)
    expect(none.filter((k) => kind(k) === 'throw').sort()).toEqual(throws.sort())
    expect(none.filter((k) => kind(k) === 'capture').sort()).toEqual(exact.filter((k) => kind(k) === 'capture').sort())
  })

  it('only ever returns moves from the full list (nothing illegal appears because time ran out), and more time never loses a move', () => {
    const state = crowded()
    const full = new Set(legalMoves(state, 'player', { maxLooseCards: 3 }).map(keyOf))
    let previous = new Set<string>()
    for (const budgetMs of [0, 1, 5, 50]) {
      const got = new Set(legalMoves(state, 'player', { maxLooseCards: 3, budgetMs }).map(keyOf))
      for (const k of got) expect(full.has(k), `budget ${budgetMs} listed a move the full list does not have: ${k}`).toBe(true)
      for (const k of previous) expect(got.has(k) || budgetMs === 0, `more time lost ${k}`).toBe(true)
      previous = got
    }
  })

  it('given plenty of time, returns exactly the same as no limit at all', () => {
    const state = crowded()
    const noLimit = legalMoves(state, 'player', { maxLooseCards: 2 }).map(keyOf).sort()
    expect(legalMoves(state, 'player', { maxLooseCards: 2, budgetMs: 600_000 }).map(keyOf).sort()).toEqual(noLimit)
  })

  it('lists captures and throws first, then builds and house changes using the fewest loose cards first', () => {
    const keys = legalMoves(crowded(), 'player', { maxLooseCards: 3 }).map(keyOf)
    const firstOptional = keys.findIndex((k) => kind(k) === 'build' || kind(k) === 'modify')
    expect(firstOptional).toBeGreaterThan(0)
    expect(keys.slice(0, firstOptional).every((k) => kind(k) === 'capture' || kind(k) === 'throw')).toBe(true)
    const sizes = keys.slice(firstOptional).map(looseUsed)
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
  })

  it('stays responsive on a position that takes seconds without a limit (the reason the limit exists)', () => {
    const state = crowded()
    const started = Date.now()
    const got = legalMoves(state, 'player', { budgetMs: 100 })
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(1500) // 100 ms of budget, plus the one move it was confirming when time ran out, with a wide margin for a slow machine
    expect(got.length).toBeGreaterThan(10)
  })
})
