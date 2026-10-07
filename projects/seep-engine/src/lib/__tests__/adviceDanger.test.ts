import { describe, expect, it } from 'vitest'
import { type Danger, type MoveFacts, NO_DANGER, adviseMoves, moveFacts, rankMoves, scoreFacts, standInState, unseenCards } from '../advice.ts'
import { Face, Suit, type Card } from '../card.ts'
import { chooseComputerBid, chooseComputerMove, chooseComputerOpeningMove } from '../computer.ts'
import { createDeck } from '../deck.ts'
import { type FloorItem, requiredCaptureIds } from '../floor.ts'
import { type GameState, type Intent, applyMove, dealNextHand, legalBids, placeBid, startMatch, viewFor } from '../gameEngine.ts'
import { legalMoves } from '../moves.ts'
import { cardPoints } from '../scoring.ts'
import { ENGINE_VERSION } from '../version.ts'

const card = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, face: Face, suit: Suit): FloorItem => ({ kind: 'loose', id, card: card(face, suit) })
const key = (c: Card) => `${c.face}|${c.suit}`
function keyOf(i: Intent): string {
  const ids = (xs: string[] | undefined) => [...(xs ?? [])].sort().join(',')
  switch (i.type) {
    case 'throw': return `throw|${key(i.card)}`
    case 'capture': return `capture|${key(i.card)}|${ids(i.targetItemIds)}`
    case 'build': return `build|${key(i.card)}|${ids(i.looseItemIds)}|${i.targetValue}`
    case 'modify': return `modify|${key(i.card)}|${i.houseId}|${ids(i.extraLooseItemIds)}`
    case 'bid': return `bid|${i.value}`
  }
}

/**
 * A complete, consistent game position in ordinary play: every one of the 52 cards is somewhere. Whatever is not in either hand or on the floor
 * is put in the opponent's pile of captures (where anyone can see it), so what the viewer cannot see is EXACTLY the opponent's hand, as in a real game.
 */
function position(opts: { floor: FloorItem[]; mine: Card[]; theirs: Card[]; played?: number; total?: number }): GameState {
  const used = new Set([...opts.mine, ...opts.theirs, ...opts.floor.flatMap((i) => (i.kind === 'house' ? i.cards : [i.card]))].map(key))
  return {
    floor: opts.floor, hands: { player: opts.mine, opponent: opts.theirs },
    captures: { player: [], opponent: createDeck().filter((c) => !used.has(key(c))) },
    sweepPoints: { player: 0, opponent: 0 }, matchScores: { player: 0, opponent: 0 }, bidder: 'player', turn: 'player', phase: 'playing', bidValue: null,
    pendingDeal: null, lastCapturer: null, cardsPlayedThisHand: opts.played ?? 10, totalPlayableThisHand: opts.total ?? 48, nextItemId: 100, log: [], winner: null,
    lastHandTotals: null, misdeals: 0, engineVersion: ENGINE_VERSION,
  }
}
function mulberry32(seed: number): () => number {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function forEachHumanTurn(games: number, visit: (s: GameState) => void): number {
  let visited = 0
  for (let g = 0; g < games; g++) {
    const rand = mulberry32(52000 + g)
    let s = startMatch(g % 2 === 0 ? 'player' : 'opponent', 7000 + g)
    for (let step = 0; step < 400 && s.phase !== 'match-over'; step++) {
      if (s.phase === 'hand-over') { if (g % 3 === 0) break; s = dealNextHand(s, 9500 + g); continue }
      if (s.phase === 'bidding') { s = placeBid(s, s.bidder, s.bidder === 'opponent' ? chooseComputerBid(s) : legalBids(s)[0]!); continue }
      if (s.turn === 'player') {
        visit(s); visited++
        const moves = legalMoves(s, 'player', { maxLooseCards: 99 })
        s = applyMove(s, 'player', moves[Math.floor(rand() * moves.length)]!)
      } else {
        const action = s.phase === 'opening-move' ? chooseComputerOpeningMove(s) : chooseComputerMove(s)
        const { reason, ...intent } = action
        void reason
        s = applyMove(s, 'opponent', intent as Intent)
      }
    }
  }
  return visited
}

describe('counting the cards you cannot see', () => {
  it('shows EXACTLY the opponent’s hand in ordinary play, at every turn of 60 simulated games', () => {
    let known = 0
    let guessed = 0
    forEachHumanTurn(60, (s) => {
      const view = viewFor(s, 'player')
      const unseen = unseenCards(view)
      if (s.phase === 'playing') {
        expect(unseen.known, 'ordinary play').toBe(true)
        expect(unseen.cards.map(key).sort(), 'what counting finds is what the opponent really holds').toEqual(s.hands.opponent.map(key).sort())
        known++
      } else {
        expect(unseen.known, `${s.phase}: cards are still to be dealt`).toBe(false)
        guessed++
      }
    })
    expect(known).toBeGreaterThan(1500)
    expect(guessed).toBeGreaterThan(10)
  }, 120_000)
})

describe('the danger the coach measures matches what the real engine does', () => {
  it('for every legal move: the points and the Seep the opponent could win, checked by really playing every capture the opponent holds', () => {
    let moves = 0
    let seeps = 0
    let withPoints = 0
    forEachHumanTurn(30, (s) => {
      if (s.phase !== 'playing') return
      const view = viewFor(s, 'player')
      const stand = standInState(view)
      const opponent = unseenCards(view)
      for (const intent of legalMoves(s, 'player', { maxLooseCards: 3 })) {
        const afterReal = applyMove(s, 'player', intent)
        if (afterReal.phase !== 'playing' || afterReal.turn !== 'opponent') continue // my move ended the hand: nothing for them to take
        let bestPoints = 0
        let seep = false
        let takesMine = false
        for (const c of afterReal.hands.opponent) {
          const ids = requiredCaptureIds(afterReal.floor, c)
          if (ids.length === 0) continue
          const reply = applyMove(afterReal, 'opponent', { type: 'capture', card: c, targetItemIds: ids })
          const taken = reply.captures.opponent.slice(afterReal.captures.opponent.length).filter((x) => key(x) !== key(c))
          bestPoints = Math.max(bestPoints, cardPoints(taken))
          if (reply.sweepPoints.opponent > afterReal.sweepPoints.opponent) seep = true
          if (taken.some((x) => key(x) === key((intent as { card: Card }).card))) takesMine = true
        }
        const danger = (moveFacts(view, stand, intent, opponent) as { danger: Danger }).danger
        expect(danger.basis).toBe('known')
        expect(danger.points, `${keyOf(intent)}: points`).toBe(bestPoints)
        expect(danger.seep, `${keyOf(intent)}: seep`).toBe(seep)
        expect(danger.takesYourCard, `${keyOf(intent)}: takes your card`).toBe(takesMine)
        moves++
        if (seep) seeps++
        if (bestPoints > 0) withPoints++
      }
    })
    expect(moves).toBeGreaterThan(1200)
    expect(seeps).toBeGreaterThan(5) // the comparison met real Seeps, and real point losses,
    expect(withPoints).toBeGreaterThan(100) // not just quiet positions
  }, 280_000)
})

describe('the position from the screenshot: only a Jack on the floor, a bid of 13', () => {
  // I hold three Tens, two Kings and a Two. The opponent holds the one remaining King, the one remaining Ten, and a few small cards.
  const mine = [card(Face.Two, Suit.Hearts), card(Face.Ten, Suit.Clubs), card(Face.Ten, Suit.Diamonds), card(Face.Ten, Suit.Spades), card(Face.King, Suit.Diamonds), card(Face.King, Suit.Clubs)]
  const floor = [loose('j', Face.Jack, Suit.Hearts)]
  const withKing = position({ floor, mine, theirs: [card(Face.King, Suit.Spades), card(Face.Ten, Suit.Hearts), card(Face.Four, Suit.Clubs), card(Face.Six, Suit.Diamonds)] })
  const noKing = position({ floor, mine, theirs: [card(Face.Queen, Suit.Hearts), card(Face.Ten, Suit.Hearts), card(Face.Four, Suit.Clubs), card(Face.Six, Suit.Diamonds)] })
  const twoPlusJack = 'build|Two|Hearts|j|13'
  const find = (s: GameState, k: string) => rankMoves(viewFor(s, 'player')).find((a) => keyOf(a.intent).replace('-', '|') === k || keyOf(a.intent) === k)

  it('counts exactly what the opponent holds', () => {
    const un = unseenCards(viewFor(withKing, 'player'))
    expect(un.known).toBe(true)
    expect(un.cards.map(key).sort()).toEqual(withKing.hands.opponent.map(key).sort())
  })

  it('building the Two and the Jack into a 13 would leave the house alone on the floor, so the King the opponent holds clears it: a Seep', () => {
    const house = rankMoves(viewFor(withKing, 'player')).find((a) => a.intent.type === 'build' && a.intent.card.face === Face.Two)!
    expect(house).toBeDefined()
    const d = (house.facts as { danger: Danger }).danger
    expect([d.basis, d.seep, d.takesYourCard, d.byValue]).toEqual(['known', true, true, 13])
  })

  it('the builds that keep the Jack on the floor are not Seeps, but the opponent can still take the house', () => {
    const ranked = rankMoves(viewFor(withKing, 'player'))
    const ten = ranked.find((a) => a.intent.type === 'build' && a.intent.card.face === Face.Ten && a.intent.card.suit === Suit.Clubs)!
    const dt = (ten.facts as { danger: Danger }).danger
    expect([dt.seep, dt.takesYourCard, dt.byValue]).toEqual([false, true, 10])
    const king = ranked.find((a) => a.intent.type === 'build' && a.intent.card.face === Face.King && a.intent.card.suit === Suit.Diamonds)!
    expect([(king.facts as { danger: Danger }).danger.seep, (king.facts as { danger: Danger }).danger.takesYourCard]).toEqual([false, true])
  })

  it('so a safe throw is among the suggestions, and ranks above each of those builds', () => {
    const top = adviseMoves(viewFor(withKing, 'player'))
    expect(top.some((a) => a.intent.type === 'throw')).toBe(true)
    expect(top[0]!.intent.type).toBe('throw')
    const ranked = rankMoves(viewFor(withKing, 'player'))
    const throwAt = ranked.findIndex((a) => a.intent.type === 'throw')
    for (const a of ranked.filter((a) => a.intent.type === 'build')) expect(ranked.indexOf(a)).toBeGreaterThan(throwAt)
    // the 13 that would hand over a Seep is nowhere near the top
    expect(top.some((a) => a.intent.type === 'build' && a.intent.card.face === Face.Two)).toBe(false)
  })

  it('the same position when the opponent does NOT hold the King: that very house is safe, and is recommended', () => {
    const house = rankMoves(viewFor(noKing, 'player')).find((a) => a.intent.type === 'build' && a.intent.card.face === Face.Two)!
    const d = (house.facts as { danger: Danger }).danger
    expect([d.seep, d.takesYourCard]).toEqual([false, false])
    expect(adviseMoves(viewFor(noKing, 'player'))[0]!.intent.type).toBe('build')
    void twoPlusJack; void find
  })

  it('throwing the Two onto the Jack is NOT safe, since 2 + 11 = 13 and the opponent’s King would clear them both', () => {
    const ranked = rankMoves(viewFor(withKing, 'player')) // one list, so positions in it can be compared
    const t = ranked.find((a) => a.intent.type === 'throw' && a.intent.card.face === Face.Two)!
    expect((t.facts as { danger: Danger }).danger.seep).toBe(true)
    const safe = ranked.find((a) => a.intent.type === 'throw' && a.intent.card.face === Face.Ten)!
    expect((safe.facts as { danger: Danger }).danger.seep).toBe(false)
    expect(ranked.indexOf(t)).toBeGreaterThan(ranked.indexOf(safe))
  })

  it('no Seep is feared when the opponent’s card would be the last of the hand (it earns no bonus)', () => {
    const lastCard = position({ floor, mine, theirs: withKing.hands.opponent, played: 46, total: 48 })
    const house = rankMoves(viewFor(lastCard, 'player')).find((a) => a.intent.type === 'build' && a.intent.card.face === Face.Two)!
    expect((house.facts as { danger: Danger }).danger.seep).toBe(false)
  })
})

describe('the last card of the hand: whoever captures last is given everything still on the floor', () => {
  it('a capture by the opponent’s final card wins them the WHOLE floor, not only the cards it takes', () => {
    // Four loose cards, among them 20 points of spades. The opponent holds one card, a Five, which can capture only the Five of Hearts;
    // it is their last card (47 of 48 played after mine), so the leftovers go to them too.
    const floor = [loose('a', Face.Five, Suit.Hearts), loose('b', Face.Nine, Suit.Spades), loose('c', Face.Ten, Suit.Spades), loose('d', Face.Ace, Suit.Spades)]
    const s = position({ floor, mine: [card(Face.Two, Suit.Clubs)], theirs: [card(Face.Five, Suit.Clubs)], played: 46, total: 48 })
    const view = viewFor(s, 'player')
    const facts = moveFacts(view, standInState(view), { type: 'throw', card: card(Face.Two, Suit.Clubs) }, unseenCards(view)) as { danger: Danger }
    expect(facts.danger.points).toBe(9 + 10 + 1) // everything on the floor, not just the Five
    expect(facts.danger.seep).toBe(false) // and no bonus, as it is the last card
    expect(facts.danger.takesYourCard).toBe(true) // my thrown Two goes with the rest
  })
  it('but a hand that cannot capture anything wins nothing', () => {
    const floor = [loose('b', Face.Nine, Suit.Spades), loose('c', Face.Ten, Suit.Spades)]
    // A Six makes nothing with a 9 and a 10 that adds to 12 (6, 9, 10, 15, 16, 19, 25), so the opponent's Queen can capture nothing.
    const s = position({ floor, mine: [card(Face.Six, Suit.Clubs)], theirs: [card(Face.Queen, Suit.Clubs)], played: 46, total: 48 })
    const view = viewFor(s, 'player')
    const d = (moveFacts(view, standInState(view), { type: 'throw', card: card(Face.Six, Suit.Clubs) }, unseenCards(view)) as { danger: Danger }).danger
    expect([d.canCapture, d.points]).toEqual([false, 0])
  })
})

describe('when the opponent’s hand is not yet known', () => {
  it('nothing is measured (the old "cards out of your sight" reasoning stays), so opening and bidding advice is unchanged', () => {
    const state = { ...position({ floor: [loose('a', Face.Four, Suit.Spades), loose('b', Face.Five, Suit.Hearts)], mine: [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Clubs)], theirs: [] }), phase: 'opening-move' as const, bidValue: 9 }
    const view = viewFor(state, 'player')
    expect(unseenCards(view).known).toBe(false)
    for (const a of rankMoves(view)) expect((a.facts as { danger: Danger }).danger).toEqual(NO_DANGER)
  })
})

describe('the suggestions always offer the safe way out', () => {
  it('when there is nothing to capture and every build is dangerous, a safe throw is still offered', () => {
    // Floor: a lone Jack. I hold only cards that make dangerous houses, plus one worthless card to throw.
    const mine = [card(Face.Two, Suit.Hearts), card(Face.King, Suit.Diamonds), card(Face.King, Suit.Clubs), card(Face.Ten, Suit.Spades), card(Face.Ten, Suit.Diamonds)]
    const s = position({ floor: [loose('j', Face.Jack, Suit.Hearts)], mine, theirs: [card(Face.King, Suit.Spades), card(Face.Ten, Suit.Hearts), card(Face.Four, Suit.Clubs)] })
    const top = adviseMoves(viewFor(s, 'player'), { count: 3 })
    expect(top.filter((a) => a.intent.type === 'throw').length).toBeGreaterThanOrEqual(1)
  })
  it('even when the builds are perfectly safe and outscore any throw, the safe throw is still offered, below the best build', () => {
    // The opponent holds nothing that can take a house of 10 or 13, so those builds score highest; the list must still show the quiet alternative.
    const mine = [card(Face.Two, Suit.Hearts), card(Face.Ten, Suit.Clubs), card(Face.Ten, Suit.Diamonds), card(Face.Ten, Suit.Spades), card(Face.King, Suit.Diamonds), card(Face.King, Suit.Clubs)]
    const s = position({ floor: [loose('j', Face.Jack, Suit.Hearts)], mine, theirs: [card(Face.Queen, Suit.Hearts), card(Face.Four, Suit.Clubs), card(Face.Six, Suit.Diamonds)] })
    const ranked = rankMoves(viewFor(s, 'player'))
    expect(ranked.slice(0, 3).every((a) => a.intent.type === 'build')).toBe(true) // the three best by score are builds
    const top = adviseMoves(viewFor(s, 'player'))
    expect(top[0]!.intent.type).toBe('build')
    expect(top.some((a) => a.intent.type === 'throw')).toBe(true) // yet a throw is among the three shown
    expect(top).toHaveLength(3)
  })
  it('when every throw is dangerous there is no "safe" throw to offer, and the list is simply the best three', () => {
    // Every throw of mine either helps a Seep or hands over points, so none is offered as the safe way out.
    const s = position({ floor: [loose('a', Face.Nine, Suit.Spades), loose('b', Face.Ten, Suit.Spades)], mine: [card(Face.Two, Suit.Clubs), card(Face.Three, Suit.Clubs)], theirs: [card(Face.Queen, Suit.Clubs), card(Face.Nine, Suit.Hearts), card(Face.Ten, Suit.Hearts)] })
    const ranked = rankMoves(viewFor(s, 'player'))
    expect(ranked.filter((a) => a.intent.type === 'throw').every((a) => (a.facts as { danger: Danger }).danger.points > 0 || (a.facts as { danger: Danger }).danger.seep)).toBe(true)
    expect(adviseMoves(viewFor(s, 'player')).map((a) => keyOf(a.intent))).toEqual(ranked.slice(0, adviseMoves(viewFor(s, 'player')).length).map((a) => keyOf(a.intent)))
  })
  it('never offers a DANGEROUS throw as the safe way out (a position found by searching real games: good builds, nothing to capture, every throw dangerous)', () => {
    const s = position({
      floor: [loose('a', Face.Ace, Suit.Hearts), loose('b', Face.Five, Suit.Diamonds)],
      mine: [card(Face.Queen, Suit.Spades), card(Face.King, Suit.Hearts), card(Face.Three, Suit.Clubs), card(Face.Jack, Suit.Diamonds), card(Face.Seven, Suit.Hearts)],
      theirs: [card(Face.Two, Suit.Clubs), card(Face.Ten, Suit.Hearts), card(Face.Four, Suit.Diamonds), card(Face.Four, Suit.Clubs), card(Face.Eight, Suit.Hearts), card(Face.Six, Suit.Spades)],
    })
    const ranked = rankMoves(viewFor(s, 'player'))
    expect(ranked.some((a) => a.intent.type === 'capture')).toBe(false)
    const throws = ranked.filter((a) => a.intent.type === 'throw')
    expect(throws.length).toBeGreaterThan(1)
    for (const t of throws) { const d = (t.facts as { danger: Danger }).danger; expect(d.seep || d.points > 0, keyOf(t.intent)).toBe(true) } // every throw is dangerous
    const top = adviseMoves(viewFor(s, 'player'))
    expect(top.map((a) => a.intent.type)).toEqual(['build', 'build', 'build']) // so none of them is dressed up as the safe option
  })

  it('the more the opponent could win, the lower a move scores (a Seep worst of all), for every kind of move', () => {
    const k = (over: Partial<Danger>): Danger => ({ basis: 'known', canCapture: true, points: 0, seep: false, takesYourCard: false, byValue: 10, ...over })
    const kinds: ((d: Danger) => MoveFacts)[] = [
      (danger) => ({ kind: 'build', card: card(Face.Ten, Suit.Clubs), targetValue: 10, looseCards: [], cemented: false, copiesInHand: 2, unseenCopies: 1, pointsInHouse: 0, danger }),
      (danger) => ({ kind: 'modify', card: card(Face.Ten, Suit.Clubs), mode: 'cement', fromValue: 10, toValue: 10, looseCards: [], copiesInHand: 2, unseenCopies: 1, pointsAdded: 0, danger }),
      (danger) => ({ kind: 'throw', card: card(Face.Ten, Suit.Clubs), points: 0, unseenCopies: 1, couldHaveCaptured: false, danger }),
      (danger) => ({ kind: 'capture', card: card(Face.Six, Suit.Clubs), taken: [card(Face.Six, Suit.Hearts)], takesHouse: false, points: 0, scoringCards: [], sweepBonus: 0, clearsFloor: false, danger }),
    ]
    for (const make of kinds) {
      const none = scoreFacts(make(k({ canCapture: false })))
      const points = scoreFacts(make(k({ points: 9 })))
      const seep = scoreFacts(make(k({ seep: true })))
      const kind = make(k({})).kind
      expect(points, `${kind}: points at risk`).toBeLessThan(none)
      expect(seep, `${kind}: a Seep`).toBeLessThan(points)
    }
    // and a house the opponent certainly takes scores worse than one they cannot take
    expect(scoreFacts(kinds[0]!(k({ takesYourCard: true })))).toBeLessThan(scoreFacts(kinds[0]!(k({ takesYourCard: false }))))
  })

  it('a capture is never displaced by it: when something can be captured, the list is the best captures', () => {
    const s = position({ floor: [loose('a', Face.Nine, Suit.Spades), loose('b', Face.Four, Suit.Hearts)], mine: [card(Face.Nine, Suit.Hearts), card(Face.Two, Suit.Clubs), card(Face.Three, Suit.Clubs)], theirs: [card(Face.King, Suit.Spades), card(Face.Five, Suit.Clubs)] })
    const top = adviseMoves(viewFor(s, 'player'))
    expect(top[0]!.intent.type).toBe('capture')
  })
})
