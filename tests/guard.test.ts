import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  accessCodeRequired,
  accessCodeValid,
  activeScanCount,
  beginScan,
  checkRateLimit,
  clientKey,
  endScan,
  guardLimits,
  guardScanRequest,
  isBlockedHost,
  recordScan,
  resetGuardState,
} from '@/lib/guard'

/**
 * Abuse controls.
 *
 * These tests exist because every one of these controls fails silently when it
 * breaks. A blocklist that stops matching, or a rate limiter that never trips,
 * looks exactly like a working one right up until the instance is being used
 * to scan somebody else's infrastructure.
 */

function headers(entries: Record<string, string> = {}): Headers {
  return new Headers(entries)
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  resetGuardState()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  resetGuardState()
})

describe('isBlockedHost', () => {
  it('blocks government and military domains', () => {
    for (const host of [
      'agency.gov',
      'army.mil',
      'service.gov.uk',
      'india.gov.in',
      'canada.gc.ca',
      'nic.in',
    ]) {
      expect(isBlockedHost(host)).toBe(true)
    }
  })

  it('blocks cloud and CDN control planes', () => {
    for (const host of [
      's3.amazonaws.com',
      'management.azure.com',
      'storage.googleapis.com',
      'metadata.google.internal',
      'api.cloudflare.com',
      'e1234.akamaiedge.net',
    ]) {
      expect(isBlockedHost(host)).toBe(true)
    }
  })

  it('does not block ordinary sites that merely resemble a blocked suffix', () => {
    // The classic suffix-matching bug: `notgov.com` ends with "gov.com", and a
    // naive `includes` would refuse to scan a legitimate customer site.
    for (const host of [
      'notgov.com',
      'mygovernment.io',
      'example.com',
      'cloudflare-tips.dev',
      'amazonaws.example.com',
      'scanme.nmap.org',
    ]) {
      expect(isBlockedHost(host)).toBe(false)
    }
  })

  it('is case-insensitive and tolerates a trailing dot', () => {
    expect(isBlockedHost('AGENCY.GOV')).toBe(true)
    expect(isBlockedHost('agency.gov.')).toBe(true)
  })

  it('blocks named infrastructure hosts exactly', () => {
    expect(isBlockedHost('localhost')).toBe(true)
    expect(isBlockedHost('dns.google')).toBe(true)
    expect(isBlockedHost('notlocalhost')).toBe(false)
  })

  it('treats an empty hostname as not blocked, leaving it to validation', () => {
    expect(isBlockedHost('')).toBe(false)
    expect(isBlockedHost('   ')).toBe(false)
  })
})

describe('clientKey', () => {
  it('uses the leftmost X-Forwarded-For entry', () => {
    expect(clientKey(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe(
      '203.0.113.7',
    )
  })

  it('falls back to X-Real-IP', () => {
    expect(clientKey(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  it('buckets unidentifiable callers together rather than exempting them', () => {
    // Failing open here would make the rate limit trivially bypassable by
    // stripping headers.
    expect(clientKey(headers())).toBe('unknown')
  })
})

describe('checkRateLimit and recordScan', () => {
  const limits = { perClient: 3, windowMs: 60_000, maxConcurrent: 10 }

  it('allows a new client the full quota', () => {
    const decision = checkRateLimit('a', limits)
    expect(decision.allowed).toBe(true)
    expect(decision.remaining).toBe(3)
  })

  it('counts only recorded scans, so a rejected request costs nothing', () => {
    checkRateLimit('a', limits)
    checkRateLimit('a', limits)
    checkRateLimit('a', limits)
    expect(checkRateLimit('a', limits).remaining).toBe(3)
  })

  it('blocks the caller once the quota is spent', () => {
    for (let i = 0; i < 3; i += 1) recordScan('a')
    const decision = checkRateLimit('a', limits)
    expect(decision.allowed).toBe(false)
    expect(decision.remaining).toBe(0)
    expect(decision.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('tracks clients independently', () => {
    for (let i = 0; i < 3; i += 1) recordScan('a')
    expect(checkRateLimit('a', limits).allowed).toBe(false)
    expect(checkRateLimit('b', limits).allowed).toBe(true)
  })

  it('forgives hits once they age out of the window', () => {
    const start = 1_000_000
    for (let i = 0; i < 3; i += 1) recordScan('a', start)
    expect(checkRateLimit('a', limits, start + 1000).allowed).toBe(false)
    expect(checkRateLimit('a', limits, start + 61_000).allowed).toBe(true)
  })

  it('reports a retry delay that shrinks as the window advances', () => {
    const start = 1_000_000
    for (let i = 0; i < 3; i += 1) recordScan('a', start)
    const early = checkRateLimit('a', limits, start + 1_000).retryAfterSeconds
    const later = checkRateLimit('a', limits, start + 30_000).retryAfterSeconds
    expect(later).toBeLessThan(early)
  })
})

describe('guardLimits', () => {
  it('defaults conservatively for a two-core host', () => {
    const limits = guardLimits({} as unknown as NodeJS.ProcessEnv)
    expect(limits.perClient).toBe(5)
    expect(limits.windowMs).toBe(3_600_000)
    expect(limits.maxConcurrent).toBe(3)
  })

  it('accepts deployment overrides', () => {
    const limits = guardLimits({
      RATE_LIMIT_PER_CLIENT: '20',
      MAX_CONCURRENT_SCANS: '8',
    } as unknown as NodeJS.ProcessEnv)
    expect(limits.perClient).toBe(20)
    expect(limits.maxConcurrent).toBe(8)
  })

  it('ignores nonsense values rather than disabling the limit', () => {
    // `MAX_CONCURRENT_SCANS=0` would wedge the instance; `-1` or "lots" would
    // be a silent removal of the control.
    const limits = guardLimits({
      RATE_LIMIT_PER_CLIENT: '0',
      MAX_CONCURRENT_SCANS: 'lots',
    } as unknown as NodeJS.ProcessEnv)
    expect(limits.perClient).toBe(5)
    expect(limits.maxConcurrent).toBe(3)
  })
})

describe('concurrency accounting', () => {
  it('counts scans in flight and releases them', () => {
    expect(activeScanCount()).toBe(0)
    beginScan('vs_1')
    beginScan('vs_2')
    expect(activeScanCount()).toBe(2)
    endScan('vs_1')
    expect(activeScanCount()).toBe(1)
  })

  it('is idempotent, so a double release cannot create free capacity', () => {
    beginScan('vs_1')
    endScan('vs_1')
    endScan('vs_1')
    expect(activeScanCount()).toBe(0)
  })
})

describe('access code', () => {
  it('is not required when unset, keeping the instance public by default', () => {
    process.env.ACCESS_CODE = ''
    expect(accessCodeRequired(process.env)).toBe(false)
    expect(accessCodeValid(undefined, process.env)).toBe(true)
  })

  it('accepts only the exact configured code', () => {
    const env = { ACCESS_CODE: 'letmein' } as unknown as NodeJS.ProcessEnv
    expect(accessCodeValid('letmein', env)).toBe(true)
    expect(accessCodeValid('  letmein  ', env)).toBe(true)
    expect(accessCodeValid('letmeih', env)).toBe(false)
    expect(accessCodeValid('let', env)).toBe(false)
    expect(accessCodeValid('letmeinnn', env)).toBe(false)
    expect(accessCodeValid(undefined, env)).toBe(false)
  })
})

describe('guardScanRequest', () => {
  const base = { hostname: 'example.com', headers: headers({ 'x-real-ip': '203.0.113.9' }) }

  it('approves a well-formed authorised request', () => {
    const result = guardScanRequest({ ...base, authorized: true })
    expect(result.ok).toBe(true)
  })

  it('refuses a scan the requester has not affirmed authorisation for', () => {
    const result = guardScanRequest({ ...base, authorized: false })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.code).toBe('not_authorized')
    }
  })

  it('refuses a blocklisted host even when authorisation is claimed', () => {
    // The checkbox is an assertion by an anonymous stranger. For these targets
    // it is not a credible one, so the blocklist must win.
    const result = guardScanRequest({ ...base, hostname: 'agency.gov', authorized: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('blocked_host')
  })

  it('refuses when the instance is already at its concurrency ceiling', () => {
    const limits = guardLimits()
    for (let i = 0; i < limits.maxConcurrent; i += 1) beginScan(`vs_${i}`)
    const result = guardScanRequest({ ...base, authorized: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.code).toBe('busy')
      expect(result.retryAfterSeconds).toBeGreaterThan(0)
    }
  })

  it('refuses once the caller exhausts their quota, with a wait time', () => {
    const limits = guardLimits()
    for (let i = 0; i < limits.perClient; i += 1) recordScan('203.0.113.9')
    const result = guardScanRequest({ ...base, authorized: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(429)
      expect(result.retryAfterSeconds).toBeGreaterThan(0)
      expect(result.message).toMatch(/minute/)
    }
  })

  it('reports the missing access code before anything else', () => {
    // Ordering matters: a private instance should not disclose whether a host
    // is blocked, or how busy it is, to someone without the code.
    process.env.ACCESS_CODE = 'secret'
    const result = guardScanRequest({
      ...base,
      hostname: 'agency.gov',
      authorized: false,
      accessCode: 'wrong',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('access_code')
  })

  it('returns the identified client so the caller can record the scan', () => {
    const result = guardScanRequest({ ...base, authorized: true })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.clientKey).toBe('203.0.113.9')
  })
})
