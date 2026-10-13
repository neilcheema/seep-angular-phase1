import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = (path: string) => readFileSync(new URL(`../../pages/${path}`, import.meta.url), 'utf8')

/**
 * The rules shown to players must say what the engine enforces. They once said any total that divides evenly would cement a house, which let
 * 11 + 12 + 13 pass as "four sets of 9"; the engine now needs whole sets, and the text must never say otherwise again.
 */
describe('the rules text players read about houses', () => {
  for (const [name, file] of [['two-player', 'two-player/two-player.component.html'], ['four-player', 'four-player/four-player.component.html']] as const) {
    it(`${name}: says that on the very last card, with a house of your own to take, the floor cards need not be ticked`, () => {
      const html = page(file)
      expect(html).toContain('On the very last card of a hand, if your card matches a house that you made and that is still on the floor')
      expect(html).toContain('you do not need to tick the floor cards: just press Capture. Anything left on the floor goes to whoever captured last, so you win them all')
    })
    it(`${name}: says a house is cemented by WHOLE SETS, and gives an example of what is not`, () => {
      const html = page(file)
      expect(html).toContain("complete sets of the house's value")
      expect(html).toContain('11 + 12 + 13 add up to 36, but that is not four sets of 9')
      expect(html).not.toMatch(/total is a multiple of the house/)
    })
  }
  for (const [name, file] of [['two-player', 'two-player/two-player.component.html'], ['four-player', 'four-player/four-player.component.html']] as const) {
    it(`${name}: says the player chooses among equivalent combinations on every play, and that nothing may be left behind`, () => {
      const html = page(file)
      expect(html).toContain('If several different combinations of floor cards could make the same total (to capture with your card, or to build a house), you may choose any one of them')
      expect(html).toContain('you must take both, using any one combination for each')
    })
  }
  it('the Learn primer describes cementing as whole sets', () => {
    const html = page('two-player/two-player.component.html')
    expect(html).toContain('Adding whole sets of the same total (another 9, or a 4 and a 5, for a house of 9) cements it')
    expect(html).not.toContain('Adding more of the same total cements it')
  })
})
