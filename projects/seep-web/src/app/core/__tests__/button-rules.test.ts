import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = (path: string) => readFileSync(new URL(`../../pages/${path}`, import.meta.url), 'utf8')

/**
 * The Build and Add / break house buttons used to be lit by a rough guess (a card and a house selected), then refused by the engine when pressed: for
 * example adding your ONLY King to a house of 13. They now ask the rules themselves. A browser test proves the behaviour; these keep the wiring from
 * being quietly removed from either game screen.
 */
describe('the action buttons ask the engine, on both game screens', () => {
  for (const [name, ts, html, modify, build] of [
    ['two-player', 'two-player/two-player.component.ts', 'two-player/two-player.component.html', 'modifyHouseRefusal', 'buildHouseRefusal'],
    ['four-player', 'four-player/four-player.component.ts', 'four-player/four-player.component.html', 'fourPlayerModifyHouseRefusal', 'fourPlayerBuildHouseRefusal'],
  ] as const) {
    describe(name, () => {
      const code = page(ts)
      const markup = page(html)
      it('Add / break house is enabled only when the engine would accept the move', () => {
        expect(code).toContain(`${modify}(s, c, houses[0]!.id, this.selectedLoose().map((i) => i.id))`)
        expect(code).toMatch(/readonly canModify = computed\([\s\S]{0,260}?this\.modifyRefusal\(\) === null/) // within the definition of canModify itself
      })
      it('Build house is enabled only when the engine would accept the move', () => {
        expect(code).toContain(`${build}(s, c, this.selectedLoose().map((i) => i.id), target) === null`)
      })
      it('the engine’s reason is shown when Add / break house is not possible', () => {
        expect(markup).toContain('@if (modifyRefusal(); as why)')
        expect(markup).toContain('id="modify-hint"')
        expect(markup).toContain('{{ why }}')
      })
    })
  }
})
