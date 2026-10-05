import { Component, inject } from '@angular/core';
import { AnalyticsService } from '../../core/analytics.service';
import { RouterLink } from '@angular/router';
import { APP_VERSION } from '../../version';


/**
 * The app's home route: two entry points, one per game variant (spec §6).
 * Each link carries ?new=1 so the destination page starts a fresh game
 * immediately, rather than requiring a second "Deal" click once inside.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './landing.component.html',
})
export class LandingComponent {
  readonly appVersion = APP_VERSION;
  /** For the "Privacy choices" link, shown only when analytics is configured. */
  readonly analytics = inject(AnalyticsService);
}
