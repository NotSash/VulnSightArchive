/**
 * Cross-tool finding correlation.
 *
 * VulnSight runs several scanners that overlap heavily. A single missing
 * Content-Security-Policy header is typically reported three times: once by
 * our own header analysis, once by a Nuclei template, and once by a ZAP
 * passive rule. Concatenating those produces a report that looks padded, and —
 * because risk scoring counts findings — penalises the target three times for
 * one weakness.
 *
 * This module collapses those observations into one finding that records every
 * source that saw it. That turns redundancy from a liability into evidence:
 * three independent tools agreeing is a stronger signal than one tool
 * guessing, and the report can say so.
 *
 * Design constraints:
 *
 * 1. **Deterministic.** Grouping uses explicit, inspectable rules. The same
 *    inputs always produce the same output, and `correlation_key` records why
 *    each group was formed so a reader can audit the decision.
 * 2. **Conservative.** When in doubt, findings stay separate. Wrongly merging
 *    two distinct issues hides one of them, which is far worse than showing a
 *    near-duplicate.
 * 3. **Severity is never invented.** A merged finding takes the highest
 *    severity any contributing source assigned. Correlation never computes a
 *    new severity of its own.
 */

import { channelForSource } from '@/lib/scanner/channels'
import { SEVERITY_ORDER } from '@/lib/severity'
import type {
  FindingConfidence,
  FindingConfirmation,
  Severity,
  Vulnerability,
} from '@/types/report'

/** A finding before an id has been assigned. */
type Finding = Omit<Vulnerability, 'id'>

/**
 * Sources that reach a conclusion by observing configuration rather than by
 * actively testing behaviour. A missing header is a real, verifiable fact, but
 * it is not proof that anything is exploitable — so on its own it stays at
 * `observed` rather than being promoted to `probable`.
 */
const PASSIVE_SOURCES = new Set(['header', 'cookie', 'dns', 'transport'])

/**
 * Which independent tool a source represents.
 *
 * **Delegates to `channelForSource`.** This used to be a second, hand-written
 * map (`SOURCE_FAMILY`) that duplicated the channel map, and the two drifted:
 * `browser` and `browser-dom` were missing from it, and `familyOf` fell back
 * to `?? source`, so each unmapped source became its own "independent tool".
 * The result was that a finding seen only by VulnSight's own Chromium render
 * could be badged "confirmed by 2 tools", which is exactly what the agreement
 * rule exists to prevent. See AUDIT B1.
 *
 * There is now one definition of independence in the codebase. A source with
 * no mapping lands in `OTHER` rather than inventing a family, so forgetting a
 * mapping can no longer inflate a confirmation count.
 */
function familyOf(source: string): string {
  return channelForSource(source)
}

/**
 * Reduce a title to a comparable form.
 *
 * Different tools describe the same weakness with different wording, so
 * matching on the raw string would never group anything. This strips
 * punctuation, collapses whitespace, and removes filler words that carry no
 * distinguishing meaning.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[`'"()[\]{}.,:;!?]/g, ' ')
    .replace(/\b(the|a|an|is|are|was|were|be|been|to|of|for|on|in|with|and|or|not|no)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Canonical topics that several tools describe differently.
 *
 * Each entry maps a stable topic id to the signals that identify it. Matching
 * requires a `match` hit; `exclude` guards against near-miss titles that are
 * genuinely different issues.
 *
 * This table is intentionally small and specific. It covers the overlaps that
 * actually occur between our analyzers, Nuclei and ZAP — it is not an attempt
 * to classify every possible finding.
 */
const TOPICS: {
  id: string
  label: string
  match: RegExp
  exclude?: RegExp
  /**
   * How the topic is scoped when grouping.
   *
   * `site` — the weakness is a property of the whole deployment (response
   * headers, cookie flags, transport and certificate configuration). Every
   * tool sees the same one issue, but they disagree about how to label the
   * place: our own analyzers report `location: null` because there is no
   * single URL to blame, while ZAP records the URL it happened to request.
   * Scoping these by location would therefore split observations that are
   * unquestionably about the same thing, so location is ignored.
   *
   * `path` — the weakness belongs to a specific resource (an exposed file, a
   * browsable directory). Two of these at different paths are two separate
   * problems that need fixing independently, so location stays part of the
   * key.
   */
  scope: 'site' | 'path'
}[] = [
  {
    id: 'csp-missing',
    label: 'Content-Security-Policy not set',
    match: /content security policy|content-security-policy|\bcsp\b/,
    // A report-only CSP is a different (lesser) issue from having none at all.
    exclude: /report[- ]only/,
    scope: 'site',
  },
  {
    id: 'csp-report-only',
    label: 'Content-Security-Policy is report-only',
    match: /(content security policy|csp).*report[- ]only|report[- ]only.*(csp|content security)/,
    scope: 'site',
  },
  {
    id: 'hsts-missing',
    label: 'Strict-Transport-Security not set',
    match: /strict transport security|strict-transport-security|\bhsts\b/,
    scope: 'site',
  },
  {
    id: 'clickjacking',
    label: 'Clickjacking protection missing',
    match: /clickjacking|x[- ]frame[- ]options|frame ancestors|anti-clickjacking/,
    scope: 'site',
  },
  {
    id: 'content-type-options',
    label: 'X-Content-Type-Options not set',
    match: /x[- ]content[- ]type[- ]options|mime[- ]?sniff|nosniff/,
    scope: 'site',
  },
  {
    id: 'referrer-policy',
    label: 'Referrer-Policy not set',
    match: /referrer[- ]policy/,
    scope: 'site',
  },
  {
    id: 'permissions-policy',
    label: 'Permissions-Policy not set',
    match: /permissions[- ]policy|feature[- ]policy/,
    scope: 'site',
  },
  {
    id: 'cookie-secure',
    label: 'Cookie missing the Secure attribute',
    match: /cookie.*secure(?!.*http)|secure flag|without secure/,
    scope: 'site',
  },
  {
    id: 'cookie-httponly',
    label: 'Cookie missing HttpOnly',
    match: /cookie.*httponly|httponly flag|http only.*cookie|cookie.*javascript/,
    scope: 'site',
  },
  {
    id: 'cookie-samesite',
    label: 'Cookie missing SameSite',
    match: /samesite|same[- ]site/,
    scope: 'site',
  },
  {
    id: 'version-disclosure',
    label: 'Software version disclosed',
    match:
      /version disclosed|version information|server leaks|x[- ]powered[- ]by|banner disclosure/,
    scope: 'site',
  },
  {
    id: 'plaintext-transport',
    label: 'Site served over plaintext HTTP',
    match: /plaintext http|unencrypted|cleartext|not served over https/,
    scope: 'site',
  },
  {
    id: 'tls-expired',
    label: 'TLS certificate expired',
    match: /certificate.*expired|expired.*certificate/,
    scope: 'site',
  },
  {
    id: 'tls-untrusted',
    label: 'TLS certificate chain did not validate',
    match: /certificate chain|untrusted certificate|self[- ]signed|chain did not validate/,
    scope: 'site',
  },
  {
    id: 'tls-hostname',
    label: 'Certificate does not cover the hostname',
    match: /certificate.*hostname|hostname.*certificate|common name mismatch|subject alternative/,
    scope: 'site',
  },
  {
    id: 'tls-deprecated',
    label: 'Deprecated TLS protocol negotiated',
    match: /deprecated tls|tlsv1(\.[01])?\b|ssl ?v[23]/,
    scope: 'site',
  },
  {
    id: 'directory-listing',
    label: 'Directory listing enabled',
    match: /directory listing|directory browsing|index of/,
    scope: 'path',
  },
  {
    id: 'git-exposed',
    label: 'Git repository exposed',
    match: /\.git|git repository|git config/,
    scope: 'path',
  },
  {
    id: 'env-exposed',
    label: 'Environment file exposed',
    match: /\.env|environment file/,
    scope: 'path',
  },
]

/** Identify the canonical topic for a finding title, if one applies. */
function topicFor(title: string): { id: string; label: string; scope: 'site' | 'path' } | null {
  const normalized = normalizeTitle(title)
  for (const topic of TOPICS) {
    if (topic.exclude?.test(normalized)) continue
    if (topic.match.test(normalized)) {
      return { id: topic.id, label: topic.label, scope: topic.scope }
    }
  }
  return null
}

/**
 * Compute the grouping key for a finding.
 *
 * Precedence, strongest identifier first:
 *
 * 1. **CVE id** — an unambiguous global identifier. Two tools reporting
 *    CVE-2021-41773 are unquestionably describing the same vulnerability.
 * 2. **Canonical topic** — a known cross-tool overlap from the table above.
 * 3. **CWE + location** — same weakness class at the same place.
 * 4. **Normalized title** — last resort; only groups near-identical wording.
 *
 * The returned string is stored on the finding so the grouping decision is
 * visible in the report rather than hidden in this function.
 */
export function correlationKey(finding: Finding): string {
  if (finding.cve_id) {
    return `cve:${finding.cve_id.toUpperCase()}`
  }

  const topic = topicFor(finding.title)
  if (topic) {
    /*
     * Path-scoped topics keep their location so the same weakness on two
     * different resources stays separate. Site-scoped topics deliberately
     * drop it: tools disagree about whether a deployment-wide issue belongs
     * to `null`, to `/`, or to whichever URL was requested, and that
     * disagreement must not prevent them from confirming each other.
     */
    if (topic.scope === 'site') return `topic:${topic.id}`
    const scope = pathScope(finding.location)
    return scope ? `topic:${topic.id}@${scope}` : `topic:${topic.id}`
  }

  if (finding.cwe_id && finding.location) {
    return `cwe:${finding.cwe_id.toUpperCase()}@${normalizeLocation(finding.location)}`
  }

  return `title:${normalizeTitle(finding.title)}`
}

/**
 * Reduce a location to a stable comparison form.
 *
 * URLs are collapsed to origin + path so that differing query strings or
 * fragments do not split what is really one finding.
 */
function normalizeLocation(location: string | null | undefined): string {
  if (!location) return ''
  const trimmed = location.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return `${url.origin}${url.pathname}`.replace(/\/$/, '').toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

/**
 * Location scope for path-specific topics.
 *
 * The site root is treated as "no particular path", because a tool reporting
 * an issue against `https://example.com/` is not saying anything more specific
 * than a tool that reported no location at all.
 */
function pathScope(location: string | null | undefined): string {
  const normalized = normalizeLocation(location)
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    return url.pathname === '' || url.pathname === '/' ? '' : normalized
  } catch {
    return normalized
  }
}

/** Order two severities, most severe first. */
function moreSevere(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER.indexOf(a) <= SEVERITY_ORDER.indexOf(b) ? a : b
}

/**
 * Decide the confidence tier for a correlated group.
 *
 * Promotion to `confirmed` requires independent *implementations*, not merely
 * multiple observations, so two Nuclei templates agreeing does not qualify.
 */
export function confidenceFor(confirmations: FindingConfirmation[]): FindingConfidence {
  const families = new Set(confirmations.map((entry) => familyOf(entry.source)))
  if (families.size >= 2) return 'confirmed'

  const onlySource = confirmations[0]?.source ?? ''
  if (PASSIVE_SOURCES.has(onlySource)) return 'observed'

  return 'probable'
}

/**
 * Choose the clearest description among several for the same issue.
 *
 * Our own analyzers write full impact and remediation guidance; third-party
 * tools often emit a bare template name. Preferring the richer text keeps the
 * report readable while the terse observations survive as confirmations.
 */
function richest(a: Finding, b: Finding): Finding {
  const weigh = (finding: Finding) =>
    finding.description.length + finding.impact.length + finding.recommendation.length
  return weigh(b) > weigh(a) ? b : a
}

/** Merge a group of observations into a single finding. */
function mergeGroup(group: Finding[], key: string): Finding {
  if (group.length === 1) {
    const only = group[0]
    const confirmations: FindingConfirmation[] = [
      {
        source: only.source,
        raw_title: only.title,
        evidence: only.evidence ?? null,
        location: only.location ?? null,
      },
    ]
    return {
      ...only,
      confirmations,
      confidence: confidenceFor(confirmations),
      correlation_key: key,
    }
  }

  // Base the merged finding on the most thoroughly described observation.
  const base = group.reduce(richest)

  const confirmations: FindingConfirmation[] = []
  const seen = new Set<string>()
  for (const finding of group) {
    const fingerprint = `${finding.source}|${finding.title}|${finding.location ?? ''}`
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    confirmations.push({
      source: finding.source,
      raw_title: finding.title,
      evidence: finding.evidence ?? null,
      location: finding.location ?? null,
    })
  }

  // Highest severity any source assigned. Never averaged, never recomputed.
  const severity = group.reduce<Severity>((worst, f) => moreSevere(worst, f.severity), 'info')

  // Highest CVSS any source supplied; nulls do not dilute a real score.
  const cvssScores = group
    .map((f) => f.cvss_score)
    .filter((score): score is number => typeof score === 'number')
  const cvss_score = cvssScores.length ? Math.max(...cvssScores) : null

  const references = [...new Set(group.flatMap((f) => f.references))].slice(0, 12)

  // Prefer the merged source list so the report can name every contributor.
  const sources = [...new Set(group.map((f) => f.source))].sort()

  return {
    ...base,
    severity,
    cvss_score,
    references,
    cwe_id: base.cwe_id ?? group.find((f) => f.cwe_id)?.cwe_id ?? null,
    cve_id: base.cve_id ?? group.find((f) => f.cve_id)?.cve_id ?? null,
    owasp_category:
      base.owasp_category ?? group.find((f) => f.owasp_category)?.owasp_category ?? null,
    evidence: base.evidence ?? group.find((f) => f.evidence)?.evidence ?? null,
    location: base.location ?? group.find((f) => f.location)?.location ?? null,
    source: sources.join('+'),
    confirmations,
    confidence: confidenceFor(confirmations),
    correlation_key: key,
  }
}

export interface CorrelationResult {
  /** Findings after merging, sorted most severe first. */
  findings: Finding[]
  /** How many raw observations were folded into another finding. */
  mergedCount: number
  /** Number of findings supported by two or more independent tools. */
  confirmedCount: number
}

/**
 * Correlate raw scanner output into deduplicated findings.
 *
 * Order within a group is preserved from the input, so the pipeline's stage
 * order determines which observation is considered first. The result is
 * deterministic for a given input.
 */
export function correlateFindings(findings: Finding[]): CorrelationResult {
  const groups = new Map<string, Finding[]>()

  for (const finding of findings) {
    const key = correlationKey(finding)
    const existing = groups.get(key)
    if (existing) existing.push(finding)
    else groups.set(key, [finding])
  }

  const merged: Finding[] = []
  let mergedCount = 0

  for (const [key, group] of groups) {
    if (group.length > 1) mergedCount += group.length - 1
    merged.push(mergeGroup(group, key))
  }

  merged.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    if (bySeverity !== 0) return bySeverity
    // Within a severity band, surface multi-tool confirmations first.
    const confirmations = (b.confirmations?.length ?? 1) - (a.confirmations?.length ?? 1)
    if (confirmations !== 0) return confirmations
    return a.title.localeCompare(b.title)
  })

  return {
    findings: merged,
    mergedCount,
    confirmedCount: merged.filter((f) => f.confidence === 'confirmed').length,
  }
}
