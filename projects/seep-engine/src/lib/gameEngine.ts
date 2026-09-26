import { type Card, captureValue, isHouseValue } from './card'
import { createDeck, dealInitialHands, shuffleDeck } from './deck'
import { addCards, hasCard, hasCaptureValue, removeCard } from './hand'
import {
  type FloorItem, type House,
  allCardsOf, canDecomposeIntoExactGroups, findHouseByValue, findItem, findMaximalExactGroups,
  hasAnyLegalCapture, isHouse, isLoose, itemValue, removeItems, sumValues,
} from './floor'
import { type PlayerId, otherPlayer } from './player'
import {
  BAZZI_TARGET, OPENING_SWEEP_BONUS, SWEEP_BONUS,
  cardPoints, qualifyingCardPoints,
} from './scoring'

export type GamePhase =
  | 'bidding'
  | 'opening-move'
  | 'playing'
  | 'hand-over'
  | 'match-over'

export interface HandTotals {
  readonly cardPoints: number
  readonly qualifyingCardPoints: number
  readonly sweepPoints: number
  readonly total: number
}

export interface GameState {
  readonly floor: FloorItem[]
  readonly hands: Record<PlayerId, Card[]>
  readonly captures: Record<PlayerId, Card[]>
  readonly sweepPoints: Record<PlayerId, number>
  readonly matchScores: Record<PlayerId, number>
  readonly bidder: PlayerId
  readonly turn: PlayerId
  readonly phase: GamePhase
  readonly bidValue: number | null
  readonly bidderInitialCards: Card[]
  readonly lastCapturer: PlayerId | null
  readonly cardsPlayedThisHand: number
  readonly totalPlayableThisHand: number
  readonly nextItemId: number
  readonly log: string[]
  readonly winner: PlayerId | null
  readonly lastHandTotals: Record<PlayerId, HandTotals> | null
  readonly misdeals: number
}

const MAX_MISDEAL_ATTEMPTS = 25

function makeId(state: GameState): [string, GameState] {
  return [`f${state.nextItemId}`, { ...state, nextItemId: state.nextItemId + 1 }]
}

function pushLog(state: GameState, message: string): GameState {
  return { ...state, log: [...state.log, message] }
}

export function dealHand(
  bidder: PlayerId,
  matchScores: Record<PlayerId, number> = { player: 0, opponent: 0 },
): GameState {
  let attempt = 0
  let floor: Card[]
  let bidderHand: Card[]
  let otherHand: Card[]

  do {
    const deck = shuffleDeck(createDeck())
    const dealt = dealInitialHands(deck)
    floor = dealt.floor
    bidderHand = dealt.bidderHand
    otherHand = dealt.otherHand
    attempt++
  } while (
    !bidderHand.slice(0, 4).some(c => isHouseValue(captureValue(c))) &&
    attempt < MAX_MISDEAL_ATTEMPTS
  )

  const other = otherPlayer(bidder)
  const state: GameState = {
    floor: floor.map((card, i) => ({ kind: 'loose', id: `f${i}`, card }) as const),
    hands: { [bidder]: bidderHand, [other]: otherHand } as Record<PlayerId, Card[]>,
    captures: { player: [], opponent: [] },
    sweepPoints: { player: 0, opponent: 0 },
    matchScores,
    bidder,
    turn: bidder,
    phase: 'bidding',
    bidValue: null,
    bidderInitialCards: bidderHand.slice(0, 4),
    lastCapturer: null,
    cardsPlayedThisHand: 0,
    totalPlayableThisHand: bidderHand.length + otherHand.length,
    nextItemId: floor.length,
    log: attempt > 1 ? [`Misdealt ${attempt - 1} time(s) — no house card in the first four.`] : [],
    winner: null,
    lastHandTotals: null,
    misdeals: attempt - 1,
  }
  return pushLog(state, `New hand dealt. ${bidder === 'player' ? 'You' : 'Opponent'} must bid.`)
}

export function startMatch(firstBidder: PlayerId = 'player'): GameState {
  return dealHand(firstBidder)
}

export function legalBids(state: GameState): number[] {
  if (state.phase !== 'bidding') return []
  const values = new Set(state.bidderInitialCards.map(captureValue).filter(isHouseValue))
  return [...values].sort((a, b) => a - b)
}

export function placeBid(state: GameState, playerId: PlayerId, value: number): GameState {
  if (state.phase !== 'bidding') throw new Error('Not currently bidding.')
  if (state.turn !== playerId || state.bidder !== playerId) throw new Error('Not your bid.')
  if (!legalBids(state).includes(value)) {
    throw new Error(`${value} is not a legal bid from your first four cards.`)
  }
  return pushLog(
    { ...state, bidValue: value, phase: 'opening-move' },
    `${label(playerId)} bid ${value}.`,
  )
}

function label(id: PlayerId): string {
  return id === 'player' ? 'You' : 'Opponent'
}

function assertTurn(state: GameState, playerId: PlayerId): void {
  if (state.phase !== 'opening-move' && state.phase !== 'playing') {
    throw new Error('No move can be made right now.')
  }
  if (state.turn !== playerId) throw new Error("It's not your turn.")
  if (state.phase === 'opening-move' && state.bidder !== playerId) {
    throw new Error('Only the bidder makes the opening move.')
  }
}

function takeCard(state: GameState, playerId: PlayerId, card: Card): Card[] {
  const hand = state.hands[playerId]
  if (!hasCard(hand, card)) throw new Error('That card is not in hand.')
  return removeCard(hand, card)
}

function isLastPlayOfHand(state: GameState): boolean {
  return state.cardsPlayedThisHand + 1 === state.totalPlayableThisHand
}

function sweepBonusFor(state: GameState): number {
  if (isLastPlayOfHand(state)) return 0
  if (state.cardsPlayedThisHand === 0) return OPENING_SWEEP_BONUS
  return SWEEP_BONUS
}

function computeHandTotals(
  captures: Record<PlayerId, Card[]>,
  sweepPoints: Record<PlayerId, number>,
): Record<PlayerId, HandTotals> {
  const totals = {} as Record<PlayerId, HandTotals>
  for (const p of ['player', 'opponent'] as PlayerId[]) {
    const raw = cardPoints(captures[p])
    const qualifying = qualifyingCardPoints(raw)
    totals[p] = {
      cardPoints: raw,
      qualifyingCardPoints: qualifying,
      sweepPoints: sweepPoints[p],
      total: qualifying + sweepPoints[p],
    }
  }
  return totals
}

function finishMove(
  state: GameState,
  playerId: PlayerId,
  newHand: Card[],
  newFloor: FloorItem[],
  newCaptures: Record<PlayerId, Card[]>,
  newSweepPoints: Record<PlayerId, number>,
  lastCapturer: PlayerId | null,
): GameState {
  const other = otherPlayer(playerId)
  const otherHand = state.hands[other]
  const cardsPlayedThisHand = state.cardsPlayedThisHand + 1
  const handOver = newHand.length === 0 && otherHand.length === 0

  const base: GameState = {
    ...state,
    hands: { ...state.hands, [playerId]: newHand },
    floor: newFloor,
    captures: newCaptures,
    sweepPoints: newSweepPoints,
    lastCapturer: lastCapturer ?? state.lastCapturer,
    cardsPlayedThisHand,
    turn: other,
    phase: 'playing',
  }

  if (!handOver) return base

  let finalCaptures = base.captures
  if (base.floor.length > 0 && base.lastCapturer) {
    const leftover = base.floor.flatMap(item => (isHouse(item) ? item.cards : [item.card]))
    finalCaptures = {
      ...finalCaptures,
      [base.lastCapturer]: [...finalCaptures[base.lastCapturer], ...leftover],
    }
  }

  const totals = computeHandTotals(finalCaptures, base.sweepPoints)
  const matchScores: Record<PlayerId, number> = {
    player: base.matchScores.player + totals.player.total,
    opponent: base.matchScores.opponent + totals.opponent.total,
  }
  const lead = Math.abs(matchScores.player - matchScores.opponent)
  const matchWinner: PlayerId | null =
    lead >= BAZZI_TARGET
      ? matchScores.player > matchScores.opponent ? 'player' : 'opponent'
      : null

  return pushLog(
    {
      ...base,
      floor: [],
      captures: finalCaptures,
      matchScores,
      lastHandTotals: totals,
      phase: matchWinner ? 'match-over' : 'hand-over',
      winner: matchWinner,
    },
    `Hand over. You scored ${totals.player.total}, opponent scored ${totals.opponent.total}.`,
  )
}

export function legalCaptureTargets(state: GameState, card: Card): FloorItem[] {
  const target = captureValue(card)
  const house = findHouseByValue(state.floor, target)
  if (house) return [house]
  return state.floor.filter(isLoose).filter(item => itemValue(item) === target)
}

export function playCapture(
  state: GameState,
  playerId: PlayerId,
  card: Card,
  targetItemIds: string[],
): GameState {
  assertTurn(state, playerId)
  if (state.phase === 'opening-move' && captureValue(card) !== state.bidValue) {
    throw new Error(`Your opening move must use a card matching your bid of ${state.bidValue}.`)
  }
  if (targetItemIds.length === 0) throw new Error('Select at least one card or house to capture.')

  const containsHouse = targetItemIds.some(id => isHouse(findItem(state.floor, id)!))
  if (containsHouse && targetItemIds.length > 1) {
    throw new Error('A house can only be captured on its own, as a single unit.')
  }

  const sum = sumValues(state.floor, targetItemIds)
  const target = captureValue(card)

  if (!containsHouse) {
    // A capture must take every matching group of loose cards at once, not
    // just one — the same way a cemented house holding multiple sets of
    // its value is captured as a single unit regardless of how many sets
    // it contains.
    const maxGroups = findMaximalExactGroups(state.floor, target)
    const maxK = maxGroups.length
    if (maxK > 0) {
      const requiredSum = maxK * target
      if (sum !== requiredSum) {
        throw new Error(
          `A combined capture of ${requiredSum} is available on the floor — you must capture ` +
            `every matching group of ${target} together, not just one.`,
        )
      }
      if (!canDecomposeIntoExactGroups(state.floor, targetItemIds, target, maxK)) {
        throw new Error(`Selected cards don't cleanly split into ${maxK} group(s) of ${target} each.`)
      }
    } else if (sum !== target) {
      throw new Error(`Selected cards total ${sum}, but ${card.face} captures ${target}.`)
    }
  } else if (sum !== target) {
    throw new Error(`Selected cards total ${sum}, but ${card.face} captures ${target}.`)
  }

  const newHand = takeCard(state, playerId, card)
  const capturedCards = allCardsOf(state.floor, targetItemIds)
  const newFloor = removeItems(state.floor, targetItemIds)
  const newCaptures = {
    ...state.captures,
    [playerId]: [...state.captures[playerId], ...capturedCards, card],
  }

  let newSweepPoints = state.sweepPoints
  let sweepMsg = ''
  if (newFloor.length === 0) {
    const bonus = sweepBonusFor(state)
    if (bonus > 0) {
      newSweepPoints = { ...state.sweepPoints, [playerId]: state.sweepPoints[playerId] + bonus }
      sweepMsg = ` Seep! +${bonus}.`
    }
  }

  const next = finishMove(state, playerId, newHand, newFloor, newCaptures, newSweepPoints, playerId)
  return pushLog(next, `${label(playerId)} played ${card.face} of ${card.suit} and captured.${sweepMsg}`)
}

export function playBuildHouse(
  state: GameState,
  playerId: PlayerId,
  card: Card,
  looseItemIds: string[],
  targetValue: number,
): GameState {
  assertTurn(state, playerId)
  if (state.phase === 'opening-move' && targetValue !== state.bidValue) {
    throw new Error(`Your opening house must be built for your bid of ${state.bidValue}.`)
  }
  if (!isHouseValue(targetValue)) throw new Error('House values must be between 9 and 13.')
  if (findHouseByValue(state.floor, targetValue)) {
    throw new Error(`A house of ${targetValue} already exists — add to it instead of building a new one.`)
  }
  const looseItems = looseItemIds.map(id => {
    const item = findItem(state.floor, id)
    if (!item || !isLoose(item)) throw new Error('Selected item is not a loose floor card.')
    return item
  })
  const sum = looseItems.reduce((t, i) => t + captureValue(i.card), 0) + captureValue(card)
  // Founding a house isn't limited to summing to exactly its target value —
  // any combination summing to a positive multiple of the target folds in
  // that many complete sets at once, the same generalization already
  // applied to cementing: a played card plus loose cards that together sum
  // to two or more complete sets of the target value can all combine into
  // one house, already cemented, in a single move.
  if (sum % targetValue !== 0) {
    throw new Error(`Selected cards total ${sum}, not a multiple of your target of ${targetValue}.`)
  }
  const multiple = sum / targetValue

  // Enforced by default for both players: once a target value is chosen,
  // you can't cherry-pick just some of the matching loose cards and leave
  // others behind — every card that could complete another exact-target
  // set alongside the played card must be pulled in too. Choosing a
  // *different* target value entirely remains a free choice.
  const virtualId = '__played-card__'
  const augmentedFloor: FloorItem[] = [...state.floor, { kind: 'loose', id: virtualId, card }]
  const requiredGroups = findMaximalExactGroups(augmentedFloor, targetValue)
  const cardGroup = requiredGroups.find(g => g.includes(virtualId))
  if (cardGroup) {
    const requiredLooseIds = requiredGroups.flat().filter(id => id !== virtualId)
    const requiredSet = new Set(requiredLooseIds)
    const selectedSet = new Set(looseItemIds)
    const matches = requiredSet.size === selectedSet.size && [...requiredSet].every(id => selectedSet.has(id))
    if (!matches) {
      throw new Error(
        `A bigger combined house of ${targetValue} is available on the floor — you must pull in ` +
          `every matching group, not just some of them.`,
      )
    }
  }

  const newHand = takeCard(state, playerId, card)
  if (!hasCaptureValue(newHand, targetValue)) {
    throw new Error(`You need another card worth ${targetValue} left in hand to build this house.`)
  }

  const [houseId, seeded] = makeId(state)
  const house: House = {
    kind: 'house',
    id: houseId,
    cards: [...looseItems.map(i => i.card), card],
    captureValue: targetValue,
    cemented: multiple > 1,
    owners: [playerId],
  }
  const newFloor = [...removeItems(seeded.floor, looseItemIds), house]

  const next = finishMove(seeded, playerId, newHand, newFloor, seeded.captures, seeded.sweepPoints, null)
  const multipleNote = multiple > 1 ? ` (${multiple}\u00d7 its value, already cemented)` : ''
  return pushLog(next, `${label(playerId)} built a house of ${targetValue}${multipleNote}.`)
}

export function playModifyHouse(
  state: GameState,
  playerId: PlayerId,
  card: Card,
  houseId: string,
  extraLooseItemIds: string[] = [],
): GameState {
  assertTurn(state, playerId)
  if (state.phase === 'opening-move') {
    throw new Error('There are no houses on the floor yet to add to.')
  }
  const house = findItem(state.floor, houseId)
  if (!house || !isHouse(house)) throw new Error('That is not a house on the floor.')

  const extraItems = extraLooseItemIds.map(id => {
    const item = findItem(state.floor, id)
    if (!item || !isLoose(item)) throw new Error('Selected item is not a loose floor card.')
    return item
  })
  const addedValue = captureValue(card) + extraItems.reduce((t, i) => t + captureValue(i.card), 0)
  // Cementing isn't limited to a single card that exactly matches the house's
  // value — any combination (this card plus optional loose floor cards) whose
  // sum is a positive multiple of the house's value cements it, adding a full
  // extra "set" of that value into the pile without changing its capture
  // value. A bare single-card exact match is just the simplest case (1x).
  const isMultipleCement = addedValue % house.captureValue === 0

  const newHand = takeCard(state, playerId, card)

  if (isMultipleCement) {
    if (!hasCaptureValue(newHand, house.captureValue)) {
      throw new Error(`You need another card worth ${house.captureValue} left in hand to cement this house.`)
    }
    const cemented: House = {
      ...house,
      cards: [...house.cards, ...extraItems.map(i => i.card), card],
      cemented: true,
      owners: [...new Set([...house.owners, playerId])],
    }
    const newFloor = [...removeItems(state.floor, extraLooseItemIds).filter(i => i.id !== houseId), cemented]
    const next = finishMove(state, playerId, newHand, newFloor, state.captures, state.sweepPoints, null)
    const multiple = addedValue / house.captureValue
    const multipleNote = multiple > 1 ? ` (${multiple}\u00d7 its value)` : ''
    return pushLog(next, `${label(playerId)} cemented the house of ${house.captureValue}${multipleNote}.`)
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
    i => i.id !== houseId && isHouse(i) && i.captureValue === newValue,
  ) as House | undefined

  let newFloor = removeItems(state.floor, [houseId, ...extraLooseItemIds, ...(mergeTarget ? [mergeTarget.id] : [])])
  const grownCards = [...house.cards, ...extraItems.map(i => i.card), card]

  const resultHouse: House = mergeTarget
    ? {
        kind: 'house',
        id: houseId,
        cards: [...grownCards, ...mergeTarget.cards],
        captureValue: newValue,
        cemented: true,
        owners: [...new Set([...house.owners, ...mergeTarget.owners, playerId])],
      }
    : {
        kind: 'house',
        id: houseId,
        cards: grownCards,
        captureValue: newValue,
        cemented: false,
        owners: [playerId],
      }
  newFloor = [...newFloor, resultHouse]

  const next = finishMove(state, playerId, newHand, newFloor, state.captures, state.sweepPoints, null)
  return pushLog(
    next,
    `${label(playerId)} broke the house of ${house.captureValue} up to ${newValue}${mergeTarget ? ' and merged it into a cemented house' : ''}.`,
  )
}

export function playThrow(state: GameState, playerId: PlayerId, card: Card): GameState {
  assertTurn(state, playerId)
  if (state.phase === 'opening-move') {
    if (captureValue(card) !== state.bidValue) {
      throw new Error(`Your opening move must use a card matching your bid of ${state.bidValue}.`)
    }
  } else if (hasAnyLegalCapture(state.floor, card)) {
    throw new Error('You must capture with this card — a capture is available.')
  }

  const newHand = takeCard(state, playerId, card)
  const [itemId, seeded] = makeId(state)
  const newFloor = [...seeded.floor, { kind: 'loose', id: itemId, card } as const]

  const next = finishMove(seeded, playerId, newHand, newFloor, seeded.captures, seeded.sweepPoints, null)
  return pushLog(next, `${label(playerId)} threw down ${card.face} of ${card.suit}.`)
}

export function dealNextHand(state: GameState): GameState {
  if (state.phase !== 'hand-over') throw new Error('The current hand has not finished.')
  return dealHand(otherPlayer(state.bidder), state.matchScores)
}

export { addCards }
