import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = (path: string) => readFileSync(new URL(`../../pages/${path}`, import.meta.url), 'utf8')

/**
 * The rules shown to players must say what the engine enforces. They once said any total that divides evenly would cement a house, which let
 * 11 + 12 + 13 pass as "four sets of 9"; the engine now needs whole sets, and the text must never say otherwise again.
 */
describe('the rules text players read about houses', () => {
  for (const [name, file] of [['two-player', 'two-player/two-player.component.html'], ['four-player', 'four-player/four-player.component.html']] as const) {
    it(`${name}: says a house is cemented by WHOLE SETS, and gives an example of what is not`, () => {
      const html = page(file)
      expect(html).toContain("complete sets of the house's value")
      expect(html).toContain('11 + 12 + 13 add up to 36, but that is not four sets of 9')
      expect(html).not.toMatch(/total is a multiple of the house/)
    })
  }
  for (const [name, file] of [['two-player', 'two-player/two-player.component.html'], ['four-player', 'four-player/four-player.component.html']] as const) {
    it(`${name}: says the opening move may choose any one combination (nothing left out), and that later plays must take every matching group`, () => {
      const html = page(file)
      expect(html).toContain('On the opening move, if several different combinations of floor cards could make the bid house, you may choose any one of them, but no separate matching group may be left out')
      expect(html).toContain('From the second play on, a new house must take in every matching group of floor cards')
    })
  }
  it('the Learn primer describes cementing as whole sets', () => {
    const html = page('two-player/two-player.component.html')
    expect(html).toContain('Adding whole sets of the same total (another 9, or a 4 and a 5, for a house of 9) cements it')
    expect(html).not.toContain('Adding more of the same total cements it')
  })
})
