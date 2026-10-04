import { Component } from '@angular/core'
import { RouterLink } from '@angular/router'
import { LEGAL, LEGAL_STYLES } from './legal-config'

/** The Terms of Use. */
@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterLink],
  styles: [LEGAL_STYLES],
  templateUrl: './terms.component.html',
})
export class TermsComponent {
  readonly legal = LEGAL
}
