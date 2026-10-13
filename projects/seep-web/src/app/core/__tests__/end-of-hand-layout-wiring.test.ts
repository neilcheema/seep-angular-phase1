import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

/**
 * At the end of a hand or a match the screen must keep the player's own point cards, Deal next hand / Play again and the point-card summaries clear of
 * the “Notice something…” button, which must never float over the page (it once covered Capture, Build and Throw on a crowded floor), and at the end of a match the player's own point cards must not be pushed off a phone screen by an empty
 * floor or the long hand-by-hand table. The layout itself is measured in a real browser (at phone and desktop sizes); this keeps the pieces that
 * make it work from being quietly undone.
 */
describe('the end of a hand and of a match: layout', () => {
  for (const [name, html] of [
    ['two-player', 'pages/two-player/two-player.component.html'],
    ['four-player', 'pages/four-player/four-player.component.html'],
  ] as const) {
    describe(name, () => {
      const markup = read(html)
      it('draws no empty “Floor empty” box once the match is over, and lets that area give its space back', () => {
        expect(markup).toContain("@if (s.floor.length === 0 && s.phase !== 'match-over') {")
        expect(markup).toContain(`[style.min-height]="s.phase === 'match-over' ? '0' : null"`)
        expect(markup).toContain(`[style.padding]="s.phase === 'match-over' ? '0' : null"`)
      })
      it('there is no floating button any more: nothing in the screen is fixed to the corner, so nothing can sit on top of Capture, Build or Throw', () => {
        expect(markup).not.toContain('rule-note-toggle')
        expect(markup).not.toContain('position: fixed')
      })
      it('the “Notice something…” button is a real button in the page, shown whenever it is available, after the footer and inside the game layout, and it opens the same panel', () => {
        const at = markup.indexOf('id="rule-note-inline"')
        expect(at).toBeGreaterThan(0)
        expect(markup.match(/id="rule-note-inline"/g)).toHaveLength(1)
        expect(markup.slice(Math.max(0, at - 700), at)).toContain('@if (canShareRuleNote() && !ruleNotePanelOpen()) {')
        expect(markup.slice(Math.max(0, at - 700), at)).not.toContain('showPointCards()) && canShareRuleNote')
        expect(markup.slice(Math.max(0, at - 120), at + 300)).toContain('type="button"')
        expect(markup.slice(at, at + 300)).toContain('(click)="toggleRuleNotePanel()"')
        expect(at).toBeGreaterThan(markup.indexOf('How to play'))
        expect(at).toBeLessThan(markup.indexOf('@if (pendingReveal(); as r) {'))
      })
    })
  }
  describe('the match results panel', () => {
    const code = read('components/match-results/match-results.component.ts')
    it('keeps the hand-by-hand table behind a tap (closed at first), with the one-line summary as its heading', () => {
      const open = code.indexOf('<details id="results-details"')
      const close = code.indexOf('</details>', open)
      expect(open).toBeGreaterThan(0)
      expect(code.slice(open, open + 60)).not.toContain(' open')
      expect(code).toContain('<summary id="results-summary"')
      const table = code.indexOf('id="results-hands"')
      expect(table).toBeGreaterThan(open)
      expect(table).toBeLessThan(close)
      expect(code.slice(open, close)).toContain('itemised · hands won')
    })
  })
})
