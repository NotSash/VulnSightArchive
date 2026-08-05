import { describe, expect, it } from 'vitest'
import { confidenceFor, correlateFindings, correlationKey } from '@/lib/scanner/correlate'
import { buildRiskScore, buildSeverityDistribution } from '@/lib/scanner/risk'
import type { Vulnerability } from '@/types/report'

type Finding = Omit<Vulnerability, 'id'>

/**
 * Correlation behaviour.
 *
 * Two failure modes matter, and they pull in opposite directions:
 *
 * - Under-merging leaves the report padded with duplicates and inflates the
 *   risk penalty for a single weakness.
 * - Over-merging hides a real finding inside an unrelated one, which is worse.
 *
 * The tests below cover both directions deliberately: the "must NOT merge"
 * group is as important as the "must merge" group.
 */

function finding(overrides: Partial<Finding> & { title: string; source: string }): Finding {
  return {
    severity: 'medium',
    description: 'description',
    impact: 'impact',
    recommendation: 'recommendation',
    references: [],
    cvss_score: null,
    cwe_id: null,
    cve_id: null,
    owasp_category: null,
    ...overrides,
  }
}

/** Assign ids the way the pipeline does, so tests mirror production shape. */
function correlate(findings: Finding[]) {
  return correlateFindings(findings)
}

describe('correlationKey', () => {
  it('uses the CVE id when one is present', () => {
    const key = correlationKey(
      finding({ title: 'Anything', source: 'nuclei', cve_id: 'CVE-2021-41773' }),
    )
    expect(key).toBe('cve:CVE-2021-41773')
  })

  it('normalises CVE id casing', () => {
    const lower = correlationKey(finding({ title: 'x', source: 'nvd', cve_id: 'cve-2021-41773' }))
    const upper = correlationKey(
      finding({ title: 'y', source: 'nuclei', cve_id: 'CVE-2021-41773' }),
    )
    expect(lower).toBe(upper)
  })

  it('recognises a canonical topic regardless of wording', () => {
    const ours = correlationKey(
      finding({ title: 'Content-Security-Policy header not set', source: 'header' }),
    )
    const zap = correlationKey(finding({ title: 'CSP Header Not Set', source: 'zap-passive' }))
    expect(ours).toBe(zap)
  })

  it('falls back to CWE plus location', () => {
    const key = correlationKey(
      finding({
        title: 'Unusual issue',
        source: 'nuclei',
        cwe_id: 'CWE-79',
        location: 'https://x.test/a',
      }),
    )
    expect(key).toContain('cwe:CWE-79')
  })

  it('falls back to a normalized title as a last resort', () => {
    const key = correlationKey(finding({ title: 'Some Very Specific Issue', source: 'nuclei' }))
    expect(key).toBe('title:some very specific issue')
  })

  it('ignores query strings when scoping by location', () => {
    const a = correlationKey(
      finding({
        title: 'Directory listing enabled',
        source: 'nuclei',
        location: 'https://x.test/files?page=1',
      }),
    )
    const b = correlationKey(
      finding({
        title: 'Directory browsing',
        source: 'zap-passive',
        location: 'https://x.test/files?page=2',
      }),
    )
    expect(a).toBe(b)
  })
})

describe('correlateFindings — merging duplicates', () => {
  it('merges the same CSP finding reported by three tools', () => {
    // This is the exact case that inflated the risk score: one weakness,
    // three findings, three penalties.
    const result = correlate([
      finding({
        title: 'Content-Security-Policy header not set',
        source: 'header',
        severity: 'medium',
      }),
      finding({ title: 'Missing CSP Header', source: 'nuclei', severity: 'low' }),
      finding({
        title: 'Content Security Policy (CSP) Header Not Set',
        source: 'zap-passive',
        severity: 'medium',
      }),
    ])

    expect(result.findings).toHaveLength(1)
    expect(result.mergedCount).toBe(2)
    expect(result.findings[0].confirmations).toHaveLength(3)
    expect(result.findings[0].confidence).toBe('confirmed')
  })

  it('names every contributing source on the merged finding', () => {
    const result = correlate([
      finding({ title: 'Content-Security-Policy header not set', source: 'header' }),
      finding({ title: 'CSP Header Not Set', source: 'zap-passive' }),
    ])
    const sources = result.findings[0].confirmations?.map((c) => c.source).sort()
    expect(sources).toEqual(['header', 'zap-passive'])
  })

  it('merges a CVE found independently by NVD and Nuclei', () => {
    // The highest-value correlation: version inference corroborated by an
    // active template match.
    const result = correlate([
      finding({
        title: 'CVE-2021-41773 affects Apache httpd 2.4.49',
        source: 'nvd',
        cve_id: 'CVE-2021-41773',
        severity: 'critical',
        cvss_score: 9.8,
      }),
      finding({
        title: 'Apache 2.4.49 - Path Traversal',
        source: 'nuclei',
        cve_id: 'CVE-2021-41773',
        severity: 'critical',
        evidence: 'root:x:0:0:root:/root:/bin/bash',
      }),
    ])

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].confidence).toBe('confirmed')
    expect(result.findings[0].cve_id).toBe('CVE-2021-41773')
  })

  it('takes the highest severity any source assigned', () => {
    const result = correlate([
      finding({ title: 'CSP Header Not Set', source: 'zap-passive', severity: 'low' }),
      finding({
        title: 'Content-Security-Policy header not set',
        source: 'header',
        severity: 'high',
      }),
    ])
    expect(result.findings[0].severity).toBe('high')
  })

  it('takes the highest CVSS score and ignores nulls', () => {
    const result = correlate([
      finding({ title: 'CSP Header Not Set', source: 'zap-passive', cvss_score: null }),
      finding({
        title: 'Content-Security-Policy header not set',
        source: 'header',
        cvss_score: 5.3,
      }),
    ])
    expect(result.findings[0].cvss_score).toBe(5.3)
  })

  it('unions references across sources', () => {
    const result = correlate([
      finding({
        title: 'CSP Header Not Set',
        source: 'zap-passive',
        references: ['https://a.test'],
      }),
      finding({
        title: 'Content-Security-Policy header not set',
        source: 'header',
        references: ['https://b.test', 'https://a.test'],
      }),
    ])
    expect(result.findings[0].references.sort()).toEqual(['https://a.test', 'https://b.test'])
  })

  it('keeps the most thoroughly written description', () => {
    const result = correlate([
      finding({ title: 'Missing CSP Header', source: 'nuclei', description: 'short' }),
      finding({
        title: 'Content-Security-Policy header not set',
        source: 'header',
        description: 'A much longer explanation of what CSP does and why its absence matters.',
        impact: 'Detailed impact statement.',
        recommendation: 'Detailed remediation guidance.',
      }),
    ])
    expect(result.findings[0].description).toContain('much longer explanation')
  })

  it('preserves evidence from whichever source supplied it', () => {
    const result = correlate([
      finding({
        title: 'Content-Security-Policy header not set',
        source: 'header',
        evidence: null,
      }),
      finding({
        title: 'Missing CSP Header',
        source: 'nuclei',
        evidence: 'header absent in response',
      }),
    ])
    const evidences = result.findings[0].confirmations?.map((c) => c.evidence)
    expect(evidences).toContain('header absent in response')
  })

  it('records the correlation key so grouping is auditable', () => {
    const result = correlate([
      finding({ title: 'Content-Security-Policy header not set', source: 'header' }),
      finding({ title: 'CSP Header Not Set', source: 'zap-passive' }),
    ])
    expect(result.findings[0].correlation_key).toBe('topic:csp-missing')
  })

  it('deduplicates identical observations from the same source', () => {
    const result = correlate([
      finding({ title: 'CSP Header Not Set', source: 'zap-passive', location: 'https://x.test/' }),
      finding({ title: 'CSP Header Not Set', source: 'zap-passive', location: 'https://x.test/' }),
    ])
    expect(result.findings[0].confirmations).toHaveLength(1)
  })
})

describe('correlateFindings — must NOT merge', () => {
  it('keeps different CVEs separate', () => {
    const result = correlate([
      finding({ title: 'Issue A', source: 'nvd', cve_id: 'CVE-2021-1111' }),
      finding({ title: 'Issue B', source: 'nvd', cve_id: 'CVE-2021-2222' }),
    ])
    expect(result.findings).toHaveLength(2)
  })

  it('keeps distinct security headers separate', () => {
    // These are all "missing header" findings but need different fixes.
    const result = correlate([
      finding({ title: 'Content-Security-Policy header not set', source: 'header' }),
      finding({ title: 'Strict-Transport-Security header not set', source: 'header' }),
      finding({ title: 'X-Content-Type-Options header not set', source: 'header' }),
      finding({ title: 'Referrer-Policy header not set', source: 'header' }),
      finding({ title: 'Permissions-Policy header not set', source: 'header' }),
    ])
    expect(result.findings).toHaveLength(5)
  })

  it('keeps a report-only CSP separate from a missing CSP', () => {
    // Having a report-only policy is a materially different state from
    // having no policy at all.
    const result = correlate([
      finding({ title: 'Content-Security-Policy header not set', source: 'header' }),
      finding({ title: 'Content-Security-Policy is report-only', source: 'header' }),
    ])
    expect(result.findings).toHaveLength(2)
  })

  it('keeps the three cookie attribute findings separate', () => {
    const result = correlate([
      finding({ title: 'Cookie set without the Secure attribute', source: 'cookie' }),
      finding({ title: 'Cookie accessible to client-side JavaScript', source: 'cookie' }),
      finding({ title: 'Cookie set without an explicit SameSite attribute', source: 'cookie' }),
    ])
    expect(result.findings).toHaveLength(3)
  })

  it('keeps the same topic on different endpoints separate', () => {
    const result = correlate([
      finding({
        title: 'Directory listing enabled',
        source: 'nuclei',
        location: 'https://x.test/files',
      }),
      finding({
        title: 'Directory listing enabled',
        source: 'nuclei',
        location: 'https://x.test/backup',
      }),
    ])
    expect(result.findings).toHaveLength(2)
  })

  it('keeps unrelated findings with no shared identifier separate', () => {
    const result = correlate([
      finding({ title: 'Something unusual happened', source: 'nuclei' }),
      finding({ title: 'A completely different problem', source: 'zap-passive' }),
    ])
    expect(result.findings).toHaveLength(2)
  })

  it('keeps distinct TLS problems separate', () => {
    const result = correlate([
      finding({ title: 'TLS certificate has expired', source: 'ssl', severity: 'critical' }),
      finding({ title: 'TLS certificate chain did not validate', source: 'ssl', severity: 'high' }),
      finding({
        title: 'Deprecated TLS protocol negotiated (TLSv1)',
        source: 'ssl',
        severity: 'medium',
      }),
    ])
    expect(result.findings).toHaveLength(3)
  })
})

describe('confidenceFor', () => {
  it('promotes to confirmed only for independent tool families', () => {
    expect(
      confidenceFor([
        { source: 'header', raw_title: 'a' },
        { source: 'zap-passive', raw_title: 'b' },
      ]),
    ).toBe('confirmed')
  })

  it('does not promote two observations from the same tool family', () => {
    // Two Nuclei templates matching is one tool being thorough, not
    // corroboration from an independent implementation.
    expect(
      confidenceFor([
        { source: 'nuclei', raw_title: 'a' },
        { source: 'nuclei', raw_title: 'b' },
      ]),
    ).toBe('probable')
  })

  it('treats our own analyzers as one family', () => {
    expect(
      confidenceFor([
        { source: 'header', raw_title: 'a' },
        { source: 'cookie', raw_title: 'b' },
      ]),
    ).toBe('observed')
  })

  it('grades a lone active-tool finding as probable', () => {
    expect(confidenceFor([{ source: 'nuclei', raw_title: 'a' }])).toBe('probable')
  })

  it('grades a lone configuration observation as observed', () => {
    // A missing header is a real fact, but not proof of exploitability.
    expect(confidenceFor([{ source: 'header', raw_title: 'a' }])).toBe('observed')
    expect(confidenceFor([{ source: 'dns', raw_title: 'a' }])).toBe('observed')
  })
})

describe('correlateFindings — output shape', () => {
  it('gives every finding a confirmations list, even unmerged ones', () => {
    const result = correlate([finding({ title: 'Lonely finding', source: 'nuclei' })])
    expect(result.findings[0].confirmations).toHaveLength(1)
    expect(result.findings[0].confirmations?.[0].source).toBe('nuclei')
  })

  it('sorts most severe first', () => {
    const result = correlate([
      finding({ title: 'Low thing', source: 'nuclei', severity: 'low' }),
      finding({ title: 'Critical thing', source: 'nuclei', severity: 'critical' }),
      finding({ title: 'Medium thing', source: 'nuclei', severity: 'medium' }),
    ])
    expect(result.findings.map((f) => f.severity)).toEqual(['critical', 'medium', 'low'])
  })

  it('surfaces multi-tool confirmations first within a severity band', () => {
    const result = correlate([
      finding({ title: 'Solo issue', source: 'nuclei', severity: 'medium' }),
      finding({
        title: 'Content-Security-Policy header not set',
        source: 'header',
        severity: 'medium',
      }),
      finding({ title: 'CSP Header Not Set', source: 'zap-passive', severity: 'medium' }),
    ])
    expect(result.findings[0].confidence).toBe('confirmed')
  })

  it('is deterministic across repeated runs', () => {
    const input = [
      finding({ title: 'Content-Security-Policy header not set', source: 'header' }),
      finding({ title: 'CSP Header Not Set', source: 'zap-passive' }),
      finding({ title: 'Strict-Transport-Security header not set', source: 'header' }),
    ]
    expect(correlate(input)).toEqual(correlate(input))
  })

  it('handles an empty finding list', () => {
    const result = correlate([])
    expect(result.findings).toEqual([])
    expect(result.mergedCount).toBe(0)
    expect(result.confirmedCount).toBe(0)
  })
})

describe('correlation and risk scoring', () => {
  it('charges one penalty per weakness rather than one per observation', () => {
    // The score-inflation bug in concrete terms.
    const duplicates: Finding[] = [
      finding({
        title: 'Content-Security-Policy header not set',
        source: 'header',
        severity: 'medium',
      }),
      finding({ title: 'Missing CSP Header', source: 'nuclei', severity: 'medium' }),
      finding({ title: 'CSP Header Not Set', source: 'zap-passive', severity: 'medium' }),
    ]

    const uncorrelated = buildRiskScore(
      buildSeverityDistribution(duplicates.map((f, i) => ({ ...f, id: `f${i}` }))),
    )
    const correlated = buildRiskScore(
      buildSeverityDistribution(
        correlate(duplicates).findings.map((f, i) => ({ ...f, id: `f${i}` })),
      ),
    )

    // Three medium findings cost 15 points; one costs 5.
    expect(uncorrelated.score).toBe(85)
    expect(correlated.score).toBe(95)
  })

  it('keeps the penalty breakdown consistent after correlation', () => {
    const result = correlate([
      finding({
        title: 'Content-Security-Policy header not set',
        source: 'header',
        severity: 'medium',
      }),
      finding({ title: 'CSP Header Not Set', source: 'zap-passive', severity: 'medium' }),
      finding({ title: 'TLS certificate has expired', source: 'ssl', severity: 'critical' }),
    ])
    const risk = buildRiskScore(
      buildSeverityDistribution(result.findings.map((f, i) => ({ ...f, id: `f${i}` }))),
    )
    const total = risk.penalties.reduce((sum, p) => sum + p.points, 0)
    expect(total).toBe(100 - risk.score)
  })
})

describe('correlateFindings — realistic multi-tool scan', () => {
  /** A plausible comprehensive-scan output with genuine cross-tool overlap. */
  const raw: Finding[] = [
    finding({
      title: 'Content-Security-Policy header not set',
      source: 'header',
      severity: 'medium',
    }),
    finding({
      title: 'Strict-Transport-Security header not set',
      source: 'header',
      severity: 'medium',
    }),
    finding({ title: 'X-Content-Type-Options header not set', source: 'header', severity: 'low' }),
    finding({ title: 'No clickjacking protection configured', source: 'header', severity: 'low' }),
    finding({
      title: 'Cookie set without the Secure attribute',
      source: 'cookie',
      severity: 'medium',
    }),
    finding({
      title: 'Software version disclosed in response headers',
      source: 'header',
      severity: 'low',
    }),
    finding({ title: 'CSP Header Not Set', source: 'zap-passive', severity: 'medium' }),
    finding({
      title: 'Missing Anti-clickjacking Header',
      source: 'zap-passive',
      severity: 'medium',
    }),
    finding({
      title: 'X-Content-Type-Options Header Missing',
      source: 'zap-passive',
      severity: 'low',
    }),
    finding({ title: 'Cookie Without Secure Flag', source: 'zap-passive', severity: 'medium' }),
    finding({ title: 'Server Leaks Version Information', source: 'zap-passive', severity: 'low' }),
    finding({
      title: 'HTTP Strict Transport Security Not Enforced',
      source: 'nuclei',
      severity: 'info',
    }),
    finding({
      title: 'CVE-2021-41773 affects Apache httpd 2.4.49',
      source: 'nvd',
      cve_id: 'CVE-2021-41773',
      severity: 'critical',
    }),
    finding({
      title: 'Apache 2.4.49 - Path Traversal',
      source: 'nuclei',
      cve_id: 'CVE-2021-41773',
      severity: 'critical',
    }),
  ]

  const result = correlate(raw)

  it('collapses 14 observations into 7 distinct findings', () => {
    expect(raw).toHaveLength(14)
    expect(result.findings).toHaveLength(7)
    expect(result.mergedCount).toBe(7)
  })

  it('marks every cross-tool agreement as confirmed', () => {
    // All seven groups in this fixture pair one of our analyzers with an
    // independent tool (ZAP, Nuclei or NVD), so all seven are corroborated.
    expect(result.confirmedCount).toBe(7)
    expect(result.findings.every((f) => f.confidence === 'confirmed')).toBe(true)
  })

  it('pairs each analyzer finding with the right third-party observation', () => {
    const pairs = Object.fromEntries(
      result.findings.map((f) => [f.correlation_key, f.confirmations?.map((c) => c.source).sort()]),
    )
    expect(pairs['topic:csp-missing']).toEqual(['header', 'zap-passive'])
    expect(pairs['topic:hsts-missing']).toEqual(['header', 'nuclei'])
    expect(pairs['topic:cookie-secure']).toEqual(['cookie', 'zap-passive'])
    expect(pairs['cve:CVE-2021-41773']).toEqual(['nuclei', 'nvd'])
  })

  it('puts the multi-tool confirmed CVE at the top', () => {
    expect(result.findings[0].cve_id).toBe('CVE-2021-41773')
    expect(result.findings[0].severity).toBe('critical')
    expect(result.findings[0].confidence).toBe('confirmed')
  })

  it('substantially improves the score versus counting duplicates', () => {
    const before = buildRiskScore(
      buildSeverityDistribution(raw.map((f, i) => ({ ...f, id: `f${i}` }))),
    )
    const after = buildRiskScore(
      buildSeverityDistribution(result.findings.map((f, i) => ({ ...f, id: `f${i}` }))),
    )
    expect(after.score).toBeGreaterThan(before.score)
  })
})

/**
 * Regression: the real scanme.nmap.org scan (report `vs_ksg1jfyu83`) produced
 * 19 findings and zero confirmations. Our analyzers emit `location: null`
 * for deployment-wide header issues; ZAP emits the URL it requested. The
 * original key scoped every topic by location, so the two halves of each pair
 * landed in different groups and nothing ever merged.
 *
 * These are the exact four pairs from that run.
 */
describe('mixed-location observations from a real scan', () => {
  const raw: Finding[] = [
    finding({ title: 'Content-Security-Policy header not set', source: 'header', location: null }),
    finding({
      title: 'CSP: Header Not Set',
      source: 'zap-passive',
      location: 'http://scanme.nmap.org/',
    }),
    finding({ title: 'Clickjacking protection missing', source: 'header', location: null }),
    finding({
      title: 'Missing Anti-clickjacking Header',
      source: 'zap-passive',
      location: 'http://scanme.nmap.org/',
    }),
    finding({ title: 'Server version disclosed', source: 'header', location: null }),
    finding({
      title: 'Server Leaks Version Information via "Server" HTTP Response Header Field',
      source: 'zap-passive',
      location: 'http://scanme.nmap.org/',
    }),
    finding({ title: 'X-Content-Type-Options header not set', source: 'header', location: null }),
    finding({
      title: 'X-Content-Type-Options Header Missing',
      source: 'zap-passive',
      location: 'http://scanme.nmap.org/',
    }),
  ]

  const result = correlate(raw)

  it('merges all four pairs instead of leaving eight findings', () => {
    expect(result.findings).toHaveLength(4)
    expect(result.mergedCount).toBe(4)
  })

  it('marks every pair as confirmed by two independent tools', () => {
    expect(result.confirmedCount).toBe(4)
    for (const found of result.findings) {
      expect(found.confirmations?.map((c) => c.source).sort()).toEqual(['header', 'zap-passive'])
    }
  })

  it('keeps the URL ZAP reported as evidence of where it was seen', () => {
    const csp = result.findings.find((f) => f.correlation_key === 'topic:csp-missing')
    expect(csp?.confirmations?.some((c) => c.location === 'http://scanme.nmap.org/')).toBe(true)
  })

  it('still separates path-specific exposures found at different paths', () => {
    const exposures = correlate([
      finding({ title: 'Directory listing enabled', source: 'exposure', location: '/backup/' }),
      finding({ title: 'Directory listing enabled', source: 'exposure', location: '/uploads/' }),
    ])
    expect(exposures.findings).toHaveLength(2)
  })

  it('treats the site root as no path for path-scoped topics', () => {
    const rootless = correlationKey(
      finding({ title: 'Directory listing enabled', source: 'exposure', location: null }),
    )
    const root = correlationKey(
      finding({
        title: 'Directory Browsing',
        source: 'zap-passive',
        location: 'http://scanme.nmap.org/',
      }),
    )
    expect(root).toBe(rootless)
  })
})
