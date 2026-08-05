import { describe, expect, it } from 'vitest'
import { isSampleId, SAMPLE_REPORT } from '@/lib/sample-report'
import { SEVERITY_ORDER } from '@/lib/severity'

/**
 * The sample is permanently linked from the homepage, so it has to stay
 * internally consistent. It is also the first thing many visitors will read,
 * which makes an inconsistency here more damaging than one in a live report.
 */
describe('sample report', () => {
  it('is recognised by its id', () => {
    expect(isSampleId('sample')).toBe(true)
    expect(isSampleId('vs_abc123')).toBe(false)
  })

  it('has a severity distribution matching its findings', () => {
    const counted = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    for (const v of SAMPLE_REPORT.vulnerabilities) counted[v.severity] += 1
    expect(counted).toEqual(SAMPLE_REPORT.severity_distribution)
  })

  it('reports the finding count quoted on the marketing page', () => {
    expect(SAMPLE_REPORT.vulnerabilities).toHaveLength(15)
  })

  it('has exactly four findings confirmed by more than one tool', () => {
    const confirmed = SAMPLE_REPORT.vulnerabilities.filter(
      (v) => (v.confirmations?.length ?? 0) > 1,
    )
    expect(confirmed).toHaveLength(4)
    // Every confirmation must name a distinct source: two observations from the
    // same tool are not independent agreement.
    for (const v of confirmed) {
      const sources = v.confirmations?.map((c) => c.source) ?? []
      expect(new Set(sources).size).toBe(sources.length)
    }
  })

  it('never marks a single-source finding as confirmed', () => {
    for (const v of SAMPLE_REPORT.vulnerabilities) {
      if (v.confidence === 'confirmed') {
        expect((v.confirmations?.length ?? 0) > 1).toBe(true)
      }
    }
  })

  it('has penalties that sum to exactly 100 minus the score', () => {
    const total = SAMPLE_REPORT.risk.penalties.reduce((sum, p) => sum + p.points, 0)
    expect(total).toBe(100 - SAMPLE_REPORT.risk.score)
  })

  it('does not present uncollected TLS data as a failed certificate', () => {
    // `valid: false` with `available: false` means "not checked", and the UI
    // relies on that distinction.
    expect(SAMPLE_REPORT.ssl.available).toBe(false)
    expect(SAMPLE_REPORT.ssl.grade).toBe('N/A')
  })

  it('uses only known severities', () => {
    for (const v of SAMPLE_REPORT.vulnerabilities) {
      expect(SEVERITY_ORDER).toContain(v.severity)
    }
  })

  it('gives every finding a unique id', () => {
    const ids = SAMPLE_REPORT.vulnerabilities.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('declares the summary was not written by a model', () => {
    expect(SAMPLE_REPORT.ai.available).toBe(false)
    expect(SAMPLE_REPORT.ai.generated_by).toBe('deterministic')
  })
})
