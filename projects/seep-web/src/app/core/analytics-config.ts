/**
 * Your Microsoft Clarity project id. It is not a secret (it is visible in any page that uses Clarity); it came from app.component.ts.
 *
 * The consent banner and the Clarity loader work from this one value. If it is ever set to null (or something that is not a plausible
 * id), there is NO banner and Clarity NEVER loads, which is the safe state.
 */
export const ANALYTICS = {
  clarityProjectId: 'yo1jcfvwdm' as string | null,
} as const
