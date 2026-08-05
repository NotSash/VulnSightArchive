import type {
  CveEnrichmentEvidence,
  CveEntry,
  OpenPort,
  Severity,
  TechnologyEntry,
} from '@/types/report'

interface ComponentVersion {
  name: string
  version: string
  source: string
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Split the numeric release portion of a version into comparable segments.
 *
 * Anything from the first pre-release or build separator onward is dropped, so
 * `1.0.0-rc1` yields `[1, 0, 0]` rather than `[1, 0, 0, 1]`. Including the
 * digits from a pre-release tag would make `1.0.0-rc1` compare as *greater*
 * than `1.0.0`.
 */
function versionParts(version: string): number[] {
  const release = version.trim().split(/[-+]/)[0]
  return release
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part))
}

/**
 * Extract a semver pre-release tag, if present.
 *
 * `1.0.0-rc1` -> `rc1`, `1.0.0` -> null. Build metadata (`+sha`) is ignored
 * because it never affects precedence.
 */
function preReleaseTag(version: string): string | null {
  const match = version.trim().match(/^[0-9][0-9.]*-([0-9A-Za-z.-]+?)(?:\+[0-9A-Za-z.-]+)?$/)
  return match ? match[1].toLowerCase() : null
}

/**
 * Compare two version strings.
 *
 * Numeric segments are compared left to right, then semver precedence is
 * applied: a pre-release sorts BELOW the release it precedes, so
 * `1.0.0-rc1 < 1.0.0`. Without this, a purely digit-based comparison treats
 * them as equal and a CVE range ending at `1.0.0` would wrongly exclude
 * (or include) release candidates.
 */
function compareVersions(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }

  // Numeric release portions are equal; apply semver pre-release precedence.
  const leftTag = preReleaseTag(a)
  const rightTag = preReleaseTag(b)
  if (leftTag === rightTag) return 0
  if (leftTag === null) return 1 // a is the full release, so it is greater
  if (rightTag === null) return -1 // b is the full release
  return leftTag < rightTag ? -1 : 1
}

function inRange(version: string, match: Record<string, unknown>): boolean {
  const startIncluding = match.versionStartIncluding as string | undefined
  const startExcluding = match.versionStartExcluding as string | undefined
  const endIncluding = match.versionEndIncluding as string | undefined
  const endExcluding = match.versionEndExcluding as string | undefined

  if (startIncluding && compareVersions(version, startIncluding) < 0) return false
  if (startExcluding && compareVersions(version, startExcluding) <= 0) return false
  if (endIncluding && compareVersions(version, endIncluding) > 0) return false
  if (endExcluding && compareVersions(version, endExcluding) >= 0) return false
  return Boolean(startIncluding || startExcluding || endIncluding || endExcluding)
}

/**
 * Map an observed product name onto the CPE product names it may appear under.
 *
 * These exist because banners and CPE dictionaries disagree on naming — a
 * server announcing `Apache/2.4.7` is `apache:http_server` in NVD.
 *
 * Aliases resolve to *products*, never vendors. A bare "Apache" banner means
 * the HTTP server; it must not authorise matches against Tomcat, CXF, Groovy
 * or any other Apache Foundation project, which is exactly the mistake that
 * attributes unrelated CVEs to a web server.
 */
function componentAliases(name: string): string[] {
  const normalized = normalize(name)
  const aliases = new Set([normalized])

  if (normalized === 'apache' || normalized === 'apachehttpd') {
    aliases.delete(normalized)
    aliases.add('httpserver')
    aliases.add('apachehttpserver')
  }
  if (normalized === 'httpd') {
    aliases.add('httpserver')
  }
  if (normalized === 'iis' || normalized === 'microsoftiis') {
    aliases.add('internetinformationservices')
    aliases.add('internetinformationserver')
  }
  if (normalized === 'express') {
    aliases.add('expressjs')
  }
  if (normalized === 'nodejs' || normalized === 'node') {
    aliases.add('nodejs')
  }
  if (normalized === 'openresty') {
    aliases.add('nginx')
  }

  return [...aliases].filter(Boolean)
}

function cpeMatchesComponent(component: ComponentVersion, match: Record<string, unknown>): boolean {
  if (match.vulnerable === false) return false
  const criteria = String(match.criteria ?? '')
  if (!criteria.startsWith('cpe:2.3:')) return false

  const parts = criteria.split(':')
  const cpeVendor = normalize(parts[3] ?? '')
  const cpeProduct = normalize(parts[4] ?? '')
  const cpeVersion = parts[5] ?? ''
  const aliases = componentAliases(component.name)

  if (!cpeProduct || !aliases.length) return false

  /*
   * Match on the CPE *product*, not the vendor.
   *
   * A vendor publishes many unrelated products: `apache:http_server`,
   * `apache:cxf`, `apache:groovy`, `apache:tomcat`. Matching a banner reading
   * "Apache" against the vendor field attributes every Apache Foundation CVE
   * to the web server — which is how a scanner reports a Groovy
   * deserialization flaw against an HTTP daemon.
   *
   * Substring matching is also dropped: "apache" is a substring of
   * "apacheairflow", so it would produce the same false positives. Only the
   * product field is considered, and only as an exact alias match or a
   * vendor+product concatenation for banners that carry both.
   */
  const candidates = [cpeProduct, `${cpeVendor}${cpeProduct}`].filter(Boolean)

  if (!aliases.some((alias) => candidates.includes(alias))) {
    return false
  }

  if (cpeVersion && cpeVersion !== '*' && cpeVersion !== '-') {
    return compareVersions(component.version, cpeVersion.replace(/\\/g, '')) === 0
  }

  return inRange(component.version, match)
}

function walkCpeMatches(configurations: unknown): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (Array.isArray(record.cpeMatch)) {
      matches.push(...(record.cpeMatch as Record<string, unknown>[]))
    }
    if (Array.isArray(record.nodes)) {
      for (const child of record.nodes) visit(child)
    }
  }
  if (Array.isArray(configurations)) {
    for (const config of configurations) {
      if (
        config &&
        typeof config === 'object' &&
        Array.isArray((config as Record<string, unknown>).nodes)
      ) {
        for (const node of (config as Record<string, unknown>).nodes as unknown[]) visit(node)
      }
    }
  }
  return matches
}

function cvss(cve: Record<string, unknown>): { score: number; severity: Severity } {
  const metrics = (cve.metrics ?? {}) as Record<string, unknown>
  const metricGroups = [
    metrics.cvssMetricV40,
    metrics.cvssMetricV31,
    metrics.cvssMetricV30,
    metrics.cvssMetricV2,
  ]
  for (const group of metricGroups) {
    if (!Array.isArray(group) || group.length === 0) continue
    const first = group[0] as Record<string, unknown>
    const data = (first.cvssData ?? {}) as Record<string, unknown>
    const score = Number(data.baseScore ?? first.baseScore ?? 0)
    const sev = String(data.baseSeverity ?? first.baseSeverity ?? '').toLowerCase()
    const severity: Severity =
      sev === 'critical' || score >= 9
        ? 'critical'
        : sev === 'high' || score >= 7
          ? 'high'
          : sev === 'medium' || score >= 4
            ? 'medium'
            : sev === 'low' || score > 0
              ? 'low'
              : 'info'
    return { score, severity }
  }
  return { score: 0, severity: 'info' }
}

function description(cve: Record<string, unknown>): string {
  const descriptions = cve.descriptions
  if (Array.isArray(descriptions)) {
    const english = descriptions.find(
      (entry) => (entry as Record<string, unknown>).lang === 'en',
    ) as Record<string, unknown> | undefined
    if (english?.value) return String(english.value)
  }
  return 'No NVD description available.'
}

function weakness(cve: Record<string, unknown>): string | null {
  const weaknesses = cve.weaknesses
  if (!Array.isArray(weaknesses)) return null
  for (const item of weaknesses) {
    const descriptions = (item as Record<string, unknown>).description
    if (!Array.isArray(descriptions)) continue
    for (const entry of descriptions) {
      const value = String((entry as Record<string, unknown>).value ?? '')
      const match = value.match(/CWE-\d+/i)
      if (match) return match[0].toUpperCase()
    }
  }
  return null
}

/**
 * Extract advisory URLs from an NVD CVE record.
 *
 * The NVD 2.0 API — the one this module queries — returns `references` as a
 * plain array of `{ url, source, tags }`. The legacy 1.0 API wrapped the same
 * data in `{ referenceData: [...] }`. Both shapes are accepted so that a
 * cached or proxied 1.0 response still yields links rather than silently
 * degrading to a generic NVD detail page.
 */
function references(cve: Record<string, unknown>): string[] {
  const raw = cve.references

  const entries: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown> | undefined)?.referenceData)
      ? ((raw as Record<string, unknown>).referenceData as unknown[])
      : []

  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const url = String((entry as Record<string, unknown>).url ?? '')
    if (!/^https?:\/\//i.test(url)) continue
    seen.add(url)
    if (seen.size >= 8) break
  }

  return [...seen]
}

export function collectComponents(
  technologies: TechnologyEntry[],
  ports: OpenPort[],
): ComponentVersion[] {
  const components = new Map<string, ComponentVersion>()
  for (const technology of technologies) {
    if (!technology.version) continue
    if (technology.confidence && technology.confidence !== 'high') continue
    const key = `${normalize(technology.name)}@${technology.version}`
    components.set(key, {
      name: technology.name,
      version: technology.version,
      source: technology.source ?? 'technology-fingerprint',
    })
  }

  for (const port of ports) {
    if (!port.product || !port.version) continue
    const key = `${normalize(port.product)}@${port.version}`
    components.set(key, {
      name: port.product,
      version: port.version,
      source: `nmap:${port.port}/${port.protocol}`,
    })
  }

  return [...components.values()].slice(0, 8)
}

async function queryNvd(component: ComponentVersion): Promise<CveEntry[]> {
  const url = new URL('https://services.nvd.nist.gov/rest/json/cves/2.0')
  url.searchParams.set('keywordSearch', `${component.name} ${component.version}`)

  const headers: Record<string, string> = { accept: 'application/json' }
  const apiKey = process.env.NVD_API_KEY?.trim()
  if (apiKey) headers.apiKey = apiKey

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`NVD returned HTTP ${response.status}`)
    const data = (await response.json()) as Record<string, unknown>
    const vulnerabilities = Array.isArray(data.vulnerabilities) ? data.vulnerabilities : []
    const entries: CveEntry[] = []

    for (const item of vulnerabilities) {
      const cve = (item as Record<string, unknown>).cve as Record<string, unknown> | undefined
      if (!cve) continue
      const matches = walkCpeMatches(cve.configurations)
      if (!matches.some((match) => cpeMatchesComponent(component, match))) continue
      const scoring = cvss(cve)
      const refs = references(cve)
      const cveId = String(cve.id ?? '')
      if (!/^CVE-\d{4}-\d{4,}$/i.test(cveId)) continue

      entries.push({
        cve_id: cveId.toUpperCase(),
        cvss_score: scoring.score,
        severity: scoring.severity,
        description: description(cve),
        published: String(cve.published ?? ''),
        affected_component: `${component.name} ${component.version}`,
        reference: refs[0] ?? `https://nvd.nist.gov/vuln/detail/${cveId}`,
        references: refs,
        cwe_id: weakness(cve),
        matched_version: component.version,
        source: `NVD (${component.source})`,
      })
    }

    return entries
  } finally {
    clearTimeout(timer)
  }
}

export async function enrichCves(
  technologies: TechnologyEntry[],
  ports: OpenPort[],
): Promise<CveEnrichmentEvidence> {
  const enrichedAt = new Date().toISOString()
  const components = collectComponents(technologies, ports)

  if (components.length === 0) {
    return {
      available: true,
      reason: 'No confidently versioned software was identified, so no NVD queries were made.',
      queried_components: [],
      cves: [],
      enriched_at: enrichedAt,
    }
  }

  const cves = new Map<string, CveEntry>()
  const queried: string[] = []

  try {
    for (const component of components) {
      queried.push(`${component.name} ${component.version}`)
      const entries = await queryNvd(component)
      /*
       * Deduplicate on the CVE id alone. The same component is often observed
       * twice under slightly different names — an HTTP banner reading
       * "Apache 2.4.7" and an Nmap service probe reading "Apache httpd 2.4.7"
       * are the same software, so keying on the component name would list the
       * identical CVE twice. The first observation wins; correlation later
       * records every source that saw it.
       */
      for (const entry of entries) {
        const key = entry.cve_id.toUpperCase()
        if (!cves.has(key)) cves.set(key, entry)
      }
      // NVD rate limits unauthenticated clients. Keep this deterministic and gentle.
      await new Promise((resolve) => setTimeout(resolve, process.env.NVD_API_KEY ? 150 : 700))
    }

    return {
      available: true,
      reason: null,
      queried_components: queried,
      cves: [...cves.values()].sort((a, b) => b.cvss_score - a.cvss_score),
      enriched_at: enrichedAt,
    }
  } catch (error) {
    return {
      available: false,
      reason: `NVD enrichment failed${
        error instanceof Error && error.message ? `: ${error.message}` : '.'
      }`,
      queried_components: queried,
      cves: [...cves.values()],
      enriched_at: enrichedAt,
    }
  }
}

/**
 * Internal helpers exposed for unit testing.
 *
 * These are implementation details of CVE matching, not part of the module's
 * public surface, but they carry the logic most likely to cause a false
 * positive — so they are tested directly rather than only through `enrichCves`,
 * which would require network access.
 */
export const __testing__ = {
  compareVersions,
  inRange,
  cpeMatchesComponent,
  walkCpeMatches,
  cvss,
  references,
  normalize,
}
