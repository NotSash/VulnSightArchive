/**
 * VulnSight report contract.
 *
 * These types are the single source of truth for every payload exchanged
 * between the frontend and the local TypeScript scan API.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type ScanMode = 'quick' | 'standard' | 'comprehensive'

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed'

export type RiskCategory = 'Safe' | 'Moderate' | 'High' | 'Critical'

/** A single normalized finding. Every scanner emits this shape. */
export interface Vulnerability {
  id: string
  title: string
  severity: Severity
  description: string
  impact: string
  recommendation: string
  references: string[]
  cvss_score: number | null
  cwe_id: string | null
  cve_id: string | null
  owasp_category: string | null
  /** Which scanner surfaced the finding (header, ssl, nuclei, zap, ...). */
  source: string
  /** Concrete observed evidence, when the source exposes it. */
  evidence?: string | null
  /** URL, host, port, template id, or other location for the evidence. */
  location?: string | null

  /*
   * Correlation metadata. Populated by `lib/scanner/correlate.ts` after all
   * scanners have reported. Optional so that a single scanner module can still
   * emit a plain finding without knowing about correlation.
   */

  /** Every independent observation backing this finding, including the first. */
  confirmations?: FindingConfirmation[]
  /** Strength of independent support. See `FindingConfidence`. */
  confidence?: FindingConfidence
  /**
   * The key used to group observations, exposed so a reader can audit *why*
   * two scanner results were treated as the same issue.
   */
  correlation_key?: string
}

/**
 * One tool's independent observation of a finding.
 *
 * When several scanners detect the same weakness, each contributes a
 * confirmation rather than a duplicate finding. This is what lets the report
 * say "confirmed by 3 independent tools" instead of listing the same issue
 * three times and penalising the score three times over.
 */
export interface FindingConfirmation {
  /** Scanner that produced this observation (header, nuclei, zap-passive, ...). */
  source: string
  /** The title that scanner used, preserved for traceability. */
  raw_title: string
  /** Concrete evidence from that source, when it supplied any. */
  evidence?: string | null
  /** Where the source observed it (URL, port, template id). */
  location?: string | null
}

/**
 * How much independent support a finding has.
 *
 * - `confirmed` — two or more independent tools observed it.
 * - `probable`  — a single tool observed it directly, with evidence.
 * - `observed`  — inferred from configuration rather than an active check
 *                 (for example a missing header), so it is real but carries
 *                 no proof of exploitability.
 */
export type FindingConfidence = 'confirmed' | 'probable' | 'observed'

export interface CveEntry {
  cve_id: string
  cvss_score: number
  severity: Severity
  description: string
  published: string
  affected_component: string
  reference: string
  cwe_id?: string | null
  references?: string[]
  matched_version?: string | null
  source?: string
}

export interface OwaspCategoryMapping {
  id: string // e.g. "A05:2021"
  name: string // e.g. "Security Misconfiguration"
  count: number
  severity: Severity
}

export interface TimelineEvent {
  time: string // "14:02:17"
  event: string
  status: 'completed' | 'running' | 'pending' | 'skipped'
  /**
   * What the stage actually found, in one plain sentence.
   *
   * The scanner has always produced this (see `complete()` in
   * `lib/scanner/run.ts`), but it used to be glued onto `event` as
   * `"name · detail"` and split apart again in the UI. A separator inside a
   * display string is not a data model: any stage name containing the
   * separator would have broken it silently. It is now its own field.
   */
  detail?: string
}

export interface TechnologyEntry {
  name: string
  category: string
  version: string | null
  /** Where this technology/version was observed. */
  source?: string
  /** Raw evidence used for the fingerprint, if concise enough to display. */
  evidence?: string | null
  /** Confidence that the version was directly disclosed, not inferred. */
  confidence?: 'low' | 'medium' | 'high'
}

export interface SecurityHeader {
  name: string
  present: boolean
  value: string | null
  recommendation: string
}

export interface OpenPort {
  port: number
  protocol: string
  service: string
  state: 'open' | 'filtered' | 'closed'
  risk: Severity
  product?: string | null
  version?: string | null
  extrainfo?: string | null
  evidence?: string | null
}

export interface SslInfo {
  valid: boolean
  issuer: string
  subject: string
  expires: string
  days_remaining: number
  tls_version: string
  grade: string
  /**
   * Whether certificate details were actually collected. When false, every
   * other field is a placeholder and MUST NOT be read as evidence — in
   * particular `valid: false` then means "unknown", not "invalid".
   */
  available?: boolean
}

/**
 * Evidence of the website title from probes.
 * Title is collected from HTTP response headers and HTML meta tags,
 * with precise source tracking to enable evidence-based confidence.
 */
export interface TitleEvidence {
  /** The page title (from <title>, og:title, browser title, etc.). */
  value: string | null
  /** Source of the title: 'html_title', 'meta_og', 'browser_title', or null if not found. */
  source: string | null
  /** HTTP status code if available from probed response. */
  http_status: number | null
  /** Timestamp when title was last collected. */
  collected_at: string
}

/**
 * Fingerprint sources for a target.
 * Evidence from multiple independent tools: HTTP banners, TLS certs,
 * HTML meta tags, DNS records.
 */
export interface FingerprintEvidence {
  /** HTTP Server header from response. */
  http_server: string | null
  /** TLS certificate subject (from deep probe). */
  tls_subject: string | null
  /** TLS certificate issuer (from deep probe). */
  tls_issuer: string | null
  /** TLS certificate public key algorithm and strength. */
  tls_pubkey: string | null
  /** HTML meta tags (Content-Security-Policy, X-UA-Compatible, etc.) as key-value. */
  html_meta: Record<string, string>
  /** DNS records: A, AAAA, MX, TXT, NS records. */
  dns_records: {
    type: string // 'A', 'AAAA', 'MX', 'TXT', 'NS', 'SOA'
    values: string[]
  }[]
  /** Timestamp when fingerprints were collected. */
  collected_at: string
}

export interface BrowserEvidence {
  available: boolean
  reason: string | null
  final_url: string | null
  title: string | null
  /** Base64 data URL for the screenshot, when collected. */
  screenshot: string | null
  /** Truncated rendered DOM. Full pages can be very large. */
  rendered_dom: string | null
  technologies: TechnologyEntry[]
  collected_at: string
}

export interface NmapEvidence {
  available: boolean
  reason: string | null
  binary: string | null
  command: string | null
  ports: OpenPort[]
  raw_xml: string | null
  scanned_at: string
}

export interface NucleiResultEvidence {
  template_id: string
  name: string
  severity: Severity
  matched_at: string | null
  evidence: string | null
  cve_ids: string[]
  cwe_ids: string[]
  references: string[]
}

export interface NucleiEvidence {
  available: boolean
  reason: string | null
  binary: string | null
  command: string | null
  templates: string | null
  results: NucleiResultEvidence[]
  /**
   * True when the template run was cut short by the timeout. Any results
   * present are still valid, but coverage is incomplete — the report must not
   * present a truncated pass as a clean bill of health.
   */
  truncated: boolean
  scanned_at: string
}

export interface ZapAlertEvidence {
  plugin_id: string
  alert: string
  risk: Severity
  confidence: string | null
  url: string | null
  parameter: string | null
  evidence: string | null
  cwe_id: string | null
  references: string[]
}

export interface ZapEvidence {
  available: boolean
  reason: string | null
  api_url: string | null
  alerts: ZapAlertEvidence[]
  scanned_at: string
}

export interface CveEnrichmentEvidence {
  available: boolean
  reason: string | null
  queried_components: string[]
  cves: CveEntry[]
  enriched_at: string
}

export interface AiEvidence {
  available: boolean
  provider: 'gemini' | 'openai' | 'deterministic'
  reason: string | null
  generated_at: string
}

export interface ScannerEvidence {
  browser?: BrowserEvidence
  nmap?: NmapEvidence
  nuclei?: NucleiEvidence
  zap?: ZapEvidence
  cve?: CveEnrichmentEvidence
  ai?: AiEvidence
}

/**
 * An explicit record of data the scanner could not collect.
 *
 * VulnSight never invents values to fill a gap. When a stage is skipped or a
 * tool is unavailable, it is recorded here and surfaced in the report so the
 * reader can distinguish "we checked and found nothing" from "we could not
 * check".
 */
export interface ScanNote {
  /** Human-readable stage name, e.g. "Screenshot capture". */
  stage: string
  /**
   * `partial` means the stage ran and produced usable data, but did not finish
   * — e.g. a scanner stopped at its time limit. The findings it produced are
   * real; the coverage behind them is incomplete.
   */
  status: 'unavailable' | 'skipped' | 'failed' | 'partial'
  /** Plain-language explanation of why the data is missing. */
  detail: string
}

export interface WebsiteInfo {
  title: string
  domain: string
  ip_address: string
  server: string
  favicon: string | null
  screenshot: string | null
  /** Evidence chain for the page title (status, source, HTTP status). */
  title_evidence?: TitleEvidence
  /** Multi-source fingerprinting evidence from HTTP, TLS, HTML, and DNS. */
  fingerprint_evidence?: FingerprintEvidence
}

export interface ReportMetadata {
  url: string
  scan_mode: ScanMode
  timestamp: string
  duration_seconds: number
}

export interface SeverityDistribution {
  critical: number
  high: number
  medium: number
  low: number
  info: number
}

export interface RiskScore {
  score: number // 0 - 100
  category: RiskCategory
  penalties: { label: string; points: number }[]
}

/** Recommendations grouped by urgency. */
export interface RemediationRoadmap {
  immediate: string[]
  short_term: string[]
  long_term: string[]
}

export interface AiSummary {
  /** Plain-language overview for a non-technical owner. */
  executive_summary: string
  /** Deeper, developer-facing explanation of the same findings. */
  technical_summary: string
  key_risks: string[]
  recommendations: string[]
  /** Recommendations organized into immediate / short / long-term actions. */
  remediation: RemediationRoadmap
  generated_by: string
  available: boolean
}

export interface ScanReport {
  scan_id: string
  status: ScanStatus
  metadata: ReportMetadata
  website: WebsiteInfo
  technologies: TechnologyEntry[]
  security_headers: SecurityHeader[]
  ssl: SslInfo
  /**
   * Ports confirmed OPEN by a port scan.
   *
   * Only genuinely open ports appear here. Connectivity checks against ports
   * VulnSight already contacts (80/443) live in `reachability` instead, so a
   * closed or filtered port is never presented as an exposed service.
   */
  open_ports: OpenPort[]
  /**
   * Reachability of the standard web ports, as observed by a direct TCP
   * connection. Recorded separately from `open_ports` because a `closed` or
   * `filtered` result is a connectivity fact, not a finding.
   */
  reachability?: OpenPort[]
  timeline: TimelineEvent[]
  vulnerabilities: Vulnerability[]
  severity_distribution: SeverityDistribution
  cves: CveEntry[]
  owasp_mapping: OwaspCategoryMapping[]
  risk: RiskScore
  ai: AiSummary
  evidence?: ScannerEvidence
  /** Stages that produced no data, with the reason. See `ScanNote`. */
  notes?: ScanNote[]
}

/** POST /api/scan response. */
export interface ScanStartResponse {
  scan_id: string
  status: ScanStatus
}

/** GET /api/status/:scanId response. */
/**
 * A finding as it looked *during* the scan, before correlation ran.
 *
 * This is deliberately not a `Vulnerability`. Cross-tool agreement cannot be
 * known until every tool has reported, so a live finding carries no
 * `confidence` and is never labelled "confirmed" — only the tool that saw it.
 */
export interface LiveFinding {
  title: string
  severity: Severity
  /** Which analyzer or tool produced this observation. */
  source: string
}

export interface ScanStatusResponse {
  scan_id: string
  /** The host being scanned, so the progress page can name its subject. */
  hostname: string
  status: ScanStatus
  progress: number // 0 - 100
  stage: string
  timeline: TimelineEvent[]
  /**
   * Findings observed so far, streamed as each stage finishes. Empty until the
   * first analyzer completes. These are pre-correlation observations.
   */
  findings_so_far: LiveFinding[]
  /** Counts by severity for the findings above, for a live tally. */
  severity_counts: Record<Severity, number>
  /** Present only when `status` is "failed": why the scan could not complete. */
  error?: string
}
