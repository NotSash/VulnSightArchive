import { describe, expect, it } from 'vitest'
import {
  activeScanCount,
  adoptScanSlot,
  guardScanRequest,
  releaseRateSlot,
  reserveRateSlot,
  resetGuardState,
  tryClaimScanSlot,
} from '@/lib/guard'
import { confidenceFor } from '@/lib/scanner/correlate'
import { parseNucleiLine } from '@/lib/scanner/nuclei'
import { buildRiskScore } from '@/lib/scanner/risk'
import { runCommand } from '@/lib/scanner/tools'
import { isPrivateAddress, validateTarget } from '@/lib/scanner/validate'

/**
 * Regression tests for the Phase 0 audit.
 *
 * Every case here failed before Phase 0.5. Each one maps to a finding in
 * `_for-myself/AUDIT.md` and asserts the property, not the implementation, so
 * the code can be rewritten without silently losing the guarantee.
 */

describe('A1: SSRF bypass via IPv4-mapped IPv6 in hex form', () => {
  /*
   * The WHATWG URL parser rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`
   * before validation runs. The old guard matched only the dotted spelling,
   * so loopback and the whole private range read as public. Both SSRF gates
   * shared that function, so both failed together.
   */
  const MUST_BLOCK = [
    ['::ffff:7f00:1', 'loopback, hex form: the original bypass'],
    ['::ffff:a00:1', '10.0.0.1, hex form'],
    ['::ffff:c0a8:1', '192.168.0.1, hex form'],
    ['::ffff:169.254.169.254', 'cloud metadata, dotted form'],
    ['64:ff9b::7f00:1', 'NAT64 wrapping loopback'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback, fully expanded'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique-local'],
    ['ff02::1', 'multicast'],
    ['2002:7f00:1::', '6to4 wrapping loopback'],
    ['not-an-address', 'unparseable must never read as public'],
  ] as const

  for (const [ip, why] of MUST_BLOCK) {
    it(`blocks ${ip} (${why})`, () => {
      expect(isPrivateAddress(ip)).toBe(true)
    })
  }

  it('still allows genuinely public addresses', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '8.8.8.8', '45.33.32.156']) {
      expect(isPrivateAddress(ip)).toBe(false)
    }
  })

  it('refuses the bypass at the validation gate too', () => {
    expect(validateTarget('https://[::ffff:127.0.0.1]/').ok).toBe(false)
    expect(validateTarget('https://[64:ff9b::127.0.0.1]/').ok).toBe(false)
    expect(validateTarget('https://[2606:4700:4700::1111]/').ok).toBe(true)
  })
})

describe('B1: one definition of an independent tool', () => {
  /*
   * The rule was implemented twice, by two maps that drifted. `browser` and
   * `browser-dom` were missing from the correlation map and fell back to
   * "their own family", so VulnSight's own render could be badged as two
   * agreeing tools.
   */
  it('never confirms two sources from the same channel', () => {
    for (const [a, b] of [
      ['header', 'cookie'],
      ['browser', 'browser-dom'],
      ['header', 'html'],
      ['header', 'ssl'],
      ['dns', 'exposure'],
    ]) {
      expect(confidenceFor([{ source: a }, { source: b }] as never)).not.toBe('confirmed')
    }
  })

  it('still confirms genuinely independent tools', () => {
    for (const [a, b] of [
      ['header', 'nmap'],
      ['nuclei', 'zap-passive'],
      ['browser', 'nvd'],
    ]) {
      expect(confidenceFor([{ source: a }, { source: b }] as never)).toBe('confirmed')
    }
  })
})

describe('B2: the printed score derivation always adds up', () => {
  // Band caps total 128, so a badly exposed site could be penalised past the
  // floor. The score clamped at 0 but the penalty list did not, and the report
  // renders that list above the total.
  it('penalties sum to exactly 100 minus the score', () => {
    for (const dist of [
      { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      { critical: 1, high: 2, medium: 3, low: 4, info: 9 },
      { critical: 3, high: 4, medium: 4, low: 4, info: 0 },
      { critical: 9, high: 9, medium: 9, low: 9, info: 0 },
    ]) {
      const risk = buildRiskScore(dist as never)
      const sum = risk.penalties.reduce((total, p) => total + p.points, 0)
      expect(sum).toBe(100 - risk.score)
    }
  })
})

describe('C1: a child that ignores SIGTERM still settles', () => {
  /*
   * `close` fires only once every stdio pipe is closed, and a killed shell can
   * leave a grandchild holding them open. Listening to `close` alone meant the
   * promise never settled, the concurrency slot was never released, and three
   * of those stopped a deployed instance accepting scans at all.
   */
  it('resolves rather than hanging forever', async () => {
    const startedAt = Date.now()
    const result = await runCommand('/bin/sh', ['-c', 'trap "" TERM; sleep 30'], {
      timeoutMs: 800,
    })
    expect(Date.now() - startedAt).toBeLessThan(6_000)
    expect(result.timedOut).toBe(true)
    expect(result.ok).toBe(false)
  }, 20_000)

  it('still captures output from a normal command', async () => {
    const result = await runCommand('/bin/sh', ['-c', 'echo hello; echo world'], {
      timeoutMs: 5_000,
    })
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('hello')
    expect(result.stdout).toContain('world')
  }, 20_000)
})

describe('C2: one malformed nuclei line cannot end a scan', () => {
  // `JSON.parse('null')` succeeds, so the try/catch never fired and the field
  // reads threw a TypeError.
  it('returns null instead of throwing', () => {
    for (const line of ['null', '[]', '"text"', '123', 'notjson', '']) {
      expect(() => parseNucleiLine(line)).not.toThrow()
      expect(parseNucleiLine(line)).toBeNull()
    }
  })
})

describe('D1: abuse controls hold under concurrent requests', () => {
  /*
   * The route read the counters, awaited DNS, then wrote. Every request in
   * that window saw the same pre-write state: 20 simultaneous requests started
   * 20 scans against a cap of 3.
   */
  it('20 concurrent requests start exactly maxConcurrent scans', async () => {
    resetGuardState()
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9' })

    const started = await Promise.all(
      Array.from({ length: 20 }, async (_unused, i) => {
        const guard = guardScanRequest({ hostname: 'example.com', headers, authorized: true })
        if (!guard.ok) return false

        const token = `pending:${i}`
        if (!tryClaimScanSlot(token)) return false

        const at = Date.now()
        const rate = reserveRateSlot(guard.clientKey, undefined, at)
        if (!rate.allowed) {
          releaseRateSlot(guard.clientKey, at)
          return false
        }

        await new Promise((resolve) => setTimeout(resolve, 5)) // the DNS await
        adoptScanSlot(token, `scan-${i}`)
        return true
      }),
    )

    expect(started.filter(Boolean).length).toBe(3)
    expect(activeScanCount()).toBe(3)
    resetGuardState()
  })

  it('a released reservation does not charge the caller', () => {
    resetGuardState()
    const at = Date.now()
    const first = reserveRateSlot('client', undefined, at)
    expect(first.allowed).toBe(true)
    releaseRateSlot('client', at)
    // The quota must be untouched after a rollback.
    expect(reserveRateSlot('client', undefined, at + 1).remaining).toBe(first.remaining)
    resetGuardState()
  })
})

describe('E1: the redirect timer is cancellable', () => {
  it('captures the completion timer so cleanup can clear it', () => {
    // A source assertion by necessity: the bug is that a handle was never
    // stored, which cannot be observed from outside the component.
    const source = readSource('components/scan/scan-progress.tsx')
    expect(source).toContain('timer = setTimeout(() => {')
    expect(source).toContain('if (active) router.push')
  })
})

describe('F1: the report nav tracks the whole page', () => {
  it('recomputes the active section rather than only setting on entry', () => {
    const source = readSource('components/results/report-nav.tsx')
    // The old code could only ever move forward, so the last section to
    // intersect stuck for the rest of the page.
    expect(source).not.toContain('if (entry.isIntersecting) {')
    expect(source).toContain('readingLine')
    // A scroll listener is required: short anchors produce no observer
    // callbacks through the middle of a long section.
    expect(source).toContain("window.addEventListener('scroll', pick")
    expect(source).toContain("window.removeEventListener('scroll', pick)")
  })
})

function readSource(relative: string): string {
  // Imported lazily so the browser-only components are never evaluated here.
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  return readFileSync(join(__dirname, '..', relative), 'utf8')
}
