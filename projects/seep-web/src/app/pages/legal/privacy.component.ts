import { Component, inject } from '@angular/core'
import { RouterLink } from '@angular/router'
import { CLARITY_OWN_COOKIES, CLARITY_SITE_COOKIES } from '../../core/analytics-consent'
import { AnalyticsService } from '../../core/analytics.service'
import { LEGAL, LEGAL_STYLES } from './legal-config'

/** The Privacy Policy. Its numbers come from legal-config.ts, which a server test keeps in line with the real behaviour. */
@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [RouterLink],
  styles: [LEGAL_STYLES],
  templateUrl: './privacy.component.html',
})
export class PrivacyComponent {
  readonly legal = LEGAL
  readonly analytics = inject(AnalyticsService)
  /** The Clarity cookies the page lists are the very ones the code removes when someone declines, so they cannot drift apart. */
  readonly siteCookies = CLARITY_SITE_COOKIES
  readonly ownCookies = CLARITY_OWN_COOKIES
  /** "About five weeks": the days until a table is closed plus the days until a closed table is deleted. */
  readonly weeks = Math.round((LEGAL.retention.abandonAfterDays + LEGAL.retention.deleteAfterDays) / 7)
}
