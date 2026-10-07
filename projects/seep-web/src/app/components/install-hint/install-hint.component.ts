import { Component, signal } from '@angular/core'
import { readDeviceEnv, shouldShowInstallHint } from '../../core/install-mode'

const DISMISSED_KEY = 'seep.install-hint-dismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false // storage can be blocked; the hint then simply shows each time
  }
}

/** On an iPhone or iPad in a browser, a one-line suggestion to add Seep to the Home Screen. Gone once installed, or once dismissed. */
@Component({
  selector: 'app-install-hint',
  standalone: true,
  template: `
    @if (visible()) {
      <aside id="install-hint" role="note" style="max-width: 480px; margin: 18px auto 0; padding: 10px 14px; border: 1px solid var(--gold); border-radius: 10px; background: rgba(0, 0, 0, 0.3); color: rgba(255, 255, 255, 0.9); font-size: 14px; line-height: 1.5; text-align: center;">
        <strong style="color: var(--gold-lt);">Want Seep on your Home Screen?</strong>
        Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>. It opens full screen, like an app.
        <div style="margin-top: 6px;">
          <button type="button" id="install-hint-dismiss" class="btn-outline" style="padding: 2px 12px; font-size: 13px;" (click)="dismiss()">No thanks</button>
        </div>
      </aside>
    }
  `,
})
export class InstallHintComponent {
  readonly visible = signal(shouldShowInstallHint(readDeviceEnv(), wasDismissed()))

  dismiss(): void {
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // nothing to do: it is hidden for this visit either way
    }
    this.visible.set(false)
  }
}
