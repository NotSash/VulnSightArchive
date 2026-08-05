/**
 * Risk scoring.
 *
 * Two principles govern this engine:
 *
 * 1. **Only verified findings cost points.** Nothing is penalized because a
 *    scanner could not run, and nothing is penalized twice. Earlier versions
 *    charged for a missing header *and* for the finding that reported it, which
 *    is why every site trended toward a low score.
 *
 * 2. **A clean result is reachable.** A site with no findings scores 100. That
 *    outcome has to be possible for the score to mean anything.
 */

import { categoryForScore } from '@/lib/severity'
import type {
  RemediationRoadmap,
  RiskScore,
  Severity,
  SeverityDistribution,
  Vulnerability,
} from '@/types/report'

/**
 * Points deducted per finding, by severity.
 *
 * Informational findings cost nothing — they are observations, not weaknesses.
 */
const WEIGHTS: Record<Severity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
  info: 0,
}

/**
 * Ceilings per severity band. These stop a long tail of minor issues from
 * dominating the score while still letting genuine critical findings sink it.
 */
const BAND_CAPS: Record<Severity, number> = {
  critical: 60,
  high: 40,
  medium: 20,
  low: 8,
  info: 0,
}

const BAND_LABEL: Record<Severity, string> = {
  critical: 'Critical findings',
  high: 'High-severity findings',
  medium: 'Medium-severity findings',
  low: 'Low-severity findings',
  info: 'Informational findings',
}

export function buildSeverityDistribution(vulns: Vulnerability[]): SeverityDistribution {
  const dist: SeverityDistribution = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  }
  for (const v of vulns) dist[v.severity] += 1
  return dist
}

/**
 * Compute the risk score purely from confirmed findings.
 *
 * The returned `penalties` array is the full, reproducible derivation — the sum
 * of its points always equals `100 - score`.
 */
export function buildRiskScore(dist: SeverityDistribution): RiskScore {
  const penalties: { label: string; points: number }[] = []

  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const count = dist[severity]
    if (count === 0) continue
    const raw = count * WEIGHTS[severity]
    const points = Math.min(raw, BAND_CAPS[severity])
    if (points > 0) {
      penalties.push({
        label: `${BAND_LABEL[severity]} (${count})`,
        points,
      })
    }
  }

  const totalPenalty = penalties.reduce((sum, p) => sum + p.points, 0)
  const score = Math.max(0, Math.min(100, 100 - totalPenalty))

  /*
   * Keep the printed derivation honest when the penalties exceed 100.
   *
   * The band caps total 128, so a badly exposed site can be penalised past
   * the floor. The score clamps at 0 but the penalty list did not, so the
   * report printed a column of deductions that summed to 128 above a "Final
   * score 0 / 100" row: a reader adding it up got a different answer. See
   * AUDIT B2.
   *
   * The overflow is stated rather than scaled away. Scaling would invent a
   * number, and this product does not print figures the engine did not
   * derive.
   */
  if (totalPenalty > 100) {
    penalties.push({
      label: `Score floor reached (${totalPenalty - 100} beyond the minimum)`,
      points: -(totalPenalty - 100),
    })
  }

  return { score, category: categoryForScore(score), penalties }
}

/**
 * Group each finding's recommendation by urgency.
 *
 * Every entry traces back to a real finding; nothing generic is appended, so an
 * empty roadmap correctly signals that there is nothing to fix.
 */
export function buildRoadmap(vulns: Vulnerability[]): RemediationRoadmap {
  const immediate: string[] = []
  const short_term: string[] = []
  const long_term: string[] = []

  for (const v of vulns) {
    if (v.severity === 'critical' || v.severity === 'high') {
      immediate.push(v.recommendation)
    } else if (v.severity === 'medium') {
      short_term.push(v.recommendation)
    } else if (v.severity === 'low') {
      long_term.push(v.recommendation)
    }
    // Informational findings do not generate remediation work.
  }

  const dedupe = (items: string[]) => [...new Set(items)].slice(0, 6)

  return {
    immediate: dedupe(immediate),
    short_term: dedupe(short_term),
    long_term: dedupe(long_term),
  }
}
