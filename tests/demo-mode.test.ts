import { describe, expect, it } from 'vitest'
import {
  DEMO_BANNER_BODY,
  DEMO_SCAN_CODE,
  DEMO_SCAN_MESSAGE,
  isDemoMode,
  parseDemoFlag,
} from '@/lib/demo-mode'

/**
 * Demo mode exists to stop a preview deployment quietly shipping a degraded
 * product. With no scanners installed the pipeline still returns a handful of
 * fetch-only findings and confirms none of them, which looks like a finished
 * report to anyone who does not know better. For a tool whose whole claim is
 * "only when more than one scanner agrees", that is the worst possible way to
 * fail.
 */

describe('parseDemoFlag', () => {
  it('accepts the forms someone might actually type', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', ' true ', 'Yes']) {
      expect(parseDemoFlag(v)).toBe(true)
    }
  })

  it('defaults to off, including for values that merely look truthy', () => {
    for (const v of [undefined, '', '  ', '0', 'false', 'no', 'off', 'demo', 'null']) {
      expect(parseDemoFlag(v)).toBe(false)
    }
  })

  /**
   * Fail closed. An unrecognised value must not enable demo mode on a real
   * deployment, because that would silently disable scanning in production.
   */
  it('does not enable on an unrecognised value', () => {
    expect(parseDemoFlag('maybe')).toBe(false)
    expect(parseDemoFlag('2')).toBe(false)
  })
})

describe('isDemoMode', () => {
  /**
   * `isDemoMode` reads `process.env.NEXT_PUBLIC_DEMO_MODE` as a literal static
   * member expression, and must keep doing so.
   *
   * Next.js inlines NEXT_PUBLIC_ variables into the client bundle by textual
   * substitution, so it only replaces the literal form. The first version read
   * the value through a function parameter, which the compiler could not see:
   * the server got the real value and the browser got `undefined`, so the
   * server rendered the scan form while the client rendered the sample link
   * and React threw a hydration mismatch. It type-checked, and every unit test
   * passed. Only a real browser showed it.
   */
  it('is off by default in the test environment', () => {
    expect(isDemoMode()).toBe(false)
  })

  it('takes no arguments, so the env read cannot be indirected', () => {
    expect(isDemoMode.length).toBe(0)
  })
})

describe('demo copy', () => {
  it('names the missing capability rather than saying "unavailable"', () => {
    expect(DEMO_SCAN_MESSAGE).toMatch(/nmap/)
    expect(DEMO_SCAN_MESSAGE).toMatch(/sample report/i)
  })

  it('tells the reader the sample is real, not a mock-up', () => {
    expect(DEMO_BANNER_BODY).toMatch(/actual scan/i)
  })

  /** The house style rule: no em or en dashes in user-facing text. */
  it('carries no em or en dashes', () => {
    for (const copy of [DEMO_SCAN_MESSAGE, DEMO_BANNER_BODY]) {
      expect(copy).not.toMatch(/[—–]/)
    }
  })

  it('exposes a stable machine-readable code', () => {
    expect(DEMO_SCAN_CODE).toBe('demo_mode')
  })
})
