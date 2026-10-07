import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const here = (rel: string) => new URL(rel, import.meta.url)
const publicFile = (name: string) => here(`../../../../public/${name}`)
const text = (url: URL) => readFileSync(url, 'utf8')
const indexHtml = () => text(here('../../../index.html'))

/** Width, height and colour type straight from a PNG's header, so the test does not trust a file name. */
function png(url: URL): { width: number; height: number; colourType: number; isPng: boolean } {
  const b = readFileSync(url)
  return { isPng: b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25]! }
}

describe('the app manifest', () => {
  const manifest = JSON.parse(text(publicFile('manifest.json'))) as { name: string; short_name: string; start_url: string; scope: string; display: string; background_color: string; theme_color: string; icons: { src: string; sizes: string; type: string; purpose: string }[] }

  it('names the app and opens it as an app, from the front page', () => {
    expect(manifest.name).toBe('Seep')
    expect(manifest.short_name).toBe('Seep')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
  })
  it('uses the felt green for the splash and the status area, the same as the page', () => {
    expect(manifest.background_color).toBe('#0a3d20')
    expect(manifest.theme_color).toBe('#0a3d20')
    expect(indexHtml()).toContain(`<meta name="theme-color" content="${manifest.theme_color}">`)
  })
  it('lists real icons whose files exist and are exactly the size they claim', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3)
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number)
      const file = png(publicFile(icon.src))
      expect(file.isPng, icon.src).toBe(true)
      expect([file.width, file.height], icon.src).toEqual([w, h])
      expect(icon.type).toBe('image/png')
    }
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
    expect(manifest.icons.some((i) => i.purpose === 'any' && i.sizes === '512x512')).toBe(true)
    expect(manifest.icons.some((i) => i.purpose === 'any' && i.sizes === '192x192')).toBe(true)
  })
})

describe('the Home Screen icon for iPhone', () => {
  it('is 180 by 180 and fully opaque (iOS paints transparent icons with black)', () => {
    const icon = png(publicFile('apple-touch-icon.png'))
    expect([icon.isPng, icon.width, icon.height]).toEqual([true, 180, 180])
    expect(icon.colourType).toBe(2) // RGB with no alpha channel
  })
})

describe('index.html', () => {
  const html = indexHtml()
  it('links the manifest and the iPhone icon, and both files exist', () => {
    expect(html).toContain('<link rel="manifest" href="manifest.json">')
    expect(html).toContain('<link rel="apple-touch-icon" href="apple-touch-icon.png">')
    expect(existsSync(publicFile('manifest.json'))).toBe(true)
    expect(existsSync(publicFile('apple-touch-icon.png'))).toBe(true)
  })
  it('asks for the app look, with a dark status bar that never overlaps the page', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">')
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes">')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Seep">')
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black">')
  })
  it('keeps the viewport exactly as it was: no viewport-fit=cover, which would let the page slide under the iPhone’s status bar and home bar', () => {
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).not.toContain('viewport-fit')
  })
  it('keeps everything that was already there: the base, the favicon, the share-card tags and the app root', () => {
    for (const keep of ['<base href="/">', '<link rel="icon" type="image/svg+xml" href="favicon.svg">', '<meta property="og:title" content="Seep" />', '<meta property="og:image" content="https://www.seep.quest/seep-og-image.jpg">', '<meta property="og:url" content="https://www.seep.quest/" />', '<app-root></app-root>', '<title>Seep</title>']) expect(html, keep).toContain(keep)
  })
})

describe('the service worker (sw.js)', () => {
  const sw = text(publicFile('sw.js'))
  it('touches only page navigations: scripts, pictures and the server’s replies are left entirely alone', () => {
    expect(sw).toContain("event.request.mode !== 'navigate'")
    expect(sw).toMatch(/if \(event\.request\.mode !== 'navigate'\) return/)
  })
  it('stores exactly one page, the offline page, and never the app or any reply', () => {
    expect(sw).toContain("const OFFLINE_URL = '/offline.html'")
    expect(sw).not.toMatch(/addAll|cache\.put|\.put\(/)
    expect((sw.match(/cache\.add\(/g) ?? []).length).toBe(1)
  })
  it('goes to the network first and only falls back to the offline page when the network fails', () => {
    expect(sw).toMatch(/fetch\(event\.request\)\.catch\(/)
  })
  it('the offline page exists, stands alone (no outside files), and offers a way to try again', () => {
    const page = text(publicFile('offline.html'))
    expect(page).toContain("You're offline")
    expect(page).toContain('location.reload()')
    expect(page).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<img/)
  })
})

describe('how the site is started and served', () => {
  it('main.ts starts the worker and the stale-app guard after the app has started', () => {
    const main = text(here('../../../main.ts'))
    expect(main).toMatch(/bootstrapApplication\(AppComponent, appConfig\)\s*\.then\(\(\) => \{\s*registerOfflineWorker\(\);\s*startStaleAppGuard\(\);\s*\}\)/)
    expect(main).toContain('.catch((err) => console.error(err))')
  })
  it('the hosting config is unchanged: it rewrites unknown pages to index.html, and the new files are real files so they are served as themselves', () => {
    const config = JSON.parse(text(publicFile('staticwebapp.config.json'))) as { navigationFallback: { rewrite: string; exclude: string[] } }
    expect(config.navigationFallback.rewrite).toBe('/index.html')
    for (const file of ['manifest.json', 'sw.js', 'offline.html', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) expect(existsSync(publicFile(file)), file).toBe(true)
  })
})
