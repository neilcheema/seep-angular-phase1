/**
 * Compares two dot-separated version strings (e.g. "1.3.0") numerically
 * per segment, not lexicographically \u2014 "1.10.0" correctly sorts above
 * "1.9.0", unlike a plain string comparison.
 * Negative if a < b, 0 if equal, positive if a > b.
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map((p) => parseInt(p, 10) || 0)
  const bParts = b.split('.').map((p) => parseInt(p, 10) || 0)
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const av = aParts[i] ?? 0
    const bv = bParts[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

export interface VersionCheckResult {
  readonly ok: boolean
  readonly clientVersion: string | null
  readonly minVersion: string | null
}

/**
 * Checks a client's declared app version (from the X-App-Version header)
 * against MIN_CLIENT_VERSION \u2014 an env var, unset by default, meaning no
 * check is enforced until an operator explicitly sets one. A request
 * with no version header at all is allowed through regardless of
 * MIN_CLIENT_VERSION: the point is telling a client that HAS declared an
 * old version to update, not rejecting every request that lacks the
 * header \u2014 which would also break manual testing (curl, Postman) and
 * any client written before this header existed.
 */
export function checkMinVersion(appVersionHeader: string | null | undefined): VersionCheckResult {
  const minVersion = process.env['MIN_CLIENT_VERSION']
  if (!minVersion || !appVersionHeader) {
    return { ok: true, clientVersion: appVersionHeader ?? null, minVersion: minVersion ?? null }
  }
  const ok = compareVersions(appVersionHeader, minVersion) >= 0
  return { ok, clientVersion: appVersionHeader, minVersion }
}
