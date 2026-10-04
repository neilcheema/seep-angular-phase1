import { Component } from '@angular/core'
import { RouterLink } from '@angular/router'
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
  /** "About five weeks": the days until a table is closed plus the days until a closed table is deleted. */
  readonly weeks = Math.round((LEGAL.retention.abandonAfterDays + LEGAL.retention.deleteAfterDays) / 7)
}
