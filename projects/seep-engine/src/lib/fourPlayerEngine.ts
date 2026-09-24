import { type Card, captureValue, isHouseValue, legalHouseBids } from './card'
import { createDeck, dealFourPlayerHands, shuffleDeck } from './deck'
import { ALL_SEATS, ALL_TEAMS, type SeatId, type TeamId, areTeammates, nextSeat, teamOf } from './seats'
import {
  type FloorItem, type House,
  allCardsOf, findHouseByValue, findItem, hasAnyLegalCapture,
  isHouse, isLoose, itemValue, removeItems, sumValues,
} from './floor'
import { hasCard, hasCaptureValue, removeCard } from './hand'
import {
  OPENING_SWEEP_BONUS, SWEEP_BONUS, type HandSideTotals, checkBazziWinner, computeHandTotals,
} from './scoring'

export type FourPlayerPhase = 'bidding' | 'opening-move' | 'playing' | 'hand-over' | 'match-over'

export interface FourPlayerGameState {
  readonly floor: FloorItem<SeatId>[]
  readonly hands: Record<SeatId, Card[]>
  readonly captures: Record<TeamId, Card[]>
  readonly sweepPoints: Record<TeamId, number>
  readonly matchScores: Record<TeamId, number>
  readonly dealer: SeatId
  readonly bidder: SeatId
  readonly turn: SeatId
  readonly phase: FourPlayerPhase
  readonly bidValue: number | null
  /** The bidder's first four dealt cards — the only cards a bid may be called from (spec §8.3). */
  readonly bidderInitialCards: Card[]
  readonly lastCapturer: TeamId | null
  readonly cardsPlayedThisHand: number
  readonly totalPlayableThisHand: number
  readonly nextItemId: number
  readonly log: string[]
  readonly winner: TeamId | null
  readonly lastHandTotals: Record<TeamId, HandSideTotals> | null
  readonly misdeals: number
}

const MAX_MISDEAL_ATTEMPTS = 25

function emptyRecord<Id extends string, V>(ids: readonly Id[], factory: () => V): Record<Id, V> {
  const out = {} as Record<Id, V>
  for (const id of ids) out[id] = factory()
  return out
}

function pushLog(state: FourPlayerGameState, message: string): FourPlayerGameState {
  return { ...state, log: [...state.log, message] }
}

// ---------------------------------------------------------------------------
// Dealing (spec §8.3)
// ---------------------------------------------------------------------------

/**
 * Deals a fresh four-player hand. The bidder is always the seat after the
 * dealer in turn order. As in the two-player engine, if the bidder's
 * first four cards hold no house-value (9-13) card, it's a misdeal and
 * the whole hand is reshuffled and redealt.
 */
export function dealFourPlayerHand(
  dealer: SeatId,
  matchScores: Record<TeamId, number> = emptyRecord(ALL_TEAMS, () => 0),
): FourPlayerGameState {
  const bidder = nextSeat(dealer)
  let attempt = 0
  let floor: Card[] = []
  let hands: Record<SeatId, Card[]> = emptyRecord(ALL_SEATS, () => [])

  do {
    const deck = shuffleDeck(createDeck())
    const dealt = dealFourPlayerHands(deck, bidder)
    floor = dealt.floor
    hands = dealt.hands
    attempt++
  } while (legalHouseBids(hands[bidder].slice(0, 4)).length === 0 && attempt < MAX_MISDEAL_ATTEMPTS)

  const totalPlayable = ALL_SEATS.reduce((t, s) => t + hands[s].length, 0)

  const state: FourPlayerGameState = {
    floor: floor.map((card, i) => ({ kind: 'loose', id: `f${i}`, card }) as const),
    hands,
    captures: emptyRecord(ALL_TEAMS, () => [] as Card[]),
    sweepPoints: emptyRecord(ALL_TEAMS, () => 0),
    matchScores,
    dealer,
    bidder,
    turn: bidder,
    phase: 'bidding',
    bidValue: null,
    bidderInitialCards: hands[bidder].slice(0, 4),
    lastCapturer: null,
    cardsPlayedThisHand: 0,
    totalPlayableThisHand: totalPlayable,
    nextItemId: floor.length,
    log:
      attempt > 1 ? [`Misdealt ${attempt - 1} time(s) — no house card in the bidder's first four.`] : [],
    winner: null,
    lastHandTotals: null,
    misdeals: attempt - 1,
  }
  return pushLog(state, `New hand dealt. Dealer: ${dealer}. ${bidder} must bid.`)
}

/** Starts a brand-new match. With no explicit dealer, one is chosen at random (spec §8.3). */
export function startFourPlayerMatch(dealer?: SeatId): FourPlayerGameState {
  const firstDealer = dealer ?? ALL_SEATS[Math.floor(Math.random() * ALL_SEATS.length)]!
  return dealFourPlayerHand(firstDealer)
}

/**
 * Deals the next hand once the current one is over. Deal passes to the
 * next seat in turn order (spec §8.3) — the common case for this digital
 * engine, since hands always run to completion rather than ending early.
 */
export function dealNextFourPlayerHand(state: FourPlayerGameState): FourPlayerGameState {
  if (state.phase !== 'hand-over') throw new Error('The current hand has not finished.')
  return dealFourPlayerHand(nextSeat(state.dealer), state.matchScores)
}

// ---------------------------------------------------------------------------
// Bidding (spec §8.4)
// ---------------------------------------------------------------------------

export function legalFourPlayerBids(state: FourPlayerGameState): number[] {
  if (state.phase !== 'bidding') return []
  return legalHouseBids(state.bidderInitialCards)
}

export function placeFourPlayerBid(state: FourPlayerGameState, seat: SeatId, value: number): FourPlayerGameState {
  if (state.phase !== 'bidding') throw new Error('Not currently bidding.')
  if (state.turn !== seat || state.bidder !== seat) throw new Error('Not your bid.')
  if (!legalFourPlayerBids(state).includes(value)) {
    throw new Error(`${value} is not a legal bid from your first four cards.`)
  }
  return pushLog({ ...state, bidValue: value, phase: 'opening-move' }, `${seat} bid ${value}.`)
}

// ---------------------------------------------------------------------------
// Scoring & hand resolution (spec §8.8)
// ---------------------------------------------------------------------------

/**
 * Resolves the end of a hand: leftover floor cards go to the last
 * capturing team, each team's hand totals are computed, match scores
 * accumulate, and a bazzi winner (a 100-point lead) is checked for.
 *
 * This is deliberately decoupled from the turn-by-turn play actions that
 * drive `finalFloor`/`lastCapturer` — those are added in Phase 3 once
 * the team house-ownership rules (spec §8.5) exist, and will call this
 * function once both hands are empty, the same way the two-player
 * engine's finishMove does internally.
 */
export function finishFourPlayerHand(
  state: FourPlayerGameState,
  finalFloor: FloorItem<SeatId>[],
  lastCapturer: TeamId | null,
): FourPlayerGameState {
  let finalCaptures = state.captures
  if (finalFloor.length > 0 && lastCapturer) {
    const leftover = finalFloor.flatMap((item) => (isHouse(item) ? item.cards : [item.card]))
    finalCaptures = {
      ...finalCaptures,
      [lastCapturer]: [...finalCaptures[lastCapturer], ...leftover],
    }
  }

  const totals = {} as Record<TeamId, HandSideTotals>
  for (const team of ALL_TEAMS) {
    totals[team] = computeHandTotals(finalCaptures[team], state.sweepPoints[team])
  }

  const matchScores = {} as Record<TeamId, number>
  for (const team of ALL_TEAMS) {
    matchScores[team] = state.matchScores[team] + totals[team].total
  }

  const winner = checkBazziWinner(matchScores, ALL_TEAMS)

  return pushLog(
    {
      ...state,
      floor: [],
      captures: finalCaptures,
      matchScores,
      lastHandTotals: totals,
      phase: winner ? 'match-over' : 'hand-over',
      winner,
    },
    `Hand over. Team A scored ${totals.teamA.total}, Team B scored ${totals.teamB.total}.`,
  )
}

// ---------------------------------------------------------------------------
// Turn actions (spec §8.5, §8.6) — capture, build, cement/break, throw
// ---------------------------------------------------------------------------

function assertTurn(state: FourPlayerGameState, seat: SeatId): void {
  if (state.phase !== 'opening-move' && state.phase !== 'playing') {
    throw new Error('No move can be made right now.')
  }
  if (state.turn !== seat) throw new Error("It's not your turn.")
  if (state.phase === 'opening-move' && state.bidder !== seat) {
    throw new Error('Only the bidder makes the opening move.')
  }
}

function takeCard(state: FourPlayerGameState, seat: SeatId, card: Card): Card[] {
  const hand = state.hands[seat]
  if (!hasCard(hand, card)) throw new Error('That card is not in hand.')
  return removeCard(hand, card)
}

function isLastPlayOfHand(state: FourPlayerGameState): boolean {
  return state.cardsPlayedThisHand + 1 === state.totalPlayableThisHand
}

function sweepBonusFor(state: FourPlayerGameState): number {
  if (isLastPlayOfHand(state)) return 0
  if (state.cardsPlayedThisHand === 0) return OPENING_SWEEP_BONUS
  return SWEEP_BONUS
}

/**
 * Shared end-of-move bookkeeping: advances the turn to the next seat in
 * rotation, and closes out the hand via finishFourPlayerHand (Phase 2)
 * once every seat has emptied its hand.
 */
function finishMove(
  state: FourPlayerGameState,
  seat: SeatId,
  newHand: Card[],
  newFloor: FloorItem<SeatId>[],
  newCaptures: Record<TeamId, Card[]>,
  newSweepPoints: Record<TeamId, number>,
  lastCapturerTeam: TeamId | null,
): FourPlayerGameState {
  const newHands = { ...state.hands, [seat]: newHand }
  const cardsPlayedThisHand = state.cardsPlayedThisHand + 1
  const allHandsEmpty = ALL_SEATS.every((s) => newHands[s].length === 0)

  const base: FourPlayerGameState = {
    ...state,
    hands: newHands,
    floor: newFloor,
    captures: newCaptures,
    sweepPoints: newSweepPoints,
    lastCapturer: lastCapturerTeam ?? state.lastCapturer,
    cardsPlayedThisHand,
    turn: nextSeat(seat),
    phase: 'playing',
  }

  if (!allHandsEmpty) return base
  return finishFourPlayerHand(base, base.floor, base.lastCapturer)
}

/** Every floor item currently reachable by playing this card, for UI hints. */
export function legalCaptureTargetsFourPlayer(state: FourPlayerGameState, card: Card): FloorItem<SeatId>[] {
  const target = captureValue(card)
  const house = findHouseByValue(state.floor, target)
  if (house) return [house]
  return state.floor.filter(isLoose).filter((item) => itemValue(item) === target)
}

export function playFourPlayerCapture(
  state: FourPlayerGameState,
  seat: SeatId,
  card: Card,
  targetItemIds: string[],
): FourPlayerGameState {
  assertTurn(state, seat)
  if (state.phase === 'opening-move' && captureValue(card) !== state.bidValue) {
    throw new Error(`Your opening move must use a card matching your bid of ${state.bidValue}.`)
  }
  if (targetItemIds.length === 0) throw new Error('Select at least one card or house to capture.')

  const sum = sumValues(state.floor, targetItemIds)
  if (sum !== captureValue(card)) {
    throw new Error(`Selected cards total ${sum}, but ${card.face} captures ${captureValue(card)}.`)
  }
  const containsHouse = targetItemIds.some((id) => isHouse(findItem(state.floor, id)!))
  if (containsHouse && targetItemIds.length > 1) {
    throw new Error('A house can only be captured on its own, as a single unit.')
  }

  const newHand = takeCard(state, seat, card)
  const capturedCards = allCardsOf(state.floor, targetItemIds)
  const newFloor = removeItems(state.floor, targetItemIds)
  // spec §8.5: captured cards are pooled by team, not held per-seat.
  const team = teamOf(seat)
  const newCaptures = {
    ...state.captures,
    [team]: [...state.captures[team], ...capturedCards, card],
  }

  let newSweepPoints = state.sweepPoints
  let sweepMsg = ''
  if (newFloor.length === 0) {
    const bonus = sweepBonusFor(state)
    if (bonus > 0) {
      newSweepPoints = { ...state.sweepPoints, [team]: state.sweepPoints[team] + bonus }
      sweepMsg = ` Sweep! +${bonus} for ${team}.`
    }
  }

  const next = finishMove(state, seat, newHand, newFloor, newCaptures, newSweepPoints, team)
  return pushLog(next, `${seat} played ${card.face} of ${card.suit} and captured.${sweepMsg}`)
}

export function playFourPlayerBuildHouse(
  state: FourPlayerGameState,
  seat: SeatId,
  card: Card,
  looseItemIds: string[],
  targetValue: number,
): FourPlayerGameState {
  assertTurn(state, seat)
  if (state.phase === 'opening-move' && targetValue !== state.bidValue) {
    throw new Error(`Your opening house must be built for your bid of ${state.bidValue}.`)
  }
  if (!isHouseValue(targetValue)) throw new Error('House values must be between 9 and 13.')
  if (findHouseByValue(state.floor, targetValue)) {
    throw new Error(`A house of ${targetValue} already exists — add to it instead of building a new one.`)
  }
  const looseItems = looseItemIds.map((id) => {
    const item = findItem(state.floor, id)
    if (!item || !isLoose(item)) throw new Error('Selected item is not a loose floor card.')
    return item
  })
  const sum = looseItems.reduce((t, i) => t + captureValue(i.card), 0) + captureValue(card)
  if (sum !== targetValue) {
    throw new Error(`Selected cards total ${sum}, not your target of ${targetValue}.`)
  }

  const newHand = takeCard(state, seat, card)
  if (!hasCaptureValue(newHand, targetValue)) {
    throw new Error(`You need another card worth ${targetValue} left in hand to build this house.`)
  }

  const houseId = `f${state.nextItemId}`
  // spec §8.5: a player can only found a house for themselves, never on a teammate's behalf.
  const house: House<SeatId> = {
    kind: 'house',
    id: houseId,
    cards: [...looseItems.map((i) => i.card), card],
    captureValue: targetValue,
    cemented: false,
    owners: [seat],
  }
  const seeded = { ...state, nextItemId: state.nextItemId + 1 }
  const newFloor = [...removeItems(seeded.floor, looseItemIds), house]

  const next = finishMove(seeded, seat, newHand, newFloor, seeded.captures, seeded.sweepPoints, null)
  return pushLog(next, `${seat} built a house of ${targetValue}.`)
}

export function playFourPlayerModifyHouse(
  state: FourPlayerGameState,
  seat: SeatId,
  card: Card,
  houseId: string,
  extraLooseItemIds: string[] = [],
): FourPlayerGameState {
  assertTurn(state, seat)
  if (state.phase === 'opening-move') {
    throw new Error('There are no houses on the floor yet to add to.')
  }
  const house = findItem(state.floor, houseId)
  if (!house || !isHouse(house)) throw new Error('That is not a house on the floor.')

  const extraItems = extraLooseItemIds.map((id) => {
    const item = findItem(state.floor, id)
    if (!item || !isLoose(item)) throw new Error('Selected item is not a loose floor card.')
    return item
  })
  const addedValue = captureValue(card) + extraItems.reduce((t, i) => t + captureValue(i.card), 0)
  const sameValueTopUp = extraItems.length === 0 && captureValue(card) === house.captureValue

  const newHand = takeCard(state, seat, card)

  if (sameValueTopUp) {
    // spec §8.5: adding a same-value card to a partner's cemented (or
    // uncemented) house is free — no reserve card required. Adding to
    // your own house, or an opponent's, still needs one.
    const isPartnersHouse = house.owners.some((owner) => areTeammates(owner, seat))
    if (!isPartnersHouse && !hasCaptureValue(newHand, house.captureValue)) {
      throw new Error(`You need another card worth ${house.captureValue} left in hand to cement this house.`)
    }
    const cemented: House<SeatId> = {
      ...house,
      cards: [...house.cards, card],
      cemented: true,
      owners: [...new Set([...house.owners, seat])],
    }
    const newFloor = state.floor.map((i) => (i.id === houseId ? cemented : i))
    const next = finishMove(state, seat, newHand, newFloor, state.captures, state.sweepPoints, null)
    const freeNote = isPartnersHouse ? " (added freely to your partner's house)" : ''
    return pushLog(next, `${seat} cemented the house of ${house.captureValue}${freeNote}.`)
  }

  // Otherwise this is a "break": the house's value increases.
  // spec §8.5: a player can never break a house they already own.
  if (house.owners.includes(seat)) {
    throw new Error('You cannot break a house you already own — someone else must break it.')
  }
  if (house.cemented) throw new Error('A cemented house cannot be broken.')
  const newValue = house.captureValue + addedValue
  if (!isHouseValue(newValue)) {
    throw new Error(`${newValue} is not a legal house value (must be 9-13).`)
  }
  if (!hasCaptureValue(newHand, newValue)) {
    throw new Error(`You need a card worth ${newValue} left in hand to break this house up to that value.`)
  }

  const mergeTarget = state.floor.find(
    (i) => i.id !== houseId && isHouse(i) && i.captureValue === newValue,
  ) as House<SeatId> | undefined

  let newFloor = removeItems(
    state.floor,
    [houseId, ...extraLooseItemIds, ...(mergeTarget ? [mergeTarget.id] : [])],
  )
  const grownCards = [...house.cards, ...extraItems.map((i) => i.card), card]

  // spec §8.5: breaking transfers ownership to the breaker — unless the new
  // value now matches a house a teammate (or anyone) already owns, in which
  // case the two merge into one cemented, multi-owner house.
  const resultHouse: House<SeatId> = mergeTarget
    ? {
        kind: 'house',
        id: houseId,
        cards: [...grownCards, ...mergeTarget.cards],
        captureValue: newValue,
        cemented: true,
        owners: [...new Set([...house.owners, ...mergeTarget.owners, seat])],
      }
    : {
        kind: 'house',
        id: houseId,
        cards: grownCards,
        captureValue: newValue,
        cemented: false,
        owners: [seat],
      }
  newFloor = [...newFloor, resultHouse]

  const next = finishMove(state, seat, newHand, newFloor, state.captures, state.sweepPoints, null)
  return pushLog(
    next,
    `${seat} broke the house of ${house.captureValue} up to ${newValue}` +
      `${mergeTarget ? ' and merged it into a cemented house' : ''}.`,
  )
}

export function playFourPlayerThrow(state: FourPlayerGameState, seat: SeatId, card: Card): FourPlayerGameState {
  assertTurn(state, seat)
  if (state.phase === 'opening-move') {
    if (captureValue(card) !== state.bidValue) {
      throw new Error(`Your opening move must use a card matching your bid of ${state.bidValue}.`)
    }
  } else if (hasAnyLegalCapture(state.floor, card)) {
    throw new Error('You must capture with this card — a capture is available.')
  }

  const newHand = takeCard(state, seat, card)
  const itemId = `f${state.nextItemId}`
  const seeded = { ...state, nextItemId: state.nextItemId + 1 }
  const newFloor = [...seeded.floor, { kind: 'loose', id: itemId, card } as const]

  const next = finishMove(seeded, seat, newHand, newFloor, seeded.captures, seeded.sweepPoints, null)
  return pushLog(next, `${seat} threw down ${card.face} of ${card.suit}.`)
}
