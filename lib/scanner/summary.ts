/**
 * Deterministic report summary.
 *
 * This is a rule-based writer, and it says so: `generated_by` is set to the
 * engine that actually produced the text. Claiming an LLM wrote a fallback
 * summary would misrepresent how the report was built.
 *
 * It is also willing to report good news. A scan that finds nothing significant
 * says exactly that, rather than manufacturing concern to look thorough.
 */

import { buildRoadmap } from '@/lib/scanner/risk'
import type {
  AiSummary,
  RiskScore,
  ScanNote,
  SeverityDistribution,
  Vulnerability,
} from '@/types/report'

export const RULE_ENGINE_LABEL = 'VulnSight rule engine (deterministic)'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Sentence describing what the scan could not collect, if anything. */
function coverageSentence(notes: ScanNote[]): string {
  if (!notes.length) return ''
  const stages = notes.map((n) => n.stage.toLowerCase())
  const list =
    stages.length === 1
      ? stages[0]
      : `${stages.slice(0, -1).join(', ')} and ${stages[stages.length - 1]}`
  return ` Note that ${list} could not be collected in this environment, so this assessment covers only what was directly observed.`
}

export function buildSummary({
  domain,
  dist,
  risk,
  vulns,
  notes,
}: {
  domain: string
  dist: SeverityDistribution
  risk: RiskScore
  vulns: Vulnerability[]
  notes: ScanNote[]
}): AiSummary {
  const actionable = dist.critical + dist.high + dist.medium + dist.low
  const total = actionable + dist.info
  const coverage = coverageSentence(notes)

  // Findings are pre-sorted by severity, so the head of the list is the worst.
  const topVulns = vulns.filter((v) => v.severity !== 'info').slice(0, 3)
  const sources = [...new Set(vulns.map((v) => v.source))].sort()

  let executive_summary: string
  let technical_summary: string

  if (actionable === 0) {
    // The clean-result path. Stated plainly and without hedging.
    executive_summary =
      `No significant security issues were found on ${domain}. ` +
      `Every check that VulnSight was able to run completed without surfacing an actionable weakness, ` +
      `giving an overall risk score of ${risk.score}/100 ("${risk.category}").` +
      (dist.info > 0
        ? ` ${plural(dist.info, 'informational observation')} ${dist.info === 1 ? 'is' : 'are'} listed below. These are optional hardening opportunities, not vulnerabilities.`
        : '') +
      coverage +
      ` This is a good result: the checks performed found nothing that requires remediation.`

    technical_summary =
      `The assessment produced no findings above informational severity, so no penalties were applied and the score remains at ${risk.score}/100. ` +
      (notes.length
        ? `The score reflects only checks that completed successfully; unavailable checks are listed in the coverage section. `
        : `Security headers, transport configuration, and certificate state were all consistent with current best practice for the checks performed. `) +
      (dist.info > 0
        ? `The ${plural(dist.info, 'informational item')} below reflect defaults rather than misconfiguration.`
        : '') +
      coverage
  } else {
    const headline =
      risk.category === 'Safe'
        ? `${domain} has a solid security posture with a small number of hardening opportunities`
        : risk.category === 'Moderate'
          ? `${domain} has a reasonable baseline with some configuration gaps worth closing`
          : `${domain} has security weaknesses that warrant prompt attention`

    const severityParts: string[] = []
    if (dist.critical) severityParts.push(plural(dist.critical, 'critical issue'))
    if (dist.high) severityParts.push(plural(dist.high, 'high-severity issue'))
    if (dist.medium) severityParts.push(plural(dist.medium, 'medium-severity issue'))
    if (dist.low) severityParts.push(plural(dist.low, 'low-severity issue'))
    const severityText = severityParts.join(', ')

    executive_summary =
      `${headline}. The scan confirmed ${severityText}` +
      (dist.info ? ` plus ${plural(dist.info, 'informational observation')}` : '') +
      `, producing an overall risk score of ${risk.score}/100 ("${risk.category}"). ` +
      (dist.critical || dist.high
        ? `The highest-priority items should be addressed first, because they carry the greatest share of the score reduction. `
        : `None of the confirmed issues are critical, and each has a well-understood fix. `) +
      `Every item listed below was observed directly in the target's responses.` +
      coverage

    technical_summary =
      `${plural(total, 'finding')} ${total === 1 ? 'was' : 'were'} derived from ${plural(sources.length, 'scanner source')} (${sources.join(', ')}). ` +
      (topVulns.length
        ? `The most significant are: ${topVulns.map((v) => `${v.title} (${v.severity})`).join('; ')}. `
        : '') +
      `The risk score of ${risk.score}/100 is the result of subtracting ${100 - risk.score} points from a clean baseline; ` +
      `the penalty breakdown lists each contribution, and informational findings carry no weight. ` +
      `No finding is inferred from a technology fingerprint alone. Each one has a corresponding observation in the collected evidence.` +
      coverage
  }

  const key_risks = topVulns.map((v) => `${v.title} (${v.severity}): ${v.impact}`)

  // Recommendations mirror actual findings, most severe first, deduplicated.
  const recommendations = [
    ...new Set(vulns.filter((v) => v.severity !== 'info').map((v) => v.recommendation)),
  ].slice(0, 6)

  return {
    executive_summary,
    technical_summary,
    key_risks,
    recommendations,
    remediation: buildRoadmap(vulns),
    generated_by: RULE_ENGINE_LABEL,
    available: true,
  }
}
