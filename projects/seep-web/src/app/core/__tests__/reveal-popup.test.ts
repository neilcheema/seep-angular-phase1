import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = (path: string) => readFileSync(new URL(`../../pages/${path}`, import.meta.url), 'utf8')

/**
 * The move-reveal pop-up shows every card of a house or a capture. A big house (16 cards in a real game) once made it taller than the phone, with no way
 * to scroll to its Next button. These checks keep the three parts of the fix in place on BOTH game screens; a browser journey proves they work.
 */
describe('the move-reveal pop-up can never be taller than the screen', () => {
  for (const [name, file] of [['two-player', 'two-player/two-player.component.html'], ['four-player', 'four-player/four-player.component.html']] as const) {
    describe(name, () => {
      const html = page(file)
      const box = html.match(/<div class="reveal-card" style="([^"]*)">/)?.[1] ?? ''
      it('limits the box to the screen height and lets it scroll inside', () => {
        expect(box).toContain('max-height: calc(100vh - 40px)') // for browsers without dynamic viewport units
        expect(box).toContain('max-height: calc(100dvh - 40px)') // the one that matters on a phone, where the browser bars come and go
        expect(box).toContain('overflow-y: auto')
      })
      it('keeps the Next button stuck to the bottom of the box, so it is always on screen', () => {
        expect(html).toMatch(/<div style="position: sticky; bottom: 0; width: 100%;[^"]*">\s*<button class="btn-gold" \(click\)="dismissReveal\(\)">Next<\/button>\s*<\/div>/)
      })
      it('shows a large set of cards smaller, and an ordinary one at full size', () => {
        expect(html).toContain('[style.zoom]="r.targetCards.length > 6 ? 0.6 : null"')
      })
    })
  }
})
