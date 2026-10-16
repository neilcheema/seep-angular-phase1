import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

/**
 * The "something felt off" email must carry the table as the player saw it (their own cards, what they had selected, the floor with the cards inside each
 * pile), so that a problem can be rebuilt from the email alone, and the panel must say so. The wording and the length limit are tested in
 * table-snapshot.test.ts and the real screens in a browser; this keeps the wiring on both game screens from being quietly undone.
 */
describe('the report email carries the table, on both game screens', () => {
  for (const [name, ts, html] of [
    ['two-player', 'pages/two-player/two-player.component.ts', 'pages/two-player/two-player.component.html'],
    ['four-player', 'pages/four-player/four-player.component.ts', 'pages/four-player/four-player.component.html'],
  ] as const) {
    describe(name, () => {
      const code = read(ts)
      const markup = read(html)
      it('builds the body through the shared helper, from the player’s hand, selection and floor', () => {
        expect(code).toContain('ruleNoteBody(): string {')
        expect(code).toContain('return buildReportBody({ head, snapshot: s ? this.tableSnapshot(s) : \'No active game.\', log: this.log() })')
        const snap = code.slice(code.indexOf('private tableSnapshot('), code.indexOf('private describeFloor('))
        expect(snap).toContain("handLine('Your hand', s.myHand)")
        expect(snap).toContain('selectionLine(this.selectedCard(), this.selectedFloorIds(), s.floor)')
        expect(snap).toContain('floorLine(s.floor, (owners) => this.pileOwnerLabel(owners))')
      })
      it('sends exactly that body, and no longer builds its own log text', () => {
        const send = code.slice(code.indexOf('  sendRuleNote(): void {'), code.indexOf('  onBid(value: number)'))
        expect(send).toContain('const body = this.ruleNoteBody()')
        expect(send).toContain('encodeURIComponent(body)')
        expect(code).not.toContain('Move log (most recent first)')
      })
      it('says in the panel what the email contains', () => {
        expect(markup).toContain('Sending opens an email that includes your cards, the table and the last few moves')
      })
    })
  }
})
