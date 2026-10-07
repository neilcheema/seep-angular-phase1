import { Component, inject } from '@angular/core';
import { AnalyticsService } from '../../core/analytics.service';
import { RouterLink } from '@angular/router';
import { InstallHintComponent } from '../../components/install-hint/install-hint.component';
import { isInstalledApp, readDeviceEnv } from '../../core/install-mode';
import { APP_VERSION } from '../../version';


/**
 * The app's home route: two entry points, one per game variant (spec §6).
 * Each link carries ?new=1 so the destination page starts a fresh game
 * immediately, rather than requiring a second "Deal" click once inside.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink, InstallHintComponent],
  templateUrl: './landing.component.html',
})
export class LandingComponent {
  readonly appVersion = APP_VERSION;
  /** For the "Privacy choices" link, shown only when analytics is configured. */
  readonly analytics = inject(AnalyticsService);
  /** True when Seep is running from the Home Screen; the "put it on your home screen" guides are then hidden. */
  readonly installedApp = isInstalledApp(readDeviceEnv());
}
