import { Component, inject } from '@angular/core'
import { RouterLink } from '@angular/router'
import { AnalyticsService } from '../../core/analytics.service'

/**
 * The analytics choice: shown on a first visit, and again whenever someone opens "Privacy choices". Accept and Decline are
 * the same size and style on purpose, and the site works exactly the same either way. It never blocks the page.
 */
@Component({
  selector: 'app-analytics-banner',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (analytics.bannerOpen()) {
      <section
        id="analytics-banner"
        role="region"
        aria-label="Analytics choice"
        style="position: fixed; left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 60; max-width: 560px; margin: 0 auto; box-sizing: border-box; background: rgba(8, 28, 16, 0.97); border: 1px solid var(--gold-lt); border-radius: 12px; padding: 12px 14px; color: #fff; font-size: 13px; line-height: 1.45; text-align: left; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);"
      >
        <p style="margin: 0 0 8px;">
          May we use <strong>Microsoft Clarity</strong> to see how people use Seep? It records clicks, scrolling and screen recordings, and
          sends them to Microsoft. It is optional: Seep works exactly the same either way.
          <a routerLink="/privacy" style="color: var(--gold-lt); text-decoration: underline;">Privacy Policy</a>
        </p>
        @if (analytics.choice(); as current) {
          <p id="analytics-current" style="margin: 0 0 8px; color: rgba(255,255,255,0.75);">Your current choice: {{ current === 'granted' ? 'Accepted' : 'Declined' }}.</p>
        }
        <div style="display: flex; gap: 8px;">
          <button type="button" id="analytics-accept" class="btn-outline" style="flex: 1; padding: 8px 10px;" (click)="analytics.accept()">Accept</button>
          <button type="button" id="analytics-decline" class="btn-outline" style="flex: 1; padding: 8px 10px;" (click)="analytics.decline()">Decline</button>
        </div>
        @if (analytics.choice() !== null) {
          <button type="button" id="analytics-close" style="margin-top: 8px; background: none; border: 0; padding: 0; font: inherit; color: rgba(255,255,255,0.7); text-decoration: underline; cursor: pointer;" (click)="analytics.closeChoices()">Keep my choice</button>
        }
      </section>
    }
  `,
})
export class AnalyticsBannerComponent {
  readonly analytics = inject(AnalyticsService)
}
