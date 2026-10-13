import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = (path: string) => readFileSync(new URL(`../../pages/${path}`, import.meta.url), 'utf8')

/**
 * A capture may use any ONE combination for each group (nothing left behind), on every play, and the engine decides whether a selection qualifies.
 * The Capture button must ask the engine, not compare the selection with the one set of cards the engine would pick itself. The rule is tested in
 * openingCapture.test.ts and the screens in a browser; this keeps the wiring on both game screens from being quietly undone.
 * (The file keeps its first name, from when only the opening move had the choice.)
 */
describe('the Capture button asks the engine, on every play and on both game screens', () => {
  for (const [name, file, helper] of [
    ['two-player', 'two-player/two-player.component.ts', 'captureRefusal'],
    ['four-player', 'four-player/four-player.component.ts', 'fourPlayerCaptureRefusal'],
  ] as const) {
    it(`${name}: canCapture is the engine's answer, with no separate guess of its own`, () => {
      const code = page(file)
      const body = code.slice(code.indexOf('readonly canCapture = computed'), code.indexOf('readonly buildTargetValue'))
      expect(body).toContain(`return ${helper}(s, c, this.selectedFloorIds()) === null`)
      expect(body).not.toContain('requiredCaptureIds')
      expect(body).not.toContain('isOpening')
    })
  }
})
