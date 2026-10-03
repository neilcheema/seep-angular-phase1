import { afterEach, describe, expect, it } from 'vitest'
import { checkMinVersion } from '../lib/version-check'

describe('checkMinVersion', () => {
  afterEach(() => {
    delete process.env['MIN_CLIENT_VERSION']
  })

  it('allows any request when MIN_CLIENT_VERSION is not set, even with a low client version', () => {
    const result = checkMinVersion('0.0.1')
    expect(result.ok).toBe(true)
  })

  it('allows a request with no version header at all, even when MIN_CLIENT_VERSION is set \u2014 the check only rejects a declared old version, not a missing one', () => {
    process.env['MIN_CLIENT_VERSION'] = '2.0.0'
    expect(checkMinVersion(null).ok).toBe(true)
    expect(checkMinVersion(undefined).ok).toBe(true)
  })

  it('rejects a client version below the minimum', () => {
    process.env['MIN_CLIENT_VERSION'] = '2.0.0'
    const result = checkMinVersion('1.9.0')
    expect(result.ok).toBe(false)
    expect(result.clientVersion).toBe('1.9.0')
    expect(result.minVersion).toBe('2.0.0')
  })

  it('allows a client version exactly equal to the minimum', () => {
    process.env['MIN_CLIENT_VERSION'] = '2.0.0'
    expect(checkMinVersion('2.0.0').ok).toBe(true)
  })

  it('allows a client version above the minimum', () => {
    process.env['MIN_CLIENT_VERSION'] = '2.0.0'
    expect(checkMinVersion('2.1.0').ok).toBe(true)
  })

  it('compares version segments numerically, not lexicographically \u2014 1.10.0 is newer than 1.9.0', () => {
    process.env['MIN_CLIENT_VERSION'] = '1.10.0'
    expect(checkMinVersion('1.9.0').ok).toBe(false) // a naive string compare would wrongly say '1.9.0' > '1.10.0'
    expect(checkMinVersion('1.10.0').ok).toBe(true)
    expect(checkMinVersion('1.11.0').ok).toBe(true)
  })

  it('handles version strings with a different number of segments', () => {
    process.env['MIN_CLIENT_VERSION'] = '1.2.0'
    expect(checkMinVersion('1.2').ok).toBe(true) // treated as 1.2.0
    expect(checkMinVersion('1.1.9').ok).toBe(false)
  })
})
