import { Component, inject } from '@angular/core';
import { INVITE_PROMPT_CONFIG, InvitePromptComponent } from '../../components/invite-prompt/invite-prompt.component';
import { rememberInviteSeen } from '../../core/invite-prompt';
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
  imports: [RouterLink, InstallHintComponent, InvitePromptComponent],
  templateUrl: './landing.component.html',
  // The Play online card is the one thing on this page the owner wants noticed: a gold edge, a soft glow that gently pulses, and a label.
  // The pulse is switched off for anyone whose device is set to reduce motion.
  styles: [
    `
      .mode-card.invite-highlight {
        border: 2px solid var(--gold-lt);
        background: linear-gradient(160deg, rgba(212, 175, 55, 0.16), rgba(0, 0, 0, 0.18));
        box-shadow: 0 0 18px rgba(212, 175, 55, 0.35);
      }
      .invite-ribbon {
        align-self: flex-start;
        margin-bottom: 4px;
        padding: 2px 10px;
        border-radius: 999px;
        background: var(--gold-lt);
        color: #1b1400;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      @media (prefers-reduced-motion: no-preference) {
        .mode-card.invite-highlight {
          animation: invite-glow 2.8s ease-in-out infinite;
        }
      }
      @keyframes invite-glow {
        0%,
        100% {
          box-shadow: 0 0 10px rgba(212, 175, 55, 0.25);
        }
        50% {
          box-shadow: 0 0 26px rgba(212, 175, 55, 0.7);
        }
      }
    `,
  ],
})
export class LandingComponent {
  readonly appVersion = APP_VERSION;
  /** For the "Privacy choices" link, shown only when analytics is configured. */
  readonly analytics = inject(AnalyticsService);
  /** True when Seep is running from the Home Screen; the "put it on your home screen" guides are then hidden. */
  readonly installedApp = isInstalledApp(readDeviceEnv());
  private readonly invite = inject(INVITE_PROMPT_CONFIG);

  /** Someone who goes to Play online by the card has seen what the popup would have said, so it should not follow them with it later. */
  onOnlineCardClick(): void {
    rememberInviteSeen(this.invite.storage, this.invite.now());
  }
}
