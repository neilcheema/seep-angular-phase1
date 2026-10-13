import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = (path: string) => readFileSync(new URL(`../../pages/${path}`, import.meta.url), 'utf8')

/**
 * On the LAST card of a hand the floor cards need not be ticked: whatever is left goes to whoever captured last, which a capture with that card makes
 * the player. The engine's rule is tested in lastCard.test.ts and the screens in a browser; this keeps the wiring on both game screens from being
 * quietly undone: the Capture button must not insist on a ticked floor card, pressing it must send what the card must capture, and the player is told.
 */
describe('the last card of a hand, on both game screens', () => {
  for (const [name, ts, html, helper] of [
    ['two-player', 'two-player/two-player.component.ts', 'two-player/two-player.component.html', 'captureRefusal'],
    ['four-player', 'four-player/four-player.component.ts', 'four-player/four-player.component.html', 'fourPlayerCaptureRefusal'],
  ] as const) {
    describe(name, () => {
      const code = page(ts)
      const markup = page(html)
      it('knows when it is the last card, from the same two numbers the engine uses', () => {
        expect(code).toContain('readonly isLastCard = computed(')
        expect(code).toContain('s.cardsPlayedThisHand + 1 === s.totalPlayableThisHand')
      })
      it('Capture does not insist on a ticked floor card (the engine decides)', () => {
        const body = code.slice(code.indexOf('readonly canCapture = computed'), code.indexOf('readonly buildTargetValue'))
        expect(body).not.toContain('selectedFloorIds().length > 0')
        expect(body).toContain(`return ${helper}(s, c, this.selectedFloorIds()) === null`)
      })
      it('pressing Capture on the last card sends what the card must capture, unless the selection is already a proper capture, and only for a house the player made', () => {
        const body = code.slice(code.indexOf('  onCapture(): void {'), code.indexOf('  onBuild(): void {'))
        expect(body).toContain('this.lastCardCapturesOwnHouse() && !(picked.length > 0 && isAcceptableCapture(s.floor, captureValue(c), picked)) ? requiredCaptureIds(s.floor, c) : picked')
      })
      it('applies only when the last card matches a house THIS player made', () => {
        const body = code.slice(code.indexOf('readonly lastCardCapturesOwnHouse = computed'), code.indexOf('readonly canCapture = computed'))
        expect(body).toContain('if (!s || !c || !this.isLastCard()) return false')
        expect(body).toContain('findHouseByValue(s.floor, captureValue(c))')
        expect(body).toContain('house.owners.includes(s.viewer)')
      })
      it('tells the player why they do not need to tick anything (only then), and drops the irrelevant house message on any last card', () => {
        expect(markup).toContain('id="last-card-note"')
        expect(markup).toContain('@if (lastCardCapturesOwnHouse() && canCapture())')
        expect(markup).toContain('This is your last card and it takes your house.')
        expect(markup).toMatch(/@if \(!isLastCard\(\)\) \{\s*@if \(modifyRefusal\(\); as why\)/)
      })
    })
  }
})
