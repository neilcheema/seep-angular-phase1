import { type Card, captureValue, isHouseValue } from './card'
import { createDeck, dealInitialHands, shuffleDeck } from './deck'
import { addCards, hasCard, hasCaptureValue, removeCard } from './hand'
import { ENGINE_VERSION } from './version'
import {
  type FloorItem,
  type House,
  allCardsOf,
  canSplitIntoSets,
  findHouseByValue,
  findItem,
  findMaximalExactGroups,
  hasAnyLegalCapture,
  isHouse,
  isLoose,
  itemValue,
  removeItems,
  sumValues,
  canDecomposeIntoExactGroups,
  canJoinMaximalGroups,
} from './floor'
import { type PlayerId, otherPlayer } from './player'
import {
  BAZZI_TARGET, OPENING_SWEEP_BONUS, SWEEP_BONUS, type HandRecord,
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
  /**
   * Cards dealt but not yet given to anyone's visible hand — the bidder's
   * remaining cards and the other player's entire hand, held back until
   * the opening move resolves (matching the real dealing procedure: only
   * the bidder's first four cards and the four-card floor are dealt
   * before bidding and the opening move; everything else is dealt right
   * after). Null once the second deal has happened for this hand.
   */
  readonly pendingDeal: Record<PlayerId, Card[]> | null
  readonly lastCapturer: PlayerId | null
  readonly cardsPlayedThisHand: number
  readonly totalPlayableThisHand: number
  readonly nextItemId: number
  readonly log: string[]
  readonly winner: PlayerId | null
  readonly lastHandTotals: Record<PlayerId, HandTotals> | null
  /** Every hand finished so far this match, oldest first. Absent from games dealt before it existed (treat as empty). */
  readonly handHistory?: readonly HandRecord<PlayerId>[]
  readonly misdeals: number
  /** The engine version this game was dealt under — see version.ts. */
  readonly engineVersion: string
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
  seed?: number,
  handHistory: readonly HandRecord<PlayerId>[] = [],
): GameState {
  let attempt = 0
  let floor: Card[]
  let bidderFirstFour: Card[]
  let bidderRest: Card[]
  let otherHand: Card[]

  do {
    // Retries (on a misdeal) stay deterministic too when a seed is given,
    // so the same seed always reproduces the same hand, retries included.
    const deck = shuffleDeck(createDeck(), seed === undefined ? undefined : seed + attempt)
    const dealt = dealInitialHands(deck)
    floor = dealt.floor
    bidderFirstFour = dealt.bidderFirstFour
    bidderRest = dealt.bidderRest
    otherHand = dealt.otherHand
    attempt++
  } while (
    !bidderFirstFour.some(c => isHouseValue(captureValue(c))) &&
    attempt < MAX_MISDEAL_ATTEMPTS
  )

  const other = otherPlayer(bidder)
  const state: GameState = {
    floor: floor.map((card, i) => ({ kind: 'loose', id: `f${i}`, card }) as const),
    hands: { [bidder]: bidderFirstFour, [other]: [] } as Record<PlayerId, Card[]>,
    pendingDeal: { [bidder]: bidderRest, [other]: otherHand } as Record<PlayerId, Card[]>,
    captures: { player: [], opponent: [] },
    sweepPoints: { player: 0, opponent: 0 },
    matchScores,
    bidder,
    turn: bidder,
    phase: 'bidding',
    bidValue: null,
    lastCapturer: null,
    cardsPlayedThisHand: 0,
    totalPlayableThisHand: bidderFirstFour.length + bidderRest.length + otherHand.length,
    nextItemId: floor.length,
    log: attempt > 1 ? [`Misdealt ${attempt - 1} time(s) — no house card in the first four.`] : [],
    winner: null,
    lastHandTotals: null,
    handHistory,
    misdeals: attempt - 1,
    engineVersion: ENGINE_VERSION,
  }
  return pushLog(state, `New hand dealt. ${bidder === 'player' ? 'You' : 'Opponent'} must bid.`)
}

export function startMatch(firstBidder: PlayerId = 'player', seed?: number): GameState {
  return dealHand(firstBidder, { player: 0, opponent: 0 }, seed)
}

export function legalBids(state: GameState): number[] {
  if (state.phase !== 'bidding') return []
  const values = new Set(state.hands[state.bidder].map(captureValue).filter(isHouseValue))
  return [...values].sort((a, b) => a - b)
}

/**
 * Every kind of move a player can make, as one JSON-serializable type —
 * what a future server would actually receive over the wire from a
 * client, instead of the client needing to know which of five
 * differently-shaped functions to call.
 */
export type Intent =
  | { type: 'bid'; value: number }
  | { type: 'capture'; card: Card; targetItemIds: string[] }
  | { type: 'build'; card: Card; looseItemIds: string[]; targetValue: number }
  | { type: 'modify'; card: Card; houseId: string; extraLooseItemIds?: string[] }
  | { type: 'throw'; card: Card }

/**
 * Single entry point for applying a move: routes to
 * placeBid/playCapture/playBuildHouse/playModifyHouse/playThrow based on
 * intent.type. Every one of those functions already validates its own
 * move and throws on anything illegal, so this adds no new validation of
 * its own — it's purely a dispatch, kept as a thin wrapper on purpose so
 * there is only one place the rules actually live.
 */
export function applyMove(state: GameState, playerId: PlayerId, intent: Intent): GameState {
  switch (intent.type) {
    case 'bid':
      return placeBid(state, playerId, intent.value)
    case 'capture':
      return playCapture(state, playerId, intent.card, intent.targetItemIds)
    case 'build':
      return playBuildHouse(state, playerId, intent.card, intent.looseItemIds, intent.targetValue)
    case 'modify':
      return playModifyHouse(state, playerId, intent.card, intent.houseId, intent.extraLooseItemIds)
    case 'throw':
      return playThrow(state, playerId, intent.card)
  }
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
  let finalHand = newHand
  let finalOtherHand = state.hands[other]
  let pendingDeal = state.pendingDeal

  // The opening move completes the staged deal: the bidder's hand (down to
  // whatever they didn't just play) is topped up with the rest of their
  // cards, and the other player receives their full hand for the first
  // time — matching the real dealing procedure (see GameState.pendingDeal).
  if (state.phase === 'opening-move' && pendingDeal) {
    finalHand = [...finalHand, ...pendingDeal[playerId]]
    finalOtherHand = [...finalOtherHand, ...pendingDeal[other]]
    pendingDeal = null
  }

  const cardsPlayedThisHand = state.cardsPlayedThisHand + 1
  const handOver = finalHand.length === 0 && finalOtherHand.length === 0

  const base: GameState = {
    ...state,
    hands: { ...state.hands, [playerId]: finalHand, [other]: finalOtherHand },
    pendingDeal,
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
      handHistory: [...(base.handHistory ?? []), { totals }],
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

  const target = captureValue(card)
  const selectedHouse = targetItemIds.map(id => findItem(state.floor, id)!).find(isHouse)

  // A house's own value must exactly match the played card — it can never
  // be combined arithmetically with other floor items to reach some other
  // sum (a 9-house plus a loose 3 does not make a queen capturable). This
  // is the one thing that never changes about houses.
  if (selectedHouse && selectedHouse.captureValue !== target) {
    throw new Error(
      `A house can only be captured by a card matching its own value of ${selectedHouse.captureValue}.`,
    )
  }

  // Beyond that, a house at exactly the played value and any disjoint loose
  // groups also at that value are independent matches to the same card and
  // must all be captured together — the same maximal-capture principle
  // already applied to multiple loose groups, now covering houses too: a
  // house is simply never allowed to be one of the terms summed together
  // to reach the target — it only ever matches on its own exact value,
  // alongside whatever else also does.
  const houseAtTarget = findHouseByValue(state.floor, target)
  const maxGroups = findMaximalExactGroups(state.floor, target)
  const requiredIds = new Set(houseAtTarget ? [houseAtTarget.id, ...maxGroups.flat()] : maxGroups.flat())

  if (requiredIds.size > 0) {
    const selectedSet = new Set(targetItemIds)
    const matches = requiredIds.size === selectedSet.size && [...requiredIds].every(id => selectedSet.has(id))
    if (!matches) {
      throw new Error(
        `A bigger combined capture of ${target} is available on the floor — you must capture ` +
          `every matching house and group together, not just some of it.`,
      )
    }
  } else {
    const sum = sumValues(state.floor, targetItemIds)
    if (sum !== target) throw new Error(`Selected cards total ${sum}, but ${card.face} captures ${target}.`)
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
  // any combination that splits into complete sets of the target folds in
  // that many complete sets at once, the same generalization already
  // applied to cementing: a played card plus loose cards that together sum
  // to two or more complete sets of the target value can all combine into
  // one house, already cemented, in a single move.
  if (sum % targetValue !== 0) {
    throw new Error(`Selected cards total ${sum}, not a multiple of your target of ${targetValue}.`)
  }
  // The cards must really BE whole sets of the target, not merely a total that divides evenly: 9, 4+5 and 3+6 are three sets of 9, but 11+12+13
  // (36) contains no set of 9 at all, and 10+8 (18) none either.
  if (!canSplitIntoSets([captureValue(card), ...looseItems.map((i) => captureValue(i.card))], targetValue)) {
    throw new Error(`Those cards cannot be split into sets that each add up to ${targetValue}.`)
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
  // The OPENING MOVE differs in one respect only. Every separate group that makes the house must still be taken, none left out, but when several
  // different combinations could make a group (a 2 with either 9, or with an Ace and an Eight, for a house of 11) the bidder may choose any ONE of
  // them. From the second play on the engine's own pick is required, as below.
  if (state.phase === 'opening-move') {
    const groupCount = requiredGroups.length
    if (
      groupCount > 0 &&
      canJoinMaximalGroups(augmentedFloor, virtualId, targetValue, groupCount) &&
      !canDecomposeIntoExactGroups(augmentedFloor, [virtualId, ...looseItemIds], targetValue, groupCount)
    ) {
      throw new Error(
        `A bigger combined house of ${targetValue} is available on the floor — you must pull in ` +
          `every matching group, not just some of them.`,
      )
    }
  }
  if (cardGroup && state.phase !== 'opening-move') {
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
  // cards split into complete sets of the house's value cements it, adding a full
  // extra "set" of that value into the pile without changing its capture
  // value. A bare single-card exact match is just the simplest case (1x).
  const isMultipleCement = canSplitIntoSets([captureValue(card), ...extraItems.map((i) => captureValue(i.card))], house.captureValue)
  if (!isMultipleCement && addedValue % house.captureValue === 0) {
    // A total that divides evenly but is not made of whole sets (11+12+13 onto a house of 9). Breaking the house up cannot be meant either:
    // a house is already 9 or more, so adding a whole multiple of its value would pass 13.
    throw new Error(`Those cards cannot be split into sets that each add up to ${house.captureValue}, so they cannot be added to the house of ${house.captureValue}.`)
  }

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

export function dealNextHand(state: GameState, seed?: number): GameState {
  if (state.phase !== 'hand-over') throw new Error('The current hand has not finished.')
  return dealHand(otherPlayer(state.bidder), state.matchScores, seed, state.handHistory ?? [])
}

/**
 * Ends the match because `loser` ran out of time. This is not a rule of play:
 * it is how a game between two people ends when one of them stops responding
 * (the server's turn clock decides when). The other player wins; scores are
 * left as they stood, and the log says why.
 */
export function forfeitMatch(state: GameState, loser: PlayerId, reason: ForfeitReason = 'timeout'): GameState {
  if (state.phase === 'match-over') throw new Error('The match is already over.')
  return pushLog({ ...state, phase: 'match-over', winner: otherPlayer(loser) }, `${label(loser)} ${forfeitReasonText(reason)}`)
}

/** Why a match was forfeited. 'timeout': the turn clock ran out. 'left': the person left (for example by deleting their account). */
export type ForfeitReason = 'timeout' | 'left'

/** The end of the log sentence, after the player's name. */
export function forfeitReasonText(reason: ForfeitReason): string {
  return reason === 'left' ? 'left the game and forfeited the match.' : 'ran out of time and forfeited the match.'
}

/**
 * What one player is allowed to see — the shape a future server would
 * actually send over the wire. Everything hidden from this player is
 * gone, not merely marked hidden: the opponent's hand becomes a count,
 * and pendingDeal (cards dealt but not yet given to any visible hand)
 * doesn't appear at all, since a client has no legitimate use for it —
 * a player never needs to know how many cards are waiting to be dealt to
 * anyone. nextItemId is dropped too, as pure internal bookkeeping with no
 * meaning to a client.
 */
export interface GameView {
  readonly viewer: PlayerId
  readonly floor: FloorItem[]
  readonly myHand: Card[]
  readonly opponentCardCount: number
  readonly captures: Record<PlayerId, Card[]>
  readonly sweepPoints: Record<PlayerId, number>
  readonly matchScores: Record<PlayerId, number>
  readonly bidder: PlayerId
  readonly turn: PlayerId
  readonly phase: GamePhase
  readonly bidValue: number | null
  readonly lastCapturer: PlayerId | null
  readonly cardsPlayedThisHand: number
  readonly totalPlayableThisHand: number
  readonly log: string[]
  readonly winner: PlayerId | null
  readonly lastHandTotals: Record<PlayerId, HandTotals> | null
  /** Every hand finished so far this match, oldest first. Absent from games dealt before it existed (treat as empty). */
  readonly handHistory?: readonly HandRecord<PlayerId>[]
  readonly misdeals: number
  readonly engineVersion: string
}

export function viewFor(state: GameState, viewer: PlayerId): GameView {
  const opponent = otherPlayer(viewer)
  return {
    viewer,
    floor: state.floor,
    myHand: state.hands[viewer],
    opponentCardCount: state.hands[opponent].length,
    captures: state.captures,
    sweepPoints: state.sweepPoints,
    matchScores: state.matchScores,
    bidder: state.bidder,
    turn: state.turn,
    phase: state.phase,
    bidValue: state.bidValue,
    lastCapturer: state.lastCapturer,
    cardsPlayedThisHand: state.cardsPlayedThisHand,
    totalPlayableThisHand: state.totalPlayableThisHand,
    log: state.log,
    winner: state.winner,
    lastHandTotals: state.lastHandTotals,
    handHistory: state.handHistory ?? [],
    misdeals: state.misdeals,
    engineVersion: state.engineVersion,
  }
}

export { addCards }
