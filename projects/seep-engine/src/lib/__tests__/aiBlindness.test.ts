import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card, captureValue } from '../card.ts'
import { findHouseByValue, findMaximalExactGroups } from '../floor.ts'
import { chooseComputerMove, chooseComputerOpeningMove, chooseComputerBid } from '../computer.ts'
import {
  type GameState, dealHand, legalBids, placeBid, playCapture, playThrow,
} from '../gameEngine.ts'
import { SeatId } from '../seats.ts'
import { chooseFourPlayerMove, chooseFourPlayerOpeningMove, chooseFourPlayerBid } from '../computer4p.ts'
import {
  type FourPlayerGameState, dealFourPlayerHand, legalFourPlayerBids,
  placeFourPlayerBid, playFourPlayerCapture, playFourPlayerThrow,
} from '../fourPlayerEngine.ts'

/**
 * This is the actual proof behind the plan's "give the bots the same
 * redacted view" goal: rather than rewiring the AI to take a GameView
 * instead of a GameState (a bigger, riskier change to code already live),
 * swap in a completely different set of cards for every hand the AI
 * can't see, and confirm its decision doesn't change. If a decision ever
 * depended on a hidden hand's contents, it would depend on which of two
 * unrelated card sets got substituted there — which is exactly what a
 * redacted view being all the AI has actually amounts to.
 *
 * Bidding is deliberately not covered here: legalBids/chooseComputerBid
 * (and the four-player equivalents) only ever look at the bidder's own
 * hand by construction — there is no hidden hand involved in bidding to
 * begin with, so there is nothing to prove there. The interesting case is
 * the fair-AI risk logic from a much earlier change (deducedRiskScore,
 * accountedCopies), which reasons from captures and the floor and must
 * never reason from another seat's actual hand.
 *
 * State is always advanced with the real playCapture/playThrow/
 * playFourPlayer* functions here, never hand-rolled — an earlier draft of
 * this file reconstructed state by hand instead, which silently skipped
 * the pendingDeal-merge step and left the "hidden" hand permanently
 * empty, so every comparison below was swapping an empty hand for an
 * empty hand and could never have caught a real leak. Caught only by
 * deliberately injecting a decision-changing leak and checking these
 * tests actually failed — they didn't, which is what exposed the bug.
 */
function swappedDeck(): Card[] {
  const suits = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]
  const faces = [Face.Ace, Face.Two, Face.Three, Face.Four, Face.Five, Face.Six, Face.Seven,
    Face.Eight, Face.Nine, Face.Ten, Face.Jack, Face.Queen, Face.King]
  const deck: Card[] = []
  for (const suit of suits) for (const face of faces) deck.push({ face, suit })
  // A fixed, deterministic re-ordering — not important what it is, only
  // that it differs from whatever hand the real game actually dealt.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (i * 7 + 13) % (i + 1)
    ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
  }
  return deck
}

function decoyHand(exclude: Card[], n: number): Card[] {
  const used = new Set(exclude.map((c) => `${c.face}-${c.suit}`))
  return swappedDeck().filter((c) => !used.has(`${c.face}-${c.suit}`)).slice(0, n)
}

/** Plays whatever card matches `target` (mandatory-maximal capture if one exists, else a throw) via the real engine functions. */
function playToTarget2p(state: GameState, actor: 'player' | 'opponent', card: Card, target: number): GameState {
  const groups = findMaximalExactGroups(state.floor, target)
  const house = findHouseByValue(state.floor, target)
  const ids = house ? [house.id, ...groups.flat()] : groups.flat()
  return ids.length > 0 ? playCapture(state, actor, card, ids) : playThrow(state, actor, card)
}

function playToTarget4p(state: FourPlayerGameState, actor: SeatId, card: Card, target: number): FourPlayerGameState {
  const groups = findMaximalExactGroups(state.floor, target)
  const house = findHouseByValue(state.floor, target)
  const ids = house ? [house.id, ...groups.flat()] : groups.flat()
  return ids.length > 0 ? playFourPlayerCapture(state, actor, card, ids) : playFourPlayerThrow(state, actor, card)
}

describe('the two-player AI\u2019s decisions are invariant to the human\u2019s hidden hand', () => {
  it('opening move: same decision regardless of what the human actually holds', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const dealt = dealHand('opponent', undefined, seed)
      const bid = chooseComputerBid(dealt)
      const staged: GameState = { ...dealt, bidValue: bid, phase: 'opening-move' }
      const decoy: GameState = {
        ...staged,
        hands: { ...staged.hands, player: decoyHand(staged.hands.opponent, staged.hands.player.length) },
      }
      expect(chooseComputerOpeningMove(decoy)).toEqual(chooseComputerOpeningMove(staged))
    }
  })

  it('normal play: same decision regardless of what the human actually holds, across a real played-out hand', () => {
    // The bidder here is the human, not the AI: their opening move is
    // what actually merges pendingDeal into both hands, via the real
    // engine function, so state.hands.player is genuinely populated by
    // the time it becomes the AI's turn.
    for (let seed = 1; seed <= 20; seed++) {
      let state: GameState = dealHand('player', undefined, seed)
      const bidValue = legalBids(state)[0]!
      state = placeBid(state, 'player', bidValue)
      const bidCard = state.hands.player.find((c) => captureValue(c) === bidValue)!
      state = playToTarget2p(state, 'player', bidCard, bidValue)

      if (state.turn !== 'opponent') continue
      const decoy: GameState = {
        ...state,
        hands: { ...state.hands, player: decoyHand(state.hands.player, state.hands.player.length) },
      }
      expect(chooseComputerMove(decoy)).toEqual(chooseComputerMove(state))
    }
  })
})

describe('the four-player AI\u2019s decisions are invariant to every other seat\u2019s hidden hand', () => {
  function decoyOtherHands(state: FourPlayerGameState, actor: SeatId): FourPlayerGameState {
    const used = state.hands[actor]
    return {
      ...state,
      hands: {
        ...state.hands,
        ...Object.fromEntries(
          [SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]
            .filter((s) => s !== actor)
            .map((s) => [s, decoyHand(used, state.hands[s].length)]),
        ),
      },
    }
  }

  it('opening move: same decision regardless of the other three seats\u2019 hidden hands', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const dealt = dealFourPlayerHand(SeatId.P4, undefined, seed)
      const bid = chooseFourPlayerBid(dealt)
      const staged: FourPlayerGameState = { ...dealt, bidValue: bid, phase: 'opening-move' }
      const decoy = decoyOtherHands(staged, staged.bidder)
      expect(chooseFourPlayerOpeningMove(decoy)).toEqual(chooseFourPlayerOpeningMove(staged))
    }
  })

  it('normal play: same decision regardless of the other three seats\u2019 hidden hands, across a real played-out hand', () => {
    for (let seed = 1; seed <= 15; seed++) {
      let state: FourPlayerGameState = dealFourPlayerHand(SeatId.P4, undefined, seed)
      const bidValue = legalFourPlayerBids(state)[0]!
      state = placeFourPlayerBid(state, state.bidder, bidValue)
      const bidder = state.bidder
      const bidCard = state.hands[bidder].find((c) => captureValue(c) === bidValue)!
      state = playToTarget4p(state, bidder, bidCard, bidValue)

      // Everyone now has their real, full hand (the opening move above
      // merged pendingDeal for all four seats). Test whoever's turn it
      // naturally is next.
      const acting = state.turn
      const decoy = decoyOtherHands(state, acting)
      expect(chooseFourPlayerMove(decoy)).toEqual(chooseFourPlayerMove(state))
    }
  })
})
