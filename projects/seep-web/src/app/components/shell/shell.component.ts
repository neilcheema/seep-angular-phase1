import { Component, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { AnalyticsService } from '../../core/analytics.service'
import { AnalyticsBannerComponent } from '../analytics-banner/analytics-banner.component'

/**
 * Wraps every page, so the analytics choice appears on all of them (including a page reached through an invite link) without
 * each page having to know about it. `display: contents` means it adds no box of its own: the pages lay out exactly as before.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, AnalyticsBannerComponent],
  host: { style: 'display: contents' },
  template: '<router-outlet /><app-analytics-banner />',
})
export class ShellComponent {
  constructor() {
    inject(AnalyticsService).init()
  }
}
