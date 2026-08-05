/**
 * Local-first scan orchestrator.
 *
 * Runs the real, evidence-gathering pipeline in-process. Everything in the
 * resulting report traces back to an actual DNS answer, HTTP response, or TLS
 * handshake performed here.
 *
 * Capabilities that genuinely require external tooling (headless-browser
 * screenshots, Nmap, Nuclei, ZAP, NVD enrichment) are *not* simulated. They are
 * recorded as unavailable in `report.notes` and their timeline stages are marked
 * `skipped`, so the reader can always tell "checked and clean" apart from
 * "never checked".
 */

import { logger } from '@/lib/logger'
import { buildOptionalAiSummary } from '@/lib/scanner/ai'
import { reviewCorrelation } from '@/lib/scanner/ai-correlate'
import {
  analyzeCookies,
  analyzeDisclosure,
  analyzeSecurityHeaders,
  analyzeTls,
  analyzeTransport,
  detectTechnologies,
  extractFavicon,
  extractTitle,
} from '@/lib/scanner/analyze'
import { collectBrowserEvidence } from '@/lib/scanner/browser'
import { correlateFindings } from '@/lib/scanner/correlate'
import { enrichCves } from '@/lib/scanner/cve'
import { runNmapScan } from '@/lib/scanner/nmap'
import { runNucleiScan } from '@/lib/scanner/nuclei'
import {
  type DnsRecords,
  type DnsResult,
  fetchSite,
  type HttpResult,
  inspectTls,
  probePort,
  resolveHost,
  resolveRecords,
  type TlsResult,
} from '@/lib/scanner/probe'
import { buildRiskScore, buildSeverityDistribution } from '@/lib/scanner/risk'
import { runZapPassiveScan } from '@/lib/scanner/zap'
import { SEVERITY_ORDER } from '@/lib/severity'
import type {
  BrowserEvidence,
  CveEntry,
  FingerprintEvidence,
  LiveFinding,
  NmapEvidence,
  NucleiEvidence,
  OpenPort,
  OwaspCategoryMapping,
  ScanMode,
  ScanNote,
  ScannerEvidence,
  ScanReport,
  SslInfo,
  TechnologyEntry,
  TitleEvidence,
  Vulnerability,
  ZapEvidence,
} from '@/types/report'

/** Stage identifiers, in execution order, per mode. */
const STAGES: Record<ScanMode, string[]> = {
  quick: [
    'Resolving DNS',
    'Fetching site over HTTP',
    'Analyzing security headers',
    'Inspecting TLS certificate',
    'Fingerprinting technologies',
    'Rendering page (Playwright)',
    'Scoring and assembling report',
  ],
  standard: [
    'Resolving DNS',
    'Fetching site over HTTP',
    'Analyzing security headers',
    'Inspecting TLS certificate',
    'Fingerprinting technologies',
    'Analyzing cookies and transport',
    'Checking port reachability',
    'Rendering page (Playwright)',
    'Enumerating ports (Nmap)',
    'CVE enrichment (NVD)',
    'Scoring and assembling report',
  ],
  comprehensive: [
    'Resolving DNS',
    'Fetching site over HTTP',
    'Analyzing security headers',
    'Inspecting TLS certificate',
    'Fingerprinting technologies',
    'Analyzing cookies and transport',
    'Checking port reachability',
    'Collecting DNS records',
    'Probing for exposed files',
    'Rendering page (Playwright)',
    'Enumerating ports (Nmap)',
    'Template scanning (Nuclei)',
    'Passive analysis (OWASP ZAP)',
    'CVE enrichment (NVD)',
    'Scoring and assembling report',
  ],
}

export function stagesForMode(mode: ScanMode): string[] {
  return STAGES[mode]
}

/** Reported when a stage finishes; drives real progress and the timeline. */
export type StageStatus = 'completed' | 'skipped' | 'failed'

export interface StageUpdate {
  index: number
  name: string
  status: StageStatus
  /** Wall-clock time the stage finished, as HH:MM:SS. */
  time: string
  detail?: string
}

export type StageReporter = (update: StageUpdate) => void

/**
 * Emits the findings accumulated so far, after each stage completes.
 *
 * Correlation has not run at this point, so these carry a source but never a
 * confidence. Nothing may be labelled "confirmed" until every tool has
 * reported — agreement is not knowable mid-scan.
 */
export type FindingsReporter = (findings: LiveFinding[]) => void

function clockTime(date = new Date()): string {
  return date.toTimeString().slice(0, 8)
}

/** Raised when the scan cannot produce a meaningful report at all. */
export class ScanFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanFailedError'
  }
}

interface RunOptions {
  scanId: string
  url: string
  hostname: string
  mode: ScanMode
  /** DNS result already obtained during request validation. */
  dns: DnsResult
  /**
   * True when `https://` was assumed rather than typed by the user, which
   * licenses a fallback to plaintext HTTP. See `ValidTarget.schemeAssumed`.
   */
  schemeAssumed?: boolean
  onStage: StageReporter
  /** Optional: receives partial findings as the scan progresses. */
  onFindings?: FindingsReporter
}

/**
 * Signatures that confirm a probed path really is the sensitive file, rather
 * than a soft-404 or SPA catch-all returning 200 with an HTML page.
 */
const EXPOSURE_CHECKS: {
  path: string
  label: string
  severity: 'critical' | 'high'
  signature: RegExp
  description: string
  impact: string
  recommendation: string
  cwe: string
  owasp: string
  cvss: number
}[] = [
  {
    path: '/.env',
    label: 'Environment file publicly accessible',
    severity: 'critical',
    signature: /^\s*[A-Z][A-Z0-9_]*\s*=/m,
    description:
      'A request for `/.env` returned a response whose content matches the format of an environment file (KEY=value pairs).',
    impact:
      'Environment files routinely contain database credentials, API keys, and signing secrets. Public exposure is a direct path to full compromise.',
    recommendation:
      'Remove the file from the web root immediately, block dotfiles at the web server, and rotate every credential it contained.',
    cwe: 'CWE-538',
    owasp: 'A05:2021 · Security Misconfiguration',
    cvss: 9.8,
  },
  {
    path: '/.git/config',
    label: 'Git repository configuration publicly accessible',
    severity: 'critical',
    signature: /\[core\]|repositoryformatversion/i,
    description:
      'A request for `/.git/config` returned a valid Git configuration file, indicating the `.git` directory is served publicly.',
    impact:
      'The full source history can often be reconstructed, exposing application logic and any secrets ever committed.',
    recommendation:
      'Deny access to `.git` at the web server or reverse proxy, and remove the directory from the deployment artifact.',
    cwe: 'CWE-538',
    owasp: 'A05:2021 · Security Misconfiguration',
    cvss: 9.1,
  },
]

/**
 * Fetch the target, falling back from HTTPS to HTTP when — and only when — the
 * scheme was our assumption rather than the user's instruction.
 *
 * A bare hostname like `scanme.nmap.org` is normalised to `https://` because
 * that is the right default for the modern web. But plenty of real hosts still
 * serve HTTP only, and for those the assumption produces a hard scan failure
 * for a site that is perfectly reachable. Refusing to assess a plaintext host
 * is both unhelpful and backwards: a site with no HTTPS at all is exactly the
 * kind of target that most needs a security report.
 *
 * The fallback is deliberately narrow:
 *
 * - It never applies when the user typed `https://` explicitly. Their stated
 *   intent wins, and a failure is reported as a failure.
 * - It only triggers on a *connection-level* refusal, never on a TLS error. A
 *   host that speaks TLS badly — expired certificate, wrong hostname, obsolete
 *   protocol — has a finding we must report, and quietly retrying over HTTP
 *   would hide it. Only a port that is closed outright earns a retry.
 */
/**
 * Transient codes worth one immediate re-attempt on the SAME url.
 *
 * Distinct from the scheme fallback below, which switches https to http. This
 * is for a request that should have worked and did not: a cold DNS cache, a
 * TLS session being negotiated for the first time, a momentarily busy host.
 * The retry is what stops a user's first scan of a site failing while their
 * second succeeds for no reason they can see.
 */
const TRANSIENT_FIRST_ATTEMPT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNRESET',
  'EAI_AGAIN',
])

async function fetchWithSchemeFallback(
  url: string,
  schemeAssumed: boolean,
): Promise<{ http: HttpResult; url: string; downgraded: boolean }> {
  let first = await fetchSite(url)

  /*
   * One retry before giving up on the requested scheme.
   *
   * Deliberately a single retry, not a loop: this runs before every scan, and
   * a host that is genuinely down should be reported as down within seconds
   * rather than after four escalating waits. One extra attempt covers the
   * cold-start case without turning an outage into a two minute hang.
   */
  if (!first.ok && TRANSIENT_FIRST_ATTEMPT_CODES.has((first.errorCode ?? '').toUpperCase())) {
    first = await fetchSite(url)
  }

  if (first.ok || !schemeAssumed || !url.startsWith('https://')) {
    return { http: first, url, downgraded: false }
  }

  if (!isConnectionRefusal(first.errorCode)) {
    return { http: first, url, downgraded: false }
  }

  const httpUrl = `http://${url.slice('https://'.length)}`
  const second = await fetchSite(httpUrl)
  if (!second.ok) {
    /*
     * Report the HTTPS failure, not the HTTP one. The user asked for a
     * hostname; "nothing is listening on either port" is best explained by the
     * original attempt rather than by our silent retry.
     */
    return { http: first, url, downgraded: false }
  }

  return { http: second, url: httpUrl, downgraded: true }
}

/**
 * System error codes that mean "nothing accepted the TCP connection".
 *
 * Deliberately excludes every TLS-layer code. A host that completes a TCP
 * connection and then fails the handshake — expired certificate, hostname
 * mismatch, obsolete protocol — has a finding we are obliged to report.
 * Retrying such a host over plaintext HTTP would erase that finding and
 * present the result as if nothing were wrong.
 */
const RETRYABLE_CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
])

/*
 * Deliberately NOT here: `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`.
 *
 * A timeout can mean a firewall is DROPPING packets on 443 rather than the
 * port being closed, and downgrading to plaintext HTTP in that case would turn
 * a reportable finding into a clean scan. A DNS failure affects both schemes
 * equally, so a scheme change cannot fix it either. Those codes are handled by
 * a same-URL retry in `fetchWithSchemeFallback` instead, which fixes the
 * cold-start case without ever hiding a TLS problem.
 * See `tests/scheme-fallback.test.ts`.
 */

/**
 * Whether a probe failure justifies retrying the same host over HTTP.
 *
 * Branches on the system error code rather than the human-readable reason.
 * `reason` is prose written for the report and gets reworded; matching against
 * it would silently stop working the first time someone improves a message.
 */
export function isConnectionRefusal(errorCode: string | null): boolean {
  if (!errorCode) return false
  return RETRYABLE_CONNECTION_CODES.has(errorCode.toUpperCase())
}

export async function runScan({
  scanId,
  url: requestedUrl,
  hostname,
  mode,
  dns,
  schemeAssumed = false,
  onStage,
  onFindings,
}: RunOptions): Promise<ScanReport> {
  const stages = STAGES[mode]
  const startedAt = new Date()
  const notes: ScanNote[] = []
  const findings: Omit<Vulnerability, 'id'>[] = []

  /**
   * Index of the stage currently being executed.
   *
   * The cursor is implicit: `complete()` advances it and trusts that the
   * caller is on the stage it points at. That coupling is invisible, and it is
   * fragile in a specific way. There are 23 `complete()` calls spread across 8
   * mode-guarded blocks, and their order in the body must match the order of
   * strings in `STAGES[mode]` exactly. Wrap one in a new conditional, or add a
   * stage without adding a call in the right place, and every stage after it
   * silently reports under the wrong name. The UI would show Nuclei finishing
   * while ZAP actually ran, and nothing would throw.
   *
   * Callers may now pass the stage name they believe they are on. When they
   * do, a mismatch throws immediately instead of producing a plausible,
   * wrong timeline. `expected` is optional so this could be adopted without
   * touching all 23 sites at once, but every site should end up passing it.
   */
  let cursor = 0
  const complete = (status: StageStatus, detail?: string, expected?: string) => {
    const index = cursor
    const name = stages[index]
    if (expected !== undefined && name !== expected) {
      throw new Error(
        `Stage misalignment in runScan: reached index ${index} ("${name}") ` +
          `while completing "${expected}". The order of complete() calls no longer ` +
          `matches STAGES.${mode}.`,
      )
    }
    cursor += 1
    onStage({ index, name, status, time: clockTime(), detail })
    // Publish what has been found so far. Doing this from the single stage
    // helper means every stage streams without 12 separate call sites.
    onFindings?.(
      findings.map((finding) => ({
        title: finding.title,
        severity: finding.severity,
        source: finding.source,
      })),
    )
  }
  // ---------------------------------------------------------------- DNS
  // Resolution already happened during validation; record the real outcome.
  complete(
    'completed',
    `${hostname} resolved to ${dns.address}${
      dns.addresses.length > 1 ? ` (+${dns.addresses.length - 1} more)` : ''
    }`,
    'Resolving DNS',
  )

  // --------------------------------------------------------------- HTTP
  const {
    http,
    url: probedUrl,
    downgraded,
  } = await fetchWithSchemeFallback(requestedUrl, schemeAssumed)
  if (!http.ok) {
    complete('failed', http.reason ?? 'The site did not respond.', 'Fetching site over HTTP')
    throw new ScanFailedError(
      http.reason ?? `${hostname} resolved successfully but did not respond over HTTP.`,
    )
  }
  /*
   * The URL that actually answered.
   *
   * `requestedUrl` is what the caller asked for; this is what responded, which
   * differs whenever the scheme fallback downgrades https to http. The
   * parameter used to be reassigned in place, so every later reader had to
   * know that `url` silently changed meaning halfway down a 594-line function.
   * Two names say it instead.
   */
  const assessedUrl = probedUrl

  /*
   * A downgrade is itself a security-relevant fact: the host offers no HTTPS
   * at all. Record it so the reader knows the assessment covers a plaintext
   * deployment, rather than silently presenting HTTP results as if HTTPS had
   * been requested.
   */
  if (downgraded) {
    notes.push({
      stage: 'Transport negotiation',
      status: 'partial',
      detail:
        'HTTPS was tried first and refused the connection, so the assessment continued over plaintext HTTP. This host does not appear to serve HTTPS at all.',
    })
  }

  complete(
    'completed',
    `HTTP ${http.status} from ${http.finalUrl} in ${http.elapsedMs}ms${
      downgraded ? ' (HTTPS unavailable, fell back to HTTP)' : ''
    }`,
    'Fetching site over HTTP',
  )

  const assessed = await resolveAssessedTarget(http.finalUrl ?? assessedUrl, hostname, dns)
  const assessedHostname = assessed.hostname
  const assessedDns = assessed.dns

  // Transport is a fundamental property, so even quick scans report plaintext
  // HTTP instead of hiding it behind the deeper cookie/transport stage.
  findings.push(...analyzeTransport(assessedUrl, http))

  // ------------------------------------------------------------- Headers
  const headerAnalysis = analyzeSecurityHeaders(http.headers)
  findings.push(...headerAnalysis.findings, ...analyzeDisclosure(http.headers))
  const presentCount = headerAnalysis.headers.filter((h) => h.present).length
  complete(
    'completed',
    `${presentCount}/${headerAnalysis.headers.length} recommended headers present`,
    'Analyzing security headers',
  )

  // ----------------------------------------------------------------- TLS
  let ssl: SslInfo
  let tlsResult: TlsResult | null = null
  const usesHttps = assessed.url.protocol === 'https:'

  if (usesHttps) {
    tlsResult = await inspectTls(assessedHostname, assessed.port)
    if (tlsResult.available) {
      findings.push(...analyzeTls(tlsResult, assessedHostname))
      const days = tlsResult.daysRemaining
      ssl = {
        available: true,
        valid: tlsResult.authorized && (days === null || days >= 0),
        issuer: tlsResult.issuer ?? 'Unknown issuer',
        subject: tlsResult.subject ?? assessedHostname,
        expires: tlsResult.validTo
          ? new Date(tlsResult.validTo).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
          : 'Unknown',
        days_remaining: days ?? 0,
        tls_version: tlsResult.protocol ?? 'Unknown',
        // Grade reflects observed facts only; it is not a synthetic rating.
        grade: gradeFor(tlsResult.authorized, days, tlsResult.protocol),
      }
      complete(
        'completed',
        `${tlsResult.protocol ?? 'TLS'} certificate from ${ssl.issuer}, ${days ?? '?'} days remaining`,
        'Inspecting TLS certificate',
      )
    } else {
      ssl = unavailableSsl(assessedHostname)
      notes.push({
        stage: 'TLS certificate inspection',
        status: 'unavailable',
        detail: tlsResult.reason ?? 'The TLS handshake did not complete.',
      })
      complete('failed', tlsResult.reason ?? 'TLS inspection failed.', 'Inspecting TLS certificate')
    }
  } else {
    ssl = unavailableSsl(assessedHostname)
    notes.push({
      stage: 'TLS certificate inspection',
      status: 'skipped',
      detail: 'The site was served over plaintext HTTP, so there is no certificate to inspect.',
    })
    complete('skipped', 'Target is not served over HTTPS.', 'Inspecting TLS certificate')
  }

  // -------------------------------------------------------- Technologies
  let technologies: TechnologyEntry[] = detectTechnologies(http.headers, http.body).map(
    (technology) => ({
      ...technology,
      source: technology.source ?? 'http-response',
      confidence: technology.version ? ('high' as const) : ('medium' as const),
    }),
  )
  complete(
    'completed',
    technologies.length
      ? `${technologies.length} technolog${technologies.length === 1 ? 'y' : 'ies'} identified from response evidence`
      : 'No technologies could be identified from the response',
    'Fingerprinting technologies',
  )

  // ------------------------------------------- Cookies & transport (std+)
  if (mode !== 'quick') {
    findings.push(...analyzeCookies(http.setCookie))
    complete(
      'completed',
      `${http.setCookie.length} cookie(s) inspected; final transport scheme ${usesHttps ? 'HTTPS' : 'HTTP'}`,
      'Analyzing cookies and transport',
    )
  }

  // ------------------------------------------ Port reachability (std+)
  /*
   * Ports confirmed OPEN. Reachability probes are kept out of this list: a
   * `closed` or `filtered` result is a connectivity fact, not an exposed
   * service, and listing it under "open ports" would misrepresent the target.
   */
  let open_ports: OpenPort[] = []
  /** Observed reachability of the standard web ports, reported separately. */
  let reachability: OpenPort[] = []

  if (mode !== 'quick') {
    const target = assessedDns.address ?? assessedHostname
    const [http80, https443] = await Promise.all([probePort(target, 80), probePort(target, 443)])
    reachability = [
      { port: 80, protocol: 'tcp', service: 'http', state: http80, risk: 'info' },
      { port: 443, protocol: 'tcp', service: 'https', state: https443, risk: 'info' },
    ]
    // Only genuinely open ports graduate into the report's open-port list.
    open_ports = reachability
      .filter((entry) => entry.state === 'open')
      .map((entry) => ({ ...entry }))
    complete(
      'completed',
      `Port 80 ${http80}, port 443 ${https443} (only ports VulnSight already contacts are probed)`,
      'Checking port reachability',
    )
  }

  // ------------------------------------------- DNS records (comprehensive)
  let dnsRecords: DnsRecords | null = null
  if (mode === 'comprehensive') {
    const records = await resolveRecords(assessedHostname)
    dnsRecords = records
    if (!records.caa.length) {
      findings.push({
        title: 'No CAA record published',
        severity: 'info',
        description:
          'The domain does not publish a Certification Authority Authorization (CAA) record.',
        impact:
          'Any public CA may issue a certificate for this domain. A CAA record restricts issuance to authorized CAs.',
        recommendation:
          'Publish a CAA record naming only the certificate authorities you intend to use.',
        references: ['https://datatracker.ietf.org/doc/html/rfc8659'],
        cvss_score: null,
        cwe_id: null,
        cve_id: null,
        owasp_category: 'A02:2021 · Cryptographic Failures',
        source: 'dns',
      })
    }
    const spf = records.txt.some((t) => t.toLowerCase().startsWith('v=spf1'))
    if (records.mx.length && !spf) {
      findings.push({
        title: 'Domain accepts mail but publishes no SPF record',
        severity: 'low',
        description:
          'MX records are published for this domain, but no `v=spf1` TXT record was found.',
        impact:
          'Without SPF, receiving servers have no authorized-sender list, which makes the domain easier to spoof in phishing.',
        recommendation:
          'Publish an SPF record listing authorized mail senders, and pair it with DKIM and DMARC.',
        references: ['https://datatracker.ietf.org/doc/html/rfc7208'],
        cvss_score: null,
        cwe_id: 'CWE-290',
        cve_id: null,
        owasp_category: 'A07:2021 · Identification and Authentication Failures',
        source: 'dns',
      })
    }
    complete(
      'completed',
      `${records.ns.length} NS, ${records.mx.length} MX, ${records.caa.length} CAA record(s) found`,
      'Collecting DNS records',
    )
  }

  // -------------------------------------- Exposed files (comprehensive)
  if (mode === 'comprehensive') {
    let confirmed = 0
    const base = http.finalUrl ?? assessedUrl
    for (const check of EXPOSURE_CHECKS) {
      const probeUrl = safeJoin(base, check.path)
      if (!probeUrl) continue
      const res = await fetchSite(probeUrl, 8_000)
      // Require a 200, a non-HTML body, and a matching content signature.
      const looksReal =
        res.ok && res.status === 200 && !res.isHtml && check.signature.test(res.body)
      if (looksReal) {
        confirmed += 1
        findings.push({
          title: check.label,
          severity: check.severity,
          description: `${check.description} Confirmed at ${probeUrl}.`,
          impact: check.impact,
          recommendation: check.recommendation,
          references: ['https://owasp.org/www-project-web-security-testing-guide/'],
          cvss_score: check.cvss,
          cwe_id: check.cwe,
          cve_id: null,
          owasp_category: check.owasp,
          source: 'exposure',
        })
      }
    }

    // security.txt is a positive signal; its absence is informational only.
    const securityTxt = await fetchSite(safeJoin(base, '/.well-known/security.txt') ?? base, 8_000)
    if (!securityTxt.ok || securityTxt.status !== 200) {
      findings.push({
        title: 'No security.txt published',
        severity: 'info',
        description:
          'No `/.well-known/security.txt` file was found, so there is no machine-readable route for reporting vulnerabilities.',
        impact:
          'Researchers who find an issue have no documented disclosure contact, which delays remediation.',
        recommendation:
          'Publish `/.well-known/security.txt` with a security contact and disclosure policy.',
        references: ['https://securitytxt.org/'],
        cvss_score: null,
        cwe_id: null,
        cve_id: null,
        owasp_category: null,
        source: 'exposure',
      })
    }

    complete(
      'completed',
      confirmed === 0
        ? 'No exposed sensitive files were found'
        : `${confirmed} exposed file(s) confirmed`,
      'Probing for exposed files',
    )
  }

  // ----------------------------------------------------------- Playwright
  const browserEvidence = await collectBrowserEvidence(http.finalUrl ?? assessedUrl)
  if (browserEvidence.available) {
    // The browser title is preferred downstream because it reflects
    // JavaScript-rendered pages; the raw HTTP title stays in title_evidence.
    technologies = mergeTechnologies(technologies, browserEvidence.technologies)
    complete(
      'completed',
      `Rendered ${browserEvidence.final_url ?? http.finalUrl ?? assessedUrl}; screenshot and DOM evidence collected`,
      'Rendering page (Playwright)',
    )
  } else {
    notes.push({
      stage: 'Browser rendering (Playwright)',
      status: 'unavailable',
      detail: browserEvidence.reason ?? 'Playwright browser rendering did not run.',
    })
    complete(
      'skipped',
      browserEvidence.reason ?? 'Playwright unavailable.',
      'Rendering page (Playwright)',
    )
  }

  // --------------------------------------------------------------- Nmap
  let nmapEvidence: NmapEvidence | undefined
  if (mode !== 'quick') {
    nmapEvidence = await runNmapScan(assessedHostname, mode)
    if (nmapEvidence.available) {
      open_ports = mergePorts(open_ports, nmapEvidence.ports)
      findings.push(...findingsFromOpenPorts(nmapEvidence.ports))
      complete(
        'completed',
        nmapEvidence.ports.length
          ? `Nmap confirmed ${nmapEvidence.ports.length} open port(s)`
          : 'Nmap completed and found no open TCP ports in scope',
        'Enumerating ports (Nmap)',
      )
    } else {
      notes.push({
        stage: 'Port enumeration (Nmap)',
        status: 'unavailable',
        detail: nmapEvidence.reason ?? 'Nmap did not produce a result.',
      })
      complete('skipped', nmapEvidence.reason ?? 'Nmap unavailable.', 'Enumerating ports (Nmap)')
    }
  }

  // -------------------------------------------------------------- Nuclei
  let nucleiEvidence: NucleiEvidence | undefined
  if (mode === 'comprehensive') {
    nucleiEvidence = await runNucleiScan(http.finalUrl ?? assessedUrl)
    if (nucleiEvidence.available) {
      findings.push(...findingsFromNuclei(nucleiEvidence))
      /*
       * A truncated pass still contributes every result it produced, but the
       * reader must be told coverage was partial — absence of a finding is not
       * evidence of absence when the run was cut short.
       */
      if (nucleiEvidence.truncated) {
        notes.push({
          stage: 'Template scanning (Nuclei)',
          status: 'partial',
          detail:
            nucleiEvidence.reason ??
            'Nuclei was stopped before finishing; template coverage is partial.',
        })
      }
      complete(
        'completed',
        nucleiEvidence.results.length
          ? `Nuclei returned ${nucleiEvidence.results.length} verified template result(s)${
              nucleiEvidence.truncated ? ' before the time limit' : ''
            }`
          : 'Nuclei completed with no template findings',
        'Template scanning (Nuclei)',
      )
    } else {
      /*
       * Distinguish "the tool is not installed" from "the tool ran and was cut
       * short". Both leave us without results, but they are different facts and
       * call for different fixes. Reporting a timeout as `unavailable` sent the
       * reader looking for a missing binary that was in fact present and
       * working.
       */
      notes.push({
        stage: 'Template scanning (Nuclei)',
        status: nucleiEvidence.truncated ? 'partial' : 'unavailable',
        detail: nucleiEvidence.reason ?? 'Nuclei did not produce a result.',
      })
      complete(
        'skipped',
        nucleiEvidence.reason ?? 'Nuclei unavailable.',
        'Template scanning (Nuclei)',
      )
    }
  }

  // ---------------------------------------------------------------- ZAP
  let zapEvidence: ZapEvidence | undefined
  if (mode === 'comprehensive') {
    zapEvidence = await runZapPassiveScan(http.finalUrl ?? assessedUrl)
    if (zapEvidence.available) {
      findings.push(...findingsFromZap(zapEvidence))
      complete(
        'completed',
        zapEvidence.alerts.length
          ? `ZAP passive scan returned ${zapEvidence.alerts.length} alert(s)`
          : 'ZAP passive scan completed with no alerts',
        'Passive analysis (OWASP ZAP)',
      )
    } else {
      notes.push({
        stage: 'Passive analysis (OWASP ZAP)',
        status: 'unavailable',
        detail: zapEvidence.reason ?? 'ZAP passive scanning did not produce a result.',
      })
      complete('skipped', zapEvidence.reason ?? 'ZAP unavailable.', 'Passive analysis (OWASP ZAP)')
    }
  }

  // --------------------------------------------------------- CVE / NVD
  let cveEvidence = undefined as Awaited<ReturnType<typeof enrichCves>> | undefined
  if (mode !== 'quick') {
    cveEvidence = await enrichCves(technologies, open_ports)
    if (cveEvidence.available) {
      findings.push(...findingsFromCves(cveEvidence.cves))
      complete(
        'completed',
        cveEvidence.queried_components.length
          ? `Queried NVD for ${cveEvidence.queried_components.length} versioned component(s); ${cveEvidence.cves.length} matching CVE(s)`
          : (cveEvidence.reason ??
              'No confidently versioned components were available for NVD lookup'),
        'CVE enrichment (NVD)',
      )
    } else {
      notes.push({
        stage: 'CVE enrichment (NVD)',
        status: 'unavailable',
        detail: cveEvidence.reason ?? 'NVD enrichment did not complete.',
      })
      complete('skipped', cveEvidence.reason ?? 'NVD unavailable.', 'CVE enrichment (NVD)')
    }
  }

  // ------------------------------------------------------------- Correlate
  /*
   * Scanners overlap: a missing CSP header is typically reported by our own
   * header analysis, a Nuclei template and a ZAP rule. Correlation collapses
   * those into one finding that records every source which saw it, so the
   * report shows corroboration instead of duplication — and, critically, the
   * risk score charges once per weakness rather than once per observation.
   */
  const correlation = correlateFindings(findings)

  /*
   * Optional second pass. An LLM reviews what the rules left separate and may
   * propose additional links, but it cannot merge anything, cannot invent a
   * finding, and cannot influence severity or the risk score. Suggestions are
   * recorded as a coverage note for human review — deliberately advisory, so
   * that scoring stays reproducible and explainable.
   */
  const aiReview = await reviewCorrelation(correlation.findings)
  if (aiReview.note) notes.push(aiReview.note)
  if (aiReview.suggestions.length > 0) {
    const described = aiReview.suggestions
      .map((suggestion) => {
        const a = correlation.findings[suggestion.a]?.title ?? `#${suggestion.a}`
        const b = correlation.findings[suggestion.b]?.title ?? `#${suggestion.b}`
        return `"${a}" and "${b}" (${suggestion.reason})`
      })
      .join('; ')
    notes.push({
      stage: 'AI correlation review',
      status: 'skipped',
      detail: `An optional AI review suggested these findings may describe the same issue: ${described}. They were NOT merged, because deterministic rules remain the source of truth. This is recorded for human review only.`,
    })
  }

  const vulnerabilities: Vulnerability[] = correlation.findings.map((finding, index) => ({
    ...finding,
    id: `${scanId}-f${index + 1}`,
  }))

  const severity_distribution = buildSeverityDistribution(vulnerabilities)
  const risk = buildRiskScore(severity_distribution)

  // OWASP mapping is aggregated strictly from confirmed findings.
  const owaspMap = new Map<string, OwaspCategoryMapping>()
  for (const v of vulnerabilities) {
    if (!v.owasp_category) continue
    const [id, name] = v.owasp_category.split(' · ')
    const existing = owaspMap.get(id)
    if (existing) {
      existing.count += 1
      if (SEVERITY_ORDER.indexOf(v.severity) < SEVERITY_ORDER.indexOf(existing.severity)) {
        existing.severity = v.severity
      }
    } else {
      owaspMap.set(id, { id, name: name ?? id, count: 1, severity: v.severity })
    }
  }
  const owasp_mapping = [...owaspMap.values()].sort((a, b) => a.id.localeCompare(b.id))

  const cves: CveEntry[] = cveEvidence?.available ? cveEvidence.cves : []

  const finishedAt = new Date()
  const aiResult = await buildOptionalAiSummary({
    domain: assessedHostname,
    dist: severity_distribution,
    risk,
    vulns: vulnerabilities,
    notes,
  })
  if (aiResult.note) notes.push(aiResult.note)
  const ai = aiResult.summary

  const titleEvidence = buildTitleEvidence(http, finishedAt, browserEvidence)
  const pageTitle =
    (browserEvidence.available ? browserEvidence.title : null) ??
    titleEvidence.value ??
    (http.body && http.body.length > 0 ? 'No page title found' : 'Page title not readable')
  const fingerprintEvidence = buildFingerprintEvidence({
    http,
    tls: tlsResult,
    dns: assessedDns,
    dnsRecords,
    browser: browserEvidence,
    collectedAt: finishedAt,
  })
  const evidence: ScannerEvidence = {
    browser: browserEvidence,
    ...(nmapEvidence ? { nmap: nmapEvidence } : {}),
    ...(nucleiEvidence ? { nuclei: nucleiEvidence } : {}),
    ...(zapEvidence ? { zap: zapEvidence } : {}),
    ...(cveEvidence ? { cve: cveEvidence } : {}),
    ai: aiResult.evidence,
  }

  const correlationDetail = [
    `${vulnerabilities.length} finding(s)`,
    correlation.mergedCount > 0
      ? `${correlation.mergedCount} duplicate observation(s) merged`
      : null,
    correlation.confirmedCount > 0
      ? `${correlation.confirmedCount} confirmed by multiple tools`
      : null,
  ]
    .filter(Boolean)
    .join(', ')

  complete(
    'completed',
    `Report assembled with ${correlationDetail}`,
    'Scoring and assembling report',
  )

  /*
   * Every stage must have been reported exactly once. If the cursor did not
   * land on the end of the list, some stage was skipped or double-counted and
   * the timeline the user saw was wrong.
   */
  if (cursor !== stages.length) {
    logger.warn('scan.stage_count_mismatch', {
      scanId,
      mode,
      completed: cursor,
      expected: stages.length,
    })
  }

  return {
    scan_id: scanId,
    status: 'completed',
    metadata: {
      url: assessedUrl,
      scan_mode: mode,
      timestamp: startedAt.toISOString(),
      duration_seconds: Math.max(
        1,
        Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
      ),
    },
    website: {
      /*
       * The real page title. When it is absent we distinguish "the page has no
       * <title>" from "we never received readable HTML" (bot protection, a
       * non-HTML response, or a body we chose not to download) rather than
       * blaming the site for something the scanner could not observe.
       */
      title: pageTitle,
      domain: assessedHostname,
      ip_address: assessedDns.address ?? 'Unknown',
      server: http.headers.server ?? 'Not disclosed',
      favicon: extractFavicon(http.body, http.finalUrl ?? assessedUrl),
      screenshot: browserEvidence.available ? browserEvidence.screenshot : null,
      title_evidence: titleEvidence,
      fingerprint_evidence: fingerprintEvidence,
    },
    technologies,
    security_headers: headerAnalysis.headers,
    ssl,
    open_ports,
    reachability,
    /*
     * Populated by the caller. `runScan` reports stage transitions through
     * `onStage` as they happen; the owner of that stream (the scan store) holds
     * the authoritative timeline and attaches it to the finished report.
     */
    timeline: [],
    vulnerabilities,
    severity_distribution,
    cves,
    owasp_mapping,
    risk,
    ai,
    evidence,
    notes,
  }
}

interface AssessedTarget {
  url: URL
  hostname: string
  port: number
  dns: DnsResult
}

async function resolveAssessedTarget(
  finalUrl: string,
  originalHostname: string,
  originalDns: DnsResult,
): Promise<AssessedTarget> {
  let parsed: URL
  try {
    parsed = new URL(finalUrl)
  } catch {
    throw new ScanFailedError(`The final URL "${finalUrl}" is not valid.`)
  }

  const finalHostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!finalHostname) {
    throw new ScanFailedError('The final URL is missing a hostname.')
  }

  if (finalHostname === originalHostname) {
    return {
      url: parsed,
      hostname: finalHostname,
      port: portForUrl(parsed),
      dns: originalDns,
    }
  }

  const finalDns = await resolveHost(finalHostname)
  if (!finalDns.ok) {
    throw new ScanFailedError(
      finalDns.reason ??
        `The target redirected to ${finalHostname}, which could not be safely resolved.`,
    )
  }

  return {
    url: parsed,
    hostname: finalHostname,
    port: portForUrl(parsed),
    dns: finalDns,
  }
}

function portForUrl(url: URL): number {
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

function buildTitleEvidence(
  http: { body: string; status: number | null },
  collectedAt: Date,
  browser: BrowserEvidence,
): TitleEvidence {
  if (browser.available && browser.title) {
    return {
      value: browser.title,
      source: 'browser_title',
      http_status: http.status,
      collected_at: browser.collected_at,
    }
  }

  const htmlTitle = extractTitle(http.body)
  if (htmlTitle) {
    return {
      value: htmlTitle,
      source: 'html_title',
      http_status: http.status,
      collected_at: collectedAt.toISOString(),
    }
  }

  const ogTitle = extractOpenGraphTitle(http.body)
  return {
    value: ogTitle,
    source: ogTitle ? 'meta_og' : null,
    http_status: http.status,
    collected_at: collectedAt.toISOString(),
  }
}

function extractOpenGraphTitle(body: string): string | null {
  const match = body.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  )
  return match?.[1]?.trim().slice(0, 200) || null
}

function buildFingerprintEvidence({
  http,
  tls,
  dns,
  dnsRecords,
  browser,
  collectedAt,
}: {
  http: { headers: Record<string, string>; body: string }
  tls: TlsResult | null
  dns: DnsResult
  dnsRecords: DnsRecords | null
  browser: BrowserEvidence
  collectedAt: Date
}): FingerprintEvidence {
  return {
    http_server: http.headers.server ?? null,
    tls_subject: tls?.subject ?? null,
    tls_issuer: tls?.issuer ?? null,
    tls_pubkey: tls?.keyBits ? `${tls.keyBits} bits` : null,
    html_meta: extractMetaEvidence(
      http.headers,
      browser.available && browser.rendered_dom ? browser.rendered_dom : http.body,
    ),
    dns_records: buildDnsEvidence(dns, dnsRecords),
    collected_at: collectedAt.toISOString(),
  }
}

function extractMetaEvidence(
  headers: Record<string, string>,
  body: string,
): Record<string, string> {
  const evidence: Record<string, string> = {}
  for (const header of [
    'x-powered-by',
    'x-aspnet-version',
    'x-generator',
    'content-security-policy',
    'content-security-policy-report-only',
    'x-ua-compatible',
    'x-content-type-options',
  ]) {
    const value = headers[header]
    if (value) evidence[`header_${header}`] = value.slice(0, 300)
  }

  /*
   * Cap the number of meta tags retained. A hostile or simply bloated page can
   * carry thousands, and every one would be serialized into the report, the
   * JSON export and the in-memory store.
   */
  const MAX_META_TAGS = 100

  const metaRegex =
    /<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]+content=["']([^"']*)["'][^>]*>/gi
  let metaCount = 0
  let match: RegExpExecArray | null = metaRegex.exec(body)
  while (match !== null && metaCount < MAX_META_TAGS) {
    evidence[`meta_${match[1].toLowerCase().slice(0, 100)}`] = match[2].slice(0, 300)
    metaCount += 1
    match = metaRegex.exec(body)
  }
  return evidence
}

function buildDnsEvidence(
  dns: DnsResult,
  dnsRecords: DnsRecords | null,
): FingerprintEvidence['dns_records'] {
  const a = dns.addresses.filter((address) => !address.includes(':'))
  const aaaa = dns.addresses.filter((address) => address.includes(':'))
  const records: FingerprintEvidence['dns_records'] = []
  if (a.length) records.push({ type: 'A', values: a })
  if (aaaa.length) records.push({ type: 'AAAA', values: aaaa })
  if (dnsRecords?.mx.length) records.push({ type: 'MX', values: dnsRecords.mx })
  if (dnsRecords?.txt.length) records.push({ type: 'TXT', values: dnsRecords.txt })
  if (dnsRecords?.ns.length) records.push({ type: 'NS', values: dnsRecords.ns })
  if (dnsRecords?.caa.length) records.push({ type: 'CAA', values: dnsRecords.caa })
  return records
}

type Finding = Omit<Vulnerability, 'id'>

function mergeTechnologies(first: TechnologyEntry[], second: TechnologyEntry[]): TechnologyEntry[] {
  const merged = new Map<string, TechnologyEntry>()
  for (const technology of [...first, ...second]) {
    const key = technology.name.toLowerCase()
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...technology })
      continue
    }
    if (!existing.version && technology.version) existing.version = technology.version
    if (technology.confidence === 'high') existing.confidence = 'high'
    existing.source = existing.source ?? technology.source
    existing.evidence = existing.evidence ?? technology.evidence ?? null
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Merge port observations from two sources into one list.
 *
 * `discovered` (Nmap) is treated as authoritative for state and service
 * identification: it performs a real service probe, whereas a bare TCP connect
 * only proves that something accepted a connection. Previously any source
 * claiming `open` won, which let a stale connect-probe override Nmap's more
 * accurate result. Richer service metadata still fills gaps from either side.
 */
export function mergePorts(current: OpenPort[], discovered: OpenPort[]): OpenPort[] {
  const merged = new Map<string, OpenPort>()

  for (const port of current) {
    merged.set(`${port.port}/${port.protocol}`, { ...port })
  }

  for (const port of discovered) {
    const key = `${port.port}/${port.protocol}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...port })
      continue
    }

    // Nmap wins on state and service name.
    existing.state = port.state
    existing.service = port.service || existing.service
    // Prefer whichever source actually resolved product/version details.
    existing.product = port.product ?? existing.product ?? null
    existing.version = port.version ?? existing.version ?? null
    existing.extrainfo = port.extrainfo ?? existing.extrainfo ?? null
    existing.evidence = port.evidence ?? existing.evidence ?? null
    // Keep the most severe assessment either source produced.
    if (SEVERITY_ORDER.indexOf(port.risk) < SEVERITY_ORDER.indexOf(existing.risk)) {
      existing.risk = port.risk
    }
  }

  return [...merged.values()]
    .filter((port) => port.state === 'open')
    .sort((a, b) => a.port - b.port)
}

function findingsFromOpenPorts(ports: OpenPort[]): Finding[] {
  return ports
    .filter((port) => port.state === 'open' && port.risk !== 'info')
    .map((port) => ({
      title: `Potentially sensitive service exposed on ${port.port}/${port.protocol}`,
      severity: port.risk,
      description: `Nmap reported ${port.port}/${port.protocol} open as ${port.service}${
        port.product ? ` (${[port.product, port.version].filter(Boolean).join(' ')})` : ''
      }.`,
      impact:
        'Exposed administrative, remote-access, or database services increase the attack surface and should be reachable only from trusted networks.',
      recommendation:
        'Restrict access with firewall rules or VPN, and confirm the exposed service is intentionally public and fully patched.',
      references: ['https://nmap.org/book/man-version-detection.html'],
      cvss_score: null,
      cwe_id: 'CWE-200',
      cve_id: null,
      owasp_category: 'A05:2021 · Security Misconfiguration',
      source: 'nmap',
      evidence: port.evidence ?? null,
      location: `${port.port}/${port.protocol}`,
    }))
}

function findingsFromNuclei(evidence: NucleiEvidence): Finding[] {
  return evidence.results.map((result) => ({
    title: result.name,
    severity: result.severity,
    description: `Nuclei template ${result.template_id} matched${
      result.matched_at ? ` at ${result.matched_at}` : ''
    }.`,
    impact:
      result.severity === 'info'
        ? 'This is an informational template result. Review it as context, not as proof of exploitability.'
        : 'The template matched concrete response evidence for this target and should be reviewed for remediation.',
    recommendation:
      'Review the matched template evidence, confirm applicability, and apply the remediation recommended by the affected product or template reference.',
    references: result.references,
    cvss_score: null,
    cwe_id: result.cwe_ids[0] ?? null,
    cve_id: result.cve_ids[0] ?? null,
    owasp_category: result.cwe_ids.length ? 'A06:2021 · Vulnerable and Outdated Components' : null,
    source: 'nuclei',
    evidence: result.evidence,
    location: result.matched_at,
  }))
}

function findingsFromZap(evidence: ZapEvidence): Finding[] {
  return evidence.alerts.map((alert) => ({
    title: alert.alert,
    severity: alert.risk,
    description: `OWASP ZAP passive scanner reported "${alert.alert}"${
      alert.url ? ` on ${alert.url}` : ''
    }.`,
    impact:
      alert.risk === 'info'
        ? 'This passive alert is informational and may represent hardening context rather than an exploitable weakness.'
        : 'The passive scanner observed response evidence associated with this security weakness.',
    recommendation:
      'Review the ZAP alert, validate it against the affected response, and apply the remediation described by OWASP or the affected component.',
    references: alert.references,
    cvss_score: null,
    cwe_id: alert.cwe_id,
    cve_id: null,
    owasp_category: alert.cwe_id ? 'A05:2021 · Security Misconfiguration' : null,
    source: 'zap-passive',
    evidence: alert.evidence,
    location: alert.url,
  }))
}

function findingsFromCves(cves: CveEntry[]): Finding[] {
  return cves.map((cve) => ({
    title: `${cve.cve_id} affects ${cve.affected_component}`,
    severity: cve.severity,
    description: cve.description,
    impact:
      'The version was directly identified and NVD lists a matching vulnerable CPE/version range for this CVE.',
    recommendation: `Upgrade or patch ${cve.affected_component} according to the vendor advisory, then re-scan to confirm the vulnerable version is no longer exposed.`,
    references: cve.references?.length ? cve.references : [cve.reference],
    cvss_score: cve.cvss_score || null,
    cwe_id: cve.cwe_id ?? null,
    cve_id: cve.cve_id,
    owasp_category: 'A06:2021 · Vulnerable and Outdated Components',
    source: 'nvd',
    evidence: `Matched ${cve.affected_component} version ${cve.matched_version ?? ''} against NVD CPE data.`,
    location: cve.reference,
  }))
}

/** Placeholder SSL block, explicitly flagged as not collected. */
function unavailableSsl(hostname: string): SslInfo {
  return {
    available: false,
    valid: false,
    issuer: 'Not collected',
    subject: hostname,
    expires: 'Not collected',
    days_remaining: 0,
    tls_version: 'Not collected',
    grade: 'N/A',
  }
}

/**
 * Grade derived only from observed certificate facts. Returns 'N/A' rather than
 * inventing a rating when the inputs are unknown.
 */
function gradeFor(
  authorized: boolean,
  daysRemaining: number | null,
  protocol: string | null,
): string {
  if (!authorized) return 'F'
  if (daysRemaining !== null && daysRemaining < 0) return 'F'
  if (protocol && /TLSv1(\.1)?$/.test(protocol)) return 'C'
  if (daysRemaining !== null && daysRemaining <= 14) return 'B'
  if (protocol === 'TLSv1.3') return 'A+'
  if (protocol === 'TLSv1.2') return 'A'
  /*
   * The certificate validated and is not expiring, but the negotiated protocol
   * was not recognised. That is a healthy connection we cannot grade precisely
   * — distinct from 'N/A', which means no certificate was collected at all.
   */
  return 'Unrated'
}

/** Join a path onto a base URL, returning null if the result is invalid. */
function safeJoin(base: string, path: string): string | null {
  try {
    return new URL(path, base).toString()
  } catch {
    return null
  }
}
