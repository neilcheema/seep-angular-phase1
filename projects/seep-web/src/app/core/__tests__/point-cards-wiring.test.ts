import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

/**
 * Once a hand is over, the point cards each side captured are shown where the (now empty) hands were, and they go when the next hand is dealt. The
 * helper is tested on its own (point-cards.test.ts) and the screens in a browser; this keeps the wiring on both game screens from being quietly undone.
 */
describe('the point cards at the end of a hand', () => {
  for (const [name, ts, html, titles] of [
    ['two-player', 'pages/two-player/two-player.component.ts', 'pages/two-player/two-player.component.html', ['Your point cards', "opponentLabel() + '’s point cards'"]],
    ['four-player', 'pages/four-player/four-player.component.ts', 'pages/four-player/four-player.component.html', ['Your team’s point cards', "'Team ' + otherTeamLetter() + '’s point cards'"]],
  ] as const) {
    describe(name, () => {
      const code = read(ts)
      const markup = read(html)
      it('shows them only when the hand is over (or the match is), and not while a hand is being played', () => {
        const body = code.slice(code.indexOf('readonly showPointCards = computed'), code.indexOf('readonly isPlayerTurn = computed'))
        expect(body).toContain("s.phase === 'hand-over' || s.phase === 'match-over'")
        expect(body).not.toContain("'playing'")
        expect(body).not.toContain("'bidding'")
      })
      it('puts them where the two hands were, and keeps the real hands for the rest of the game', () => {
        expect(markup.match(/@if \(showPointCards\(\)\) \{/g)).toHaveLength(2) // the top hand and the player's own
        expect(markup.match(/<app-point-cards/g)).toHaveLength(2)
        for (const title of titles) expect(markup).toContain(title)
        expect(markup).toContain('<app-player-hand')
        expect(markup).toContain('<app-opponent-hand')
        // each point-card area sits in an @if whose @else holds the matching hand
        expect(markup).toMatch(/<app-point-cards[^>]*\/>\s*\} @else \{\s*(<span[\s\S]*?<\/span>\s*)?<app-opponent-hand/)
        expect(markup).toMatch(/<app-point-cards title="Your[^>]*\/>\s*\} @else \{\s*<app-player-hand/)
      })
      it('is built from the game\u2019s own captured cards and totals, not a figure of its own', () => {
        expect(code).toContain('pointCardsOf(')
        expect(code).toContain('describePointCards(')
        expect(code).toContain('lastHandTotals')
        expect(code).toContain('PointCardsComponent')
      })
    })
  }
  it('the display is for looking at only: nothing in it can be tapped, and it uses the game’s own point values', () => {
    const component = read('components/point-cards/point-cards.component.ts')
    expect(component).not.toContain('(click)')
    expect(component).not.toContain('selectable')
    expect(read('core/point-cards.ts')).toContain('pointValue')
  })
})
