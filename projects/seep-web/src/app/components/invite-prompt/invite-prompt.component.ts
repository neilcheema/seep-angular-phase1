import { Component, ElementRef, InjectionToken, computed, effect, inject, signal, viewChild } from '@angular/core'
import { RouterLink } from '@angular/router'
import { AnalyticsService } from '../../core/analytics.service'
import {
  INVITE_DELAY_MS,
  type InviteStorage,
  consentSettled,
  readInviteSeen,
  rememberInviteSeen,
  shouldShowInvite,
} from '../../core/invite-prompt'

/** What the invitation needs from its surroundings. A test page can replace it (for example to switch the popup off, or to give it a fake clock). */
export interface InvitePromptConfig {
  readonly enabled: boolean
  readonly delayMs: number
  readonly now: () => Date
  readonly storage: InviteStorage | null
}

function browserStorage(): InviteStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null // some browsers refuse even to look at it when storage is blocked
  }
}

export const INVITE_PROMPT_CONFIG = new InjectionToken<InvitePromptConfig>('INVITE_PROMPT_CONFIG', {
  providedIn: 'root',
  factory: () => ({ enabled: true, delayMs: INVITE_DELAY_MS, now: () => new Date(), storage: browserStorage() }),
})

/**
 * The popup on the home page that invites people to play online with friends and family. The rules for when it may appear are in
 * core/invite-prompt.ts. In short: not on top of the privacy banner, once, and then not again for 30 days.
 */
@Component({
  selector: 'app-invite-prompt',
  standalone: true,
  imports: [RouterLink],
  // Escape closes it, and so does a click on the dark area around the box. The click is heard here rather than on the backdrop element: a plain
  // <div> that reacts to clicks is not something a keyboard or a screen reader can reach, and the accessibility lint rightly refuses it.
  host: { '(document:keydown.escape)': 'dismiss()', '(click)': 'onHostClick($event)' },
  template: `
    @if (visible()) {
      <div
        id="invite-backdrop"
        style="position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.62);"
      >
        <div
          id="invite-popup"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-title"
          aria-describedby="invite-text"
          (keydown)="onKeydown($event)"
          style="width: 100%; max-width: 380px; box-sizing: border-box; max-height: calc(100dvh - 32px); overflow-y: auto; padding: 22px 20px 18px; border-radius: 16px; border: 2px solid var(--gold-lt); background: #0b1d12; color: rgba(255, 255, 255, 0.92); text-align: center; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);"
        >
          <h2 id="invite-title" style="margin: 0 0 10px; color: var(--gold-lt); font-size: 22px; line-height: 1.2;">Play Seep with friends and family</h2>
          <p id="invite-text" style="margin: 0 0 8px; font-size: 15px; line-height: 1.5;">
            Make a free table, send them the invite link, and play together from wherever you are: two players, or four in teams.
          </p>
          <p style="margin: 0 0 16px; font-size: 13px; color: rgba(255, 255, 255, 0.65);">A free account is needed to play online.</p>
          <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
            <a #primary id="invite-play" class="btn-gold" routerLink="/online" (click)="playOnline()">Play online</a>
            <button type="button" id="invite-later" class="btn-outline" (click)="dismiss()">Not now</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class InvitePromptComponent {
  private readonly analytics = inject(AnalyticsService)
  private readonly config = inject(INVITE_PROMPT_CONFIG)
  private readonly primary = viewChild<ElementRef<HTMLElement>>('primary')

  private readonly open = signal(false)
  private readonly settled = computed(() =>
    consentSettled({ enabled: this.analytics.enabled(), choice: this.analytics.choice(), bannerOpen: this.analytics.bannerOpen() }),
  )
  /** Shown only while the privacy banner is also out of the way (a visitor may reopen it from "Privacy choices" at any time). */
  readonly visible = computed(() => this.open() && !this.analytics.bannerOpen())

  constructor() {
    // Schedule the popup once the privacy banner has been dealt with. The timer is cancelled if the situation changes before it fires.
    effect((onCleanup) => {
      if (!this.config.enabled || !this.settled()) return
      const seenAt = readInviteSeen(this.config.storage)
      if (!shouldShowInvite({ enabled: true, settled: true, seenAt, now: this.config.now() })) return
      const timer = setTimeout(() => this.open.set(true), this.config.delayMs)
      onCleanup(() => clearTimeout(timer))
    })
    // A keyboard user lands on the main button, not behind the popup.
    effect(() => {
      const button = this.primary()
      if (this.visible() && button) queueMicrotask(() => button.nativeElement.focus())
    })
  }

  dismiss(): void {
    if (!this.open()) return
    rememberInviteSeen(this.config.storage, this.config.now())
    this.open.set(false)
  }

  playOnline(): void {
    rememberInviteSeen(this.config.storage, this.config.now())
    this.open.set(false) // the link itself takes them to the online lobby
  }

  /** A click that lands on the dark area around the box (and not on anything inside it) closes the popup. */
  onHostClick(event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.id === 'invite-backdrop') this.dismiss()
  }

  /** Keeps Tab inside the popup while it is open. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return
    const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('a[href], button'))
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}
