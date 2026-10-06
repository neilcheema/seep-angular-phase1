import { type Advice, type BidAdvice, type Card, type Intent, type MoveFacts, captureValue } from 'seep-engine'

/** One suggestion, ready to show: what to do, why, and the move to play if the player taps it. */
export interface AdviceCard {
  readonly title: string
  readonly reasons: string[]
  readonly intent: Intent
}

/** One suggested bid. */
export interface BidCard {
  readonly value: number
  readonly title: string
  readonly reasons: string[]
}

const VALUE_WORDS = ['', 'Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King']
const plural = (word: string) => (word.endsWith('x') ? `${word}es` : `${word}s`)
/** "Nines", "Jacks": the four cards that share a capture value. */
const valuePlural = (value: number) => plural(VALUE_WORDS[value] ?? String(value))
const points = (n: number) => `${n} point${n === 1 ? '' : 's'}`
const cardName = (c: Card) => `${c.face} of ${c.suit}`
const list = (parts: string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`)

/** What you can and cannot see of the four cards that share this value. Only used for a house the opponent might capture. */
function unseenLine(value: number, unseen: number): string {
  if (unseen === 0) return `You can see all four ${valuePlural(value)}, so the opponent has no matching card to capture it with.`
  return `${unseen} ${unseen === 1 ? 'card' : 'cards'} worth ${value} ${unseen === 1 ? 'is' : 'are'} out of your sight, so the opponent might be able to capture it.`
}

function describe(facts: MoveFacts): { title: string; reasons: string[] } {
  switch (facts.kind) {
    case 'capture': {
      const title =
        facts.takesHouse ? `Capture a house of ${captureValue(facts.card)} with your ${cardName(facts.card)}`
        : facts.taken.length === 1 ? `Capture the ${cardName(facts.taken[0]!)} with your ${cardName(facts.card)}`
        : `Capture ${facts.taken.length} cards with your ${cardName(facts.card)}`
      const reasons: string[] = []
      reasons.push(
        facts.points > 0
          ? `Wins ${points(facts.points)} (${list(facts.scoringCards.map(cardName))}).`
          : `Takes ${facts.taken.length + 1} cards, though none of them score points on their own.`,
      )
      if (facts.sweepBonus > 0) reasons.push(`It clears the whole floor: a Seep, worth ${facts.sweepBonus} bonus points.`)
      else if (facts.clearsFloor) reasons.push('It clears the floor, but a Seep on the last card of the hand earns no bonus.')
      if (facts.takesHouse) reasons.push('It takes the whole house, and every card in it.')
      return { title, reasons }
    }
    case 'build': {
      const title =
        facts.looseCards.length === 0
          ? `Build a house of ${facts.targetValue} with your ${cardName(facts.card)}`
          : `Build a house of ${facts.targetValue}: your ${cardName(facts.card)} with ${list(facts.looseCards.map(cardName))}`
      const reasons = [`You keep ${facts.copiesInHand === 1 ? 'another card' : `${facts.copiesInHand} more cards`} worth ${facts.targetValue}, so you can capture this house on a later turn.`, unseenLine(facts.targetValue, facts.unseenCopies)]
      if (facts.unseenCopies > 0 && facts.pointsInHouse > 0) reasons.push(`It puts ${points(facts.pointsInHouse)} of cards into the house, which the opponent wins if they capture it.`)
      if (facts.cemented) reasons.push('It is built from several sets at once, so it is cemented: a cemented house cannot be broken up.')
      return { title, reasons }
    }
    case 'modify': {
      const withLoose = facts.looseCards.length > 0 ? ` and ${list(facts.looseCards.map(cardName))}` : ''
      if (facts.mode === 'cement') {
        return {
          title: `Cement the house of ${facts.fromValue} with your ${cardName(facts.card)}${withLoose}`,
          reasons: ['A cemented house cannot be broken up by anyone.', `You keep ${facts.copiesInHand === 1 ? 'another card' : `${facts.copiesInHand} more cards`} worth ${facts.toValue} to capture it with.`, unseenLine(facts.toValue, facts.unseenCopies)],
        }
      }
      return {
        title: `Break the house of ${facts.fromValue} up to ${facts.toValue} with your ${cardName(facts.card)}${withLoose}`,
        reasons: [`The house is now worth ${facts.toValue}, and you hold ${facts.copiesInHand === 1 ? 'a card' : `${facts.copiesInHand} cards`} worth ${facts.toValue} to capture it with.`, unseenLine(facts.toValue, facts.unseenCopies)],
      }
    }
    case 'throw':
      return {
        title: `Throw the ${cardName(facts.card)}`,
        reasons: [
          ...(facts.couldHaveCaptured ? ['This card could capture something right now, so throwing it gives that up.'] : []),
          facts.points === 0 ? 'Worth no points, so little is lost if the opponent captures it.' : `Worth ${points(facts.points)}: if the opponent captures it, they win those points.`,
        ],
      }
  }
}

/** The sentences for one move suggestion. */
export function adviceCard(advice: Advice): AdviceCard {
  const { title, reasons } = describe(advice.facts)
  return { title, reasons, intent: advice.intent }
}

/** The sentences for one bid suggestion: what you hold, and the best way to open if you bid it. */
export function bidCard(bid: BidAdvice): BidCard {
  const reasons = [`You hold ${bid.copiesInHand} ${bid.copiesInHand === 1 ? 'card' : 'cards'} worth ${bid.value}.`]
  if (bid.bestOpening) reasons.push(`A good first move with this bid: ${describe(bid.bestOpening.facts).title.replace(/^./, (c) => c.toLowerCase())}.`)
  reasons.push(`${bid.openingMoves} ${bid.openingMoves === 1 ? 'opening move is' : 'opening moves are'} possible with this bid.`)
  return { value: bid.value, title: `Bid ${bid.value}`, reasons }
}
