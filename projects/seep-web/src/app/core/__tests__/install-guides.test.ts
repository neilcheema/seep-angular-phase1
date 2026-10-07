import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const here = (rel: string) => new URL(rel, import.meta.url)
const publicFile = (name: string) => here(`../../../../public/${name}`)
const landing = () => readFileSync(here('../../pages/landing/landing.component.html'), 'utf8')
const landingCode = () => readFileSync(here('../../pages/landing/landing.component.ts'), 'utf8')

const GUIDES = [
  { id: 'guide-iphone', file: 'Seep-on-your-iPhone.pdf', label: 'iPhone guide' },
  { id: 'guide-android', file: 'Seep-on-your-Android-phone.pdf', label: 'Android guide' },
]

describe('the install guides (one-page PDFs for putting Seep on a phone’s home screen)', () => {
  for (const g of GUIDES) {
    describe(g.file, () => {
      it('is in the public folder, is a real PDF, and is a sensible size', () => {
        expect(existsSync(publicFile(g.file))).toBe(true)
        const bytes = readFileSync(publicFile(g.file))
        expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
        expect(statSync(publicFile(g.file)).size).toBeGreaterThan(20_000) // not an empty or truncated file
        expect(statSync(publicFile(g.file)).size).toBeLessThan(1_000_000) // a one-page guide, not a heavy download
      })
      it('is linked from the bottom of the home page, opening in a new tab', () => {
        const html = landing()
        const tag = html.match(new RegExp(`<a id="${g.id}"[^>]*>`))?.[0] ?? ''
        expect(tag, `a link with id ${g.id}`).not.toBe('')
        expect(tag).toContain(`href="${g.file}"`)
        expect(tag).toContain('target="_blank"')
        expect(tag).toContain('rel="noopener"') // a link that opens a new tab should not be able to reach back into this one
        expect(html).toContain(`>${g.label}</a>`)
      })
    })
  }

  it('the guide links sit on their own line inside one block that is shown only when Seep is NOT installed', () => {
    const html = landing()
    expect(html).toMatch(/@if \(!installedApp\) \{\s*(<!--[\s\S]*?-->\s*)?<div id="install-guides"/)
    expect(landingCode()).toContain('readonly installedApp = isInstalledApp(readDeviceEnv())')
  })

  it('the legal links are still there, and still on a line of their own', () => {
    const html = landing()
    expect(html).toContain('routerLink="/privacy"')
    expect(html).toContain('routerLink="/terms"')
    expect(html.indexOf('id="install-guides"')).toBeLessThan(html.indexOf('routerLink="/privacy"')) // the guides come first, the legal line last
  })

  it('the install hint on the home page and the guides agree on the instructions they give', () => {
    const hint = readFileSync(here('../../components/install-hint/install-hint.component.ts'), 'utf8')
    expect(hint).toContain('Add to Home Screen') // the same words the iPhone guide tells people to tap
  })
})
