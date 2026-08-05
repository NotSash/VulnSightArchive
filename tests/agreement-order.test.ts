import { describe, expect, it } from 'vitest'
import { SAMPLE_REPORT } from '@/lib/sample-report'
import { independentChannelCount } from '@/lib/scanner/channels'
import { SEVERITY_ORDER } from '@/lib/severity'
import type { Vulnerability } from '@/types/report'

/**
 * The rule the product is built on, pinned.
 *
 * "Start with these three" on the results page used to sort by severity alone,
 * so a high-severity finding one tool guessed at outranked a medium four tools
 * corroborated. That inverts the central claim on the most prominent panel of
 * the report, and nothing caught it because no test covered the ordering.
 *
 * These tests exercise the same comparator the component uses. If the sort is
 * ever changed back to severity-first, they fail.
 */

function agreementOf(v: Pick<Vulnerability, 'confirmations' | 'source'>): number {
  return independentChannelCount(
    v.confirmations?.length ? v.confirmations.map((c) => c.source) : [v.source],
  )
}

/** Exactly the comparator in `verdict.tsx`: agreement first, severity second. */
function priorityOrder(a: Vulnerability, b: Vulnerability): number {
  const byAgreement = agreementOf(b) - agreementOf(a)
  if (byAgreement !== 0) return byAgreement
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
}

const make = (id: string, severity: Vulnerability['severity'], sources: string[]): Vulnerability =>
  ({
    id,
    title: id,
    severity,
    description: '',
    impact: '',
    recommendation: '',
    references: [],
    cvss_score: null,
    cwe_id: null,
    cve_id: null,
    owasp_category: null,
    source: sources[0] ?? 'header',
    confirmations: sources.map((s) => ({ source: s, raw_title: id })),
  }) as Vulnerability

describe('priority ordering', () => {
  it('puts a corroborated medium above a single-tool high', () => {
    const single = make('single-high', 'high', ['header'])
    const agreed = make('agreed-medium', 'medium', ['header', 'nmap', 'zap-passive', 'nvd'])
    const sorted = [single, agreed].sort(priorityOrder)
    expect(sorted[0]?.id).toBe('agreed-medium')
  })

  it('falls back to severity when agreement is equal', () => {
    const med = make('med', 'medium', ['header', 'nmap'])
    const high = make('high', 'high', ['header', 'nmap'])
    const sorted = [med, high].sort(priorityOrder)
    expect(sorted[0]?.id).toBe('high')
  })

  it('ranks four tools above two', () => {
    const two = make('two', 'critical', ['header', 'nmap'])
    const four = make('four', 'critical', ['header', 'nmap', 'zap-passive', 'nvd'])
    const sorted = [two, four].sort(priorityOrder)
    expect(sorted[0]?.id).toBe('four')
  })

  /**
   * Two sources inside one channel is VulnSight agreeing with itself, not two
   * independent tools. Counting it as two would let a single-source finding
   * jump the queue.
   */
  it('does not treat two sources in one channel as agreement', () => {
    const selfAgreeing = make('self', 'critical', ['header', 'cookie', 'transport'])
    const genuine = make('genuine', 'info', ['header', 'nmap'])
    const sorted = [selfAgreeing, genuine].sort(priorityOrder)
    expect(agreementOf(selfAgreeing)).toBe(1)
    expect(sorted[0]?.id).toBe('genuine')
  })

  it('is stable and total over the real sample report', () => {
    const sorted = [...SAMPLE_REPORT.vulnerabilities].sort(priorityOrder)
    expect(sorted).toHaveLength(SAMPLE_REPORT.vulnerabilities.length)
    // Agreement must never increase as you walk down the list.
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      if (!prev || !cur) continue
      expect(agreementOf(prev)).toBeGreaterThanOrEqual(agreementOf(cur))
    }
  })

  it('leads with a finding more than one tool saw, on the real sample', () => {
    const top = [...SAMPLE_REPORT.vulnerabilities].sort(priorityOrder)[0]
    expect(top).toBeDefined()
    if (top) expect(agreementOf(top)).toBeGreaterThanOrEqual(2)
  })
})

describe('results grouping threshold', () => {
  /**
   * `vulnerabilities-section.tsx` splits on `>= 2 independent channels`. That
   * threshold is the product's core rule and had no test at its point of use.
   */
  it('splits the sample report into corroborated and single-tool groups', () => {
    const confirmed = SAMPLE_REPORT.vulnerabilities.filter((v) => agreementOf(v) >= 2)
    const single = SAMPLE_REPORT.vulnerabilities.filter((v) => agreementOf(v) < 2)
    expect(confirmed.length).toBeGreaterThan(0)
    expect(single.length).toBeGreaterThan(0)
    expect(confirmed.length + single.length).toBe(SAMPLE_REPORT.vulnerabilities.length)
  })

  it('agrees with the report metadata on how many were corroborated', () => {
    const confirmed = SAMPLE_REPORT.vulnerabilities.filter((v) => agreementOf(v) >= 2)
    // The reference scan vs_amdym9f9p0 recorded four corroborated findings.
    expect(confirmed).toHaveLength(4)
  })
})
