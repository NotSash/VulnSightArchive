import { describe, expect, it } from 'vitest'
import { buildRiskScore, buildRoadmap, buildSeverityDistribution } from '@/lib/scanner/risk'
import { categoryForScore } from '@/lib/severity'
import type { Severity, SeverityDistribution, Vulnerability } from '@/types/report'

/**
 * Risk scoring must be reproducible and explainable — those are product
 * guarantees, not implementation details. The invariant that matters most is
 * that the published penalty breakdown always reconstructs the score exactly;
 * if it ever drifts, the report is lying about its own arithmetic.
 */

function dist(partial: Partial<SeverityDistribution> = {}): SeverityDistribution {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0, ...partial }
}

let counter = 0
function vuln(severity: Severity, overrides: Partial<Vulnerability> = {}): Vulnerability {
  counter += 1
  return {
    id: `v${counter}`,
    title: `Finding ${counter}`,
    severity,
    description: 'description',
    impact: 'impact',
    recommendation: `Recommendation ${counter}`,
    references: [],
    cvss_score: null,
    cwe_id: null,
    cve_id: null,
    owasp_category: null,
    source: 'test',
    ...overrides,
  }
}

describe('buildSeverityDistribution', () => {
  it('returns all-zero counts for an empty finding list', () => {
    expect(buildSeverityDistribution([])).toEqual(dist())
  })

  it('counts each severity independently', () => {
    const result = buildSeverityDistribution([
      vuln('critical'),
      vuln('high'),
      vuln('high'),
      vuln('medium'),
      vuln('low'),
      vuln('info'),
      vuln('info'),
      vuln('info'),
    ])
    expect(result).toEqual(dist({ critical: 1, high: 2, medium: 1, low: 1, info: 3 }))
  })
})

describe('buildRiskScore', () => {
  it('awards a perfect score when nothing was found', () => {
    // A clean 100 must be reachable, otherwise the score is meaningless.
    const risk = buildRiskScore(dist())
    expect(risk.score).toBe(100)
    expect(risk.category).toBe('Safe')
    expect(risk.penalties).toEqual([])
  })

  it('does not penalise informational findings', () => {
    const risk = buildRiskScore(dist({ info: 25 }))
    expect(risk.score).toBe(100)
    expect(risk.penalties).toEqual([])
  })

  it('applies the documented per-severity weights', () => {
    expect(buildRiskScore(dist({ critical: 1 })).score).toBe(75) // 100 - 25
    expect(buildRiskScore(dist({ high: 1 })).score).toBe(88) //     100 - 12
    expect(buildRiskScore(dist({ medium: 1 })).score).toBe(95) //   100 - 5
    expect(buildRiskScore(dist({ low: 1 })).score).toBe(98) //      100 - 2
  })

  it('accumulates penalties across severity bands', () => {
    // 25 + 12 + 5 + 2 = 44
    expect(buildRiskScore(dist({ critical: 1, high: 1, medium: 1, low: 1 })).score).toBe(56)
  })

  describe('band caps', () => {
    it('caps critical findings at 60 points', () => {
      // 10 × 25 = 250 raw, capped to 60.
      const risk = buildRiskScore(dist({ critical: 10 }))
      expect(risk.penalties[0].points).toBe(60)
      expect(risk.score).toBe(40)
    })

    it('caps high findings at 40 points', () => {
      expect(buildRiskScore(dist({ high: 20 })).penalties[0].points).toBe(40)
    })

    it('caps medium findings at 20 points', () => {
      expect(buildRiskScore(dist({ medium: 20 })).penalties[0].points).toBe(20)
    })

    it('caps low findings at 8 points', () => {
      // This is the anti-noise rule: a long tail of trivia must not sink a site.
      expect(buildRiskScore(dist({ low: 50 })).penalties[0].points).toBe(8)
    })

    it('prevents a flood of low-severity findings from dominating', () => {
      expect(buildRiskScore(dist({ low: 100 })).score).toBe(92)
    })
  })

  it('never returns a score below zero', () => {
    const risk = buildRiskScore(dist({ critical: 99, high: 99, medium: 99, low: 99 }))
    expect(risk.score).toBe(0)
    expect(risk.score).toBeGreaterThanOrEqual(0)
  })

  it('keeps the penalty breakdown consistent with the score', () => {
    // The published derivation must reconstruct the score exactly.
    const cases = [
      dist({ critical: 2 }),
      dist({ high: 3, low: 4 }),
      dist({ critical: 1, high: 2, medium: 3, low: 4, info: 5 }),
      dist({ medium: 7 }),
      dist({ low: 3, info: 9 }),
    ]
    for (const d of cases) {
      const risk = buildRiskScore(d)
      const total = risk.penalties.reduce((sum, p) => sum + p.points, 0)
      expect(total).toBe(100 - risk.score)
    }
  })

  it('omits zero-count bands from the breakdown', () => {
    const risk = buildRiskScore(dist({ high: 1, info: 4 }))
    expect(risk.penalties).toHaveLength(1)
    expect(risk.penalties[0].label).toContain('High')
  })

  it('labels each penalty with its finding count', () => {
    const risk = buildRiskScore(dist({ medium: 3 }))
    expect(risk.penalties[0].label).toBe('Medium-severity findings (3)')
  })

  it('is deterministic across repeated calls', () => {
    const d = dist({ critical: 1, high: 2, medium: 1 })
    expect(buildRiskScore(d)).toEqual(buildRiskScore(d))
  })
})

describe('categoryForScore', () => {
  it('maps score bands to categories at the documented boundaries', () => {
    expect(categoryForScore(100)).toBe('Safe')
    expect(categoryForScore(80)).toBe('Safe')
    expect(categoryForScore(79)).toBe('Moderate')
    expect(categoryForScore(60)).toBe('Moderate')
    expect(categoryForScore(59)).toBe('High')
    expect(categoryForScore(40)).toBe('High')
    expect(categoryForScore(39)).toBe('Critical')
    expect(categoryForScore(0)).toBe('Critical')
  })
})

describe('buildRoadmap', () => {
  it('returns empty buckets when there is nothing to fix', () => {
    expect(buildRoadmap([])).toEqual({ immediate: [], short_term: [], long_term: [] })
  })

  it('routes findings into buckets by urgency', () => {
    const roadmap = buildRoadmap([
      vuln('critical', { recommendation: 'Patch now' }),
      vuln('high', { recommendation: 'Fix soon' }),
      vuln('medium', { recommendation: 'Schedule this' }),
      vuln('low', { recommendation: 'Eventually' }),
    ])
    expect(roadmap.immediate).toEqual(['Patch now', 'Fix soon'])
    expect(roadmap.short_term).toEqual(['Schedule this'])
    expect(roadmap.long_term).toEqual(['Eventually'])
  })

  it('excludes informational findings from remediation work', () => {
    const roadmap = buildRoadmap([vuln('info', { recommendation: 'FYI only' })])
    expect(roadmap).toEqual({ immediate: [], short_term: [], long_term: [] })
  })

  it('deduplicates identical recommendations', () => {
    const roadmap = buildRoadmap([
      vuln('high', { recommendation: 'Enable HSTS' }),
      vuln('high', { recommendation: 'Enable HSTS' }),
      vuln('critical', { recommendation: 'Enable HSTS' }),
    ])
    expect(roadmap.immediate).toEqual(['Enable HSTS'])
  })

  it('caps each bucket at six entries so the roadmap stays actionable', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      vuln('critical', { recommendation: `Action ${i}` }),
    )
    expect(buildRoadmap(many).immediate).toHaveLength(6)
  })
})
