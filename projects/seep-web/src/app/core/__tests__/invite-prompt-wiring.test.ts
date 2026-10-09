import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const landingHtml = read('pages/landing/landing.component.html')
const landingTs = read('pages/landing/landing.component.ts')
const popup = read('components/invite-prompt/invite-prompt.component.ts')

/**
 * The rules for the invitation are tested on their own (invite-prompt.test.ts). These keep the wiring from being quietly undone: the Play online
 * card stays highlighted, the popup stays on the home page, stays accessible, and stays out of the privacy banner's way.
 */
describe('the Play online card on the home page', () => {
  const card = landingHtml.match(/<a id="online-card"[^>]*>/)?.[0] ?? ''
  it('is highlighted, still goes to the online lobby, and remembers that it was used', () => {
    expect(card).not.toBe('')
    expect(card).toContain('class="mode-card invite-highlight"')
    expect(card).toContain(`[routerLink]="['/online']"`)
    expect(card).toContain('(click)="onOnlineCardClick()"')
    expect(landingHtml).toContain('<span class="invite-ribbon">Play with friends and family</span>')
    expect(landingHtml).toContain('<h2>Play online</h2>')
  })
  it('only pulses for people who have not asked their device to reduce motion', () => {
    expect(landingTs).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.mode-card\.invite-highlight \{\s*animation:/)
    expect(landingTs.match(/animation:/g)).toHaveLength(1) // the one animation is inside that media query
  })
  it('is the only highlighted card', () => {
    expect(landingHtml.match(/invite-highlight/g)).toHaveLength(1)
  })
})

describe('the popup', () => {
  it('is part of the home page, and only the home page', () => {
    expect(landingHtml).toContain('<app-invite-prompt />')
    expect(landingTs).toContain('InvitePromptComponent')
    expect(read('app.routes.ts')).not.toContain('invite-prompt')
  })
  it('is a proper dialog: labelled, described, modal, and closable with Escape, a click outside, and a visible button', () => {
    expect(popup).toContain('role="dialog"')
    expect(popup).toContain('aria-modal="true"')
    expect(popup).toContain('aria-labelledby="invite-title"')
    expect(popup).toContain('aria-describedby="invite-text"')
    expect(popup).toContain('id="invite-title"')
    expect(popup).toContain('id="invite-text"')
    expect(popup).toContain(`'(document:keydown.escape)': 'dismiss()'`)
    expect(popup).toContain('id="invite-backdrop"')
    // the click on the dark area is heard by the component, and only closes it when it lands on the backdrop itself
    expect(popup).toContain(`'(click)': 'onHostClick($event)'`)
    expect(popup).toMatch(/onHostClick\(event: MouseEvent\): void \{\s*if \(\(event\.target as HTMLElement \| null\)\?\.id === 'invite-backdrop'\) this\.dismiss\(\)/)
    expect(popup).toContain('id="invite-later"')
  })
  it('has the main button go to the online lobby, and keeps keyboard focus inside while open', () => {
    expect(popup).toMatch(/<a #primary id="invite-play" class="btn-gold" routerLink="\/online"/)
    expect(popup).toContain('(keydown)="onKeydown($event)"')
    expect(popup).toContain(`event.key !== 'Tab'`)
  })
  it('says what it is for, in plain words', () => {
    expect(popup).toContain('Play Seep with friends and family')
    expect(popup).toContain('send them the invite link')
    expect(popup).toContain('A free account is needed to play online.')
  })
  it('never appears on top of the privacy banner, and cancels its timer if the situation changes', () => {
    expect(popup).toContain('consentSettled(')
    expect(popup).toMatch(/visible = computed\(\(\) => this\.open\(\) && !this\.analytics\.bannerOpen\(\)\)/)
    expect(popup).toContain('onCleanup(() => clearTimeout(timer))')
  })
  it('remembers that it was seen however it is closed, and uses the shared rules, not its own', () => {
    expect(popup.match(/rememberInviteSeen\(/g)!.length).toBeGreaterThanOrEqual(2) // dismiss() and playOnline()
    expect(popup).toContain('shouldShowInvite(')
  })
  it('can be switched off by a test page, and is on by default', () => {
    expect(popup).toContain('INVITE_PROMPT_CONFIG')
    expect(popup).toMatch(/factory: \(\) => \(\{ enabled: true,/)
  })
})

describe('accessibility: only real buttons and links react to clicks (the project lint rule, checked here too)', () => {
  // The lint rules click-events-have-key-events and interactive-supports-focus refuse a click handler on anything that is not itself interactive,
  // because a keyboard or a screen reader cannot reach it. A click on the dark backdrop is therefore heard by the component, not by the <div>.
  const clickable = (source: string) => [...source.matchAll(/<([a-z][\w-]*)\b[^<>]*?\(click\)=/g)].map((m) => m[1])
  it('in the popup, every element with a click handler is a button or a link', () => {
    const tags = clickable(popup)
    expect(tags.length).toBeGreaterThanOrEqual(2) // Play online and Not now
    expect(tags.every((t) => t === 'a' || t === 'button')).toBe(true)
  })
  it('on the home page, the highlighted card (a link) is the only element with a click handler that this feature added', () => {
    expect(clickable(landingHtml.slice(landingHtml.indexOf('id="online-card"') - 5, landingHtml.indexOf('</a>', landingHtml.indexOf('id="online-card"')) + 4))).toEqual(['a'])
  })
})

describe('privacy: the home page must not start the sign-in service', () => {
  // Signing in loads Firebase. On the home page that would happen before a visitor has answered the privacy banner, so the popup works out
  // "have they been here before" from its own marker on this device, never from the sign-in state.
  it('neither the popup nor the home page uses AuthService or Firebase', () => {
    for (const source of [popup, landingTs, landingHtml]) {
      expect(source).not.toMatch(/AuthService|firebase|identity/i)
    }
  })
})
