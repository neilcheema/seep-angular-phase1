/**
 * The facts the Privacy Policy and Terms state, in one place.
 *
 * `retention` MUST match what the server really does (lib/cleanup.ts in seep-api): a test there reads this file
 * and fails if the two drift apart, so the policy cannot quietly become untrue.
 */
export const LEGAL = {
  siteName: 'Seep',
  siteAddress: 'seep.quest',
  contactEmail: 'info@seep.quest',
  /** Who runs the site. Put your own name or business name here before relying on these pages. */
  operator: 'Narender Cheema',
  /** The law the Terms are governed by. Confirm this with a lawyer. */
  governingLaw: 'British Columbia, Canada',
  lastUpdated: '5 October 2026',
  minimumAge: 13,
  /** How long our monitoring records for the game server (Azure Application Insights) are kept. An Azure setting: checked in the portal, so no server test covers it. */
  monitoringLogDays: 90,
  analytics: {
    provider: 'Microsoft Clarity',
    privacyStatement: 'privacy.microsoft.com',
    /** How many days Clarity keeps recordings, read from the Clarity project's settings. Null until the owner has looked it up and set it. */
    retentionDays: 30 as number | null,
  },
  retention: {
    /** A table nobody has played at or looked at for this long is closed. */
    abandonAfterDays: 7,
    /** A finished or closed table is deleted this long after it ended or was closed. */
    deleteAfterDays: 30,
    /** After an account is deleted, an anonymous marker is kept this long so a stale sign-in cannot bring it back. */
    deletionMarkerHours: 48,
  },
} as const

/** Shared by the legal pages: a readable column on the table-green background. */
export const LEGAL_STYLES = `
  :host { display: block; }
  .page { min-height: 100%; overflow-y: auto; padding: 24px 20px 48px; }
  .column { max-width: 720px; margin: 0 auto; text-align: left; color: rgba(255,255,255,0.84); line-height: 1.6; font-size: 15px; }
  h1 { color: var(--gold-lt); font-size: 30px; font-weight: 800; margin: 12px 0 4px; }
  h2 { color: var(--gold-lt); font-size: 19px; font-weight: 700; margin: 28px 0 6px; }
  h3 { color: #fff; font-size: 15px; font-weight: 700; margin: 16px 0 2px; }
  .meta { color: rgba(255,255,255,0.55); font-size: 13px; margin: 0 0 18px; }
  .back { color: rgba(255,255,255,0.6); font-size: 13px; }
  ul { margin: 6px 0 6px 20px; padding: 0; }
  li { margin: 4px 0; }
  a.inline { color: var(--gold-lt); text-decoration: underline; }
  .box { border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 10px 14px; margin: 10px 0; background: rgba(0,0,0,0.18); }
`
