import { describe, expect, it } from 'vitest'
import { type Advice, type Card, type Danger, Face, type Intent, NO_DANGER, Suit, adviseBids, adviseMoves, applyMove, dealNextHand, legalBids, legalMoves, placeBid, startMatch, viewFor } from 'seep-engine'
import { adviceCard, bidCard } from '../advice-text'

const card = (face: Face, suit: Suit): Card => ({ face, suit })
const adv = (facts: Advice['facts'], intent: Intent): Advice => ({ intent, facts, score: 0 })

describe('adviceCard: what each kind of move is called, and why', () => {
  it('a capture: what it takes, what it wins, and a sweep', () => {
    const c = adviceCard(adv({ kind: 'capture', card: card(Face.Nine, Suit.Hearts), taken: [card(Face.Nine, Suit.Spades)], takesHouse: false, points: 9, scoringCards: [card(Face.Nine, Suit.Spades)], sweepBonus: 50, clearsFloor: true , danger: NO_DANGER }, { type: 'throw', card: card(Face.Nine, Suit.Hearts) }))
    expect(c.title).toBe('Capture the Nine of Spades with your Nine of Hearts')
    expect(c.reasons).toEqual(['Wins 9 points (Nine of Spades).', 'It clears the whole floor: a Seep, worth 50 bonus points.'])
  })

  it('a capture worth nothing says so honestly, and says several cards as a number', () => {
    const c = adviceCard(adv({ kind: 'capture', card: card(Face.Ten, Suit.Hearts), taken: [card(Face.Three, Suit.Clubs), card(Face.Seven, Suit.Hearts)], takesHouse: false, points: 0, scoringCards: [], sweepBonus: 0, clearsFloor: false , danger: NO_DANGER }, { type: 'throw', card: card(Face.Ten, Suit.Hearts) }))
    expect(c.title).toBe('Capture 2 cards with your Ten of Hearts')
    expect(c.reasons).toEqual(['Takes 3 cards, though none of them score points on their own.'])
  })

  it('a capture that clears the floor on the last card says there is no bonus', () => {
    const c = adviceCard(adv({ kind: 'capture', card: card(Face.Six, Suit.Clubs), taken: [card(Face.Six, Suit.Hearts)], takesHouse: false, points: 0, scoringCards: [], sweepBonus: 0, clearsFloor: true , danger: NO_DANGER }, { type: 'throw', card: card(Face.Six, Suit.Clubs) }))
    expect(c.reasons.join(' ')).toContain('earns no bonus')
  })

  it('capturing a house names the house, by the value of the card that takes it', () => {
    const c = adviceCard(adv({ kind: 'capture', card: card(Face.Nine, Suit.Hearts), taken: [card(Face.Four, Suit.Clubs), card(Face.Five, Suit.Clubs)], takesHouse: true, points: 0, scoringCards: [], sweepBonus: 0, clearsFloor: false , danger: NO_DANGER }, { type: 'throw', card: card(Face.Nine, Suit.Hearts) }))
    expect(c.title).toBe('Capture a house of 9 with your Nine of Hearts')
    expect(c.reasons).toContain('It takes the whole house, and every card in it.')
  })

  it('a safe build says the opponent cannot capture it; a risky one says what is hidden and what is at stake', () => {
    const base = { kind: 'build' as const, card: card(Face.Nine, Suit.Hearts), targetValue: 9, looseCards: [card(Face.Four, Suit.Spades), card(Face.Five, Suit.Spades)], cemented: false, copiesInHand: 1, pointsInHouse: 9, danger: NO_DANGER }
    const safe = adviceCard(adv({ ...base, unseenCopies: 0 }, { type: 'throw', card: base.card }))
    expect(safe.title).toBe('Build a house of 9: your Nine of Hearts with Four of Spades and Five of Spades')
    expect(safe.reasons[0]).toBe('You keep another card worth 9, so you can capture this house on a later turn.')
    expect(safe.reasons[1]).toBe('You can see all four Nines, so the opponent has no matching card to capture it with.')
    expect(safe.reasons).toHaveLength(2)
    const risky = adviceCard(adv({ ...base, unseenCopies: 2 }, { type: 'throw', card: base.card }))
    expect(risky.reasons[1]).toBe('2 cards worth 9 are out of your sight, so the opponent might be able to capture it.')
    expect(risky.reasons[2]).toBe('It puts 9 points of cards into the house, which the opponent wins if they capture it.')
  })

  it('says "card" and "is" for one hidden card, and mentions a cemented build', () => {
    const c = adviceCard(adv({ kind: 'build', card: card(Face.Nine, Suit.Hearts), targetValue: 9, looseCards: [], cemented: true, copiesInHand: 2, unseenCopies: 1, pointsInHouse: 0 , danger: NO_DANGER }, { type: 'throw', card: card(Face.Nine, Suit.Hearts) }))
    expect(c.reasons[0]).toContain('2 more cards worth 9')
    expect(c.reasons[1]).toBe('1 card worth 9 is out of your sight, so the opponent might be able to capture it.')
    expect(c.reasons.join(' ')).toContain('cemented')
  })

  it('cementing and breaking a house', () => {
    const cement = adviceCard(adv({ kind: 'modify', card: card(Face.Nine, Suit.Hearts), mode: 'cement', fromValue: 9, toValue: 9, looseCards: [], copiesInHand: 1, unseenCopies: 0, pointsAdded: 0 , danger: NO_DANGER }, { type: 'throw', card: card(Face.Nine, Suit.Hearts) }))
    expect(cement.title).toBe('Cement the house of 9 with your Nine of Hearts')
    expect(cement.reasons[0]).toBe('A cemented house cannot be broken up by anyone.')
    const brk = adviceCard(adv({ kind: 'modify', card: card(Face.Two, Suit.Hearts), mode: 'break', fromValue: 9, toValue: 11, looseCards: [card(Face.Ace, Suit.Clubs)], copiesInHand: 1, unseenCopies: 3, pointsAdded: 1 , danger: NO_DANGER }, { type: 'throw', card: card(Face.Two, Suit.Hearts) }))
    expect(brk.title).toBe('Break the house of 9 up to 11 with your Two of Hearts and Ace of Clubs')
    expect(brk.reasons[0]).toBe('The house is now worth 11, and you hold a card worth 11 to capture it with.')
    expect(brk.reasons.join(' ')).not.toMatch(/\ba 1[18]\b|\ba 8\b/) // no "a 11" or "a 8": the sentence avoids the article altogether
  })

  it('a throw: worth nothing, or worth points', () => {
    expect(adviceCard(adv({ kind: 'throw', card: card(Face.Two, Suit.Clubs), points: 0, unseenCopies: 3, couldHaveCaptured: false , danger: NO_DANGER }, { type: 'throw', card: card(Face.Two, Suit.Clubs) })).reasons).toEqual(['Worth no points, so little is lost if the opponent captures it.'])
    expect(adviceCard(adv({ kind: 'throw', card: card(Face.Ace, Suit.Spades), points: 1, unseenCopies: 3, couldHaveCaptured: false , danger: NO_DANGER }, { type: 'throw', card: card(Face.Ace, Suit.Spades) })).reasons).toEqual(['Worth 1 point: if the opponent captures it, they win those points.'])
  })

  it('a throw of a card that could have captured says so (the opening move), and is honest about what is given up', () => {
    const c = adviceCard(adv({ kind: 'throw', card: card(Face.Queen, Suit.Clubs), points: 0, unseenCopies: 3, couldHaveCaptured: true , danger: NO_DANGER }, { type: 'throw', card: card(Face.Queen, Suit.Clubs) }))
    expect(c.reasons[0]).toBe('This card could capture something right now, so throwing it gives that up.')
    expect(c.reasons).toHaveLength(2)
  })

  it('keeps the move so a tap can play it', () => {
    const intent: Intent = { type: 'throw', card: card(Face.Two, Suit.Clubs) }
    expect(adviceCard(adv({ kind: 'throw', card: card(Face.Two, Suit.Clubs), points: 0, unseenCopies: 3, couldHaveCaptured: false, danger: NO_DANGER }, intent)).intent).toBe(intent)
  })
})

const known = (over: Partial<Danger>): Danger => ({ basis: 'known', canCapture: false, points: 0, seep: false, takesYourCard: false, byValue: null, ...over })
const buildFacts = (danger: Danger, unseenCopies: number): Advice['facts'] => ({ kind: 'build', card: card(Face.Ten, Suit.Clubs), targetValue: 10, looseCards: [], cemented: false, copiesInHand: 2, unseenCopies, pointsInHouse: 0, danger })
const playIt: Intent = { type: 'throw', card: card(Face.Ten, Suit.Clubs) }

describe('when counting shows what the opponent holds, the coach says so as a fact', () => {
  it('a house the opponent can take: they HOLD the card, and it happens on their next turn', () => {
    const r = adviceCard(adv(buildFacts(known({ takesYourCard: true, byValue: 10, canCapture: true }), 1), playIt)).reasons
    expect(r).toContain('The opponent holds a card worth 10, so they can take this house on their next turn.')
    expect(r.join(' ')).not.toMatch(/might/)
  })
  it('says how many when they hold more than one', () => {
    const r = adviceCard(adv(buildFacts(known({ takesYourCard: true, byValue: 10, canCapture: true }), 2), playIt)).reasons
    expect(r).toContain('The opponent holds 2 cards worth 10, so they can take this house on their next turn.')
  })
  it('a house nobody can take is called safe', () => {
    expect(adviceCard(adv(buildFacts(known({}), 0), playIt)).reasons).toContain('Nothing the opponent holds can take this house.')
  })
  it('a house that would hand over a Seep carries the warning, with the card and the 50 points', () => {
    const r = adviceCard(adv(buildFacts(known({ takesYourCard: true, seep: true, byValue: 13, canCapture: true }), 1), playIt)).reasons
    expect(r).toContain('Careful: the opponent holds a card worth 13, and after this it would clear the whole floor: a Seep, worth 50 points to them.')
  })
  it('a house that costs points says how many, once', () => {
    const r = adviceCard(adv(buildFacts(known({ takesYourCard: true, points: 6, byValue: 10, canCapture: true }), 1), playIt)).reasons
    expect(r).toContain('The most they could win from the floor after this is 6 points.')
  })
  it('a throw: safe, costly, or a Seep', () => {
    const t = (danger: Danger) => adviceCard(adv({ kind: 'throw', card: card(Face.Ten, Suit.Clubs), points: 0, unseenCopies: 1, couldHaveCaptured: false, danger }, playIt)).reasons.join(' | ')
    expect(t(known({}))).toContain('Safe: nothing the opponent holds can win a point or clear the floor after this.')
    expect(t(known({ points: 9, canCapture: true, byValue: 9 }))).toContain('After this, the opponent holds a card that could win 9 points from the floor.')
    expect(t(known({ seep: true, byValue: 13, canCapture: true, takesYourCard: true }))).toContain('Careful: the opponent holds a card worth 13')
    expect(t(known({ seep: true, byValue: 13, canCapture: true })).includes('Safe:')).toBe(false)
  })
  it('a capture that leaves a Seep behind warns about it; one that does not, says nothing extra', () => {
    const cap = (danger: Danger) => adviceCard(adv({ kind: 'capture', card: card(Face.Six, Suit.Clubs), taken: [card(Face.Six, Suit.Hearts)], takesHouse: false, points: 0, scoringCards: [], sweepBonus: 0, clearsFloor: false, danger }, playIt)).reasons
    expect(cap(known({ seep: true, byValue: 12, canCapture: true })).join(' ')).toContain('Careful: the opponent holds a card worth 12')
    expect(cap(known({})).join(' ')).not.toContain('Careful')
  })
  it('before the deal is finished the cautious wording is unchanged: "might", never "holds"', () => {
    const r = adviceCard(adv(buildFacts(NO_DANGER, 2), playIt)).reasons.join(' ')
    expect(r).toContain('2 cards worth 10 are out of your sight, so the opponent might be able to capture it.')
    expect(r).not.toContain('The opponent holds')
  })
})

describe('across whole simulated games the words are always sensible', () => {
  it('every suggestion for every human turn and every bid reads as a real sentence', () => {
    let cards = 0
    let bids = 0
    const bad = /undefined|NaN|\[object|null|\bnull\b/
    for (let g = 0; g < 30; g++) {
      let s = startMatch(g % 2 === 0 ? 'player' : 'opponent', 9100 + g)
      let seed = 1
      for (let step = 0; step < 300 && s.phase !== 'match-over'; step++) {
        if (s.phase === 'hand-over') { if (g % 3 === 0) break; s = dealNextHand(s, 9500 + g); continue }
        if (s.phase === 'bidding') {
          if (s.bidder === 'player') {
            for (const b of adviseBids(viewFor(s, 'player'), { count: 5 })) {
              const c = bidCard(b)
              expect(c.title).toBe(`Bid ${b.value}`)
              for (const r of c.reasons) { expect(r).not.toMatch(bad); expect(r.length).toBeGreaterThan(10) }
              bids++
            }
          }
          s = placeBid(s, s.bidder, legalBids(s)[0]!)
          continue
        }
        const moves = legalMoves(s, s.turn, { maxLooseCards: 99 })
        if (s.turn === 'player') {
          for (const a of adviseMoves(viewFor(s, 'player'), { count: 3 })) {
            const c = adviceCard(a)
            expect(c.title.length).toBeGreaterThan(8)
            expect(c.title).not.toMatch(bad)
            expect(c.reasons.length).toBeGreaterThan(0)
            for (const r of c.reasons) { expect(r, c.title).not.toMatch(bad); expect(r.length).toBeGreaterThan(10) }
            cards++
          }
        }
        seed = (seed * 48271) % 2147483647
        s = applyMove(s, s.turn, moves[seed % moves.length]!)
      }
    }
    expect(cards).toBeGreaterThan(300)
    expect(bids).toBeGreaterThan(5)
  }, 120_000)
})
