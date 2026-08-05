/**
 * Evidence-based analysis.
 *
 * Findings are derived *from* the collected evidence, never sampled from a
 * library of plausible issues. This is what makes the report internally
 * consistent by construction: the same parsed header map decides both what the
 * "Security headers" table shows and whether a "header missing" finding exists,
 * so the two can never disagree.
 */

import type { HttpResult, TlsResult } from '@/lib/scanner/probe'
import type { SecurityHeader, Severity, TechnologyEntry, Vulnerability } from '@/types/report'

/** A finding before an id is assigned. */
type Finding = Omit<Vulnerability, 'id'>

interface HeaderSpec {
  name: string
  recommendation: string
  /** Severity when the header is absent. */
  missingSeverity: Severity
  cwe: string
  owasp: string
  cvss: number
  impact: string
  description: string
  references: string[]
}

/**
 * Headers VulnSight checks. Severities are deliberately calibrated to real
 * industry practice — a missing `Referrer-Policy` is informational, not a
 * vulnerability, and treating it as one is how scanners lose credibility.
 */
const HEADER_SPECS: HeaderSpec[] = [
  {
    name: 'Content-Security-Policy',
    recommendation:
      "Define a Content-Security-Policy, starting from `default-src 'self'` in report-only mode, then promote it to enforcing once validated against real traffic.",
    missingSeverity: 'medium',
    cwe: 'CWE-693',
    owasp: 'A05:2021 · Security Misconfiguration',
    cvss: 5.3,
    description:
      'The response does not include a Content-Security-Policy header. CSP is a defence-in-depth control that restricts which resources the browser may load.',
    impact:
      'Without a CSP the browser will execute any successfully injected script, which increases the impact of a cross-site scripting flaw. On its own this is not exploitable.',
    references: [
      'https://developer.mozilla.org/docs/Web/HTTP/CSP',
      'https://owasp.org/www-project-secure-headers/',
    ],
  },
  {
    name: 'Strict-Transport-Security',
    recommendation:
      'Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` once every subdomain is confirmed to support HTTPS.',
    missingSeverity: 'medium',
    cwe: 'CWE-319',
    owasp: 'A02:2021 · Cryptographic Failures',
    cvss: 5.3,
    description:
      'The HTTP Strict-Transport-Security header is not present, so browsers are not instructed to connect over HTTPS exclusively.',
    impact:
      'A network-positioned attacker can attempt to downgrade a first-time visitor to plaintext HTTP and intercept cookies or credentials.',
    references: ['https://owasp.org/www-project-secure-headers/'],
  },
  {
    name: 'X-Content-Type-Options',
    recommendation: 'Add `X-Content-Type-Options: nosniff` to all responses.',
    missingSeverity: 'low',
    cwe: 'CWE-16',
    owasp: 'A05:2021 · Security Misconfiguration',
    cvss: 2.6,
    description:
      'The `X-Content-Type-Options: nosniff` header is absent, so browsers may MIME-sniff responses instead of trusting the declared content type.',
    impact:
      'A response intended as data could be reinterpreted as script in older browsers. Impact is limited on modern browsers.',
    references: ['https://owasp.org/www-project-secure-headers/'],
  },
  {
    name: 'Referrer-Policy',
    recommendation:
      'Set `Referrer-Policy: strict-origin-when-cross-origin` to limit how much URL data leaks to third parties.',
    missingSeverity: 'info',
    cwe: 'CWE-200',
    owasp: 'A01:2021 · Broken Access Control',
    cvss: 0,
    description:
      'No Referrer-Policy header is set, so the browser default governs how much referrer information is sent to other origins.',
    impact:
      'Full URLs, which may contain identifiers, can be disclosed to third-party origins. Informational for most sites.',
    references: ['https://owasp.org/www-project-secure-headers/'],
  },
  {
    name: 'Permissions-Policy',
    recommendation:
      'Declare a Permissions-Policy that disables browser features the site does not use, e.g. `geolocation=(), camera=(), microphone=()`.',
    missingSeverity: 'info',
    cwe: 'CWE-693',
    owasp: 'A05:2021 · Security Misconfiguration',
    cvss: 0,
    description:
      'No Permissions-Policy header is present, so powerful browser features are governed only by browser defaults.',
    impact:
      'Embedded third-party content may request access to features the site never intends to use. Informational.',
    references: ['https://owasp.org/www-project-secure-headers/'],
  },
]

/** Case-insensitive header lookup against the real response header map. */
function headerValue(headers: Record<string, string>, name: string): string | null {
  const direct = headers[name.toLowerCase()]
  return direct !== undefined && direct !== '' ? direct : null
}

/** Truncate long header values for display without losing meaning. */
function trimValue(value: string, max = 180): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export interface HeaderAnalysis {
  headers: SecurityHeader[]
  findings: Finding[]
}

/**
 * Build the security-header table and its findings from one shared source of
 * truth so they can never contradict each other.
 */
export function analyzeSecurityHeaders(headers: Record<string, string>): HeaderAnalysis {
  const rows: SecurityHeader[] = []
  const findings: Finding[] = []

  const csp =
    headerValue(headers, 'content-security-policy') ??
    headerValue(headers, 'content-security-policy-report-only')
  const cspEnforced = headerValue(headers, 'content-security-policy') !== null

  for (const spec of HEADER_SPECS) {
    const value = headerValue(headers, spec.name)
    const present = value !== null

    rows.push({
      name: spec.name,
      present,
      value: present ? trimValue(value) : null,
      recommendation: spec.recommendation,
    })

    if (!present) {
      findings.push({
        title: `${spec.name} header not set`,
        severity: spec.missingSeverity,
        description: spec.description,
        impact: spec.impact,
        recommendation: spec.recommendation,
        references: spec.references,
        cvss_score: spec.cvss || null,
        cwe_id: spec.cwe,
        cve_id: null,
        owasp_category: spec.owasp,
        source: 'header',
      })
    }
  }

  // CSP present but report-only provides no enforcement — report honestly.
  if (csp && !cspEnforced) {
    findings.push({
      title: 'Content-Security-Policy is report-only',
      severity: 'low',
      description:
        'A Content-Security-Policy-Report-Only header was returned, but no enforcing Content-Security-Policy header was found.',
      impact:
        'Violations are reported but not blocked, so the policy provides monitoring value without actually restricting resource loading.',
      recommendation:
        'Once the report-only policy is clean against production traffic, promote it to an enforcing `Content-Security-Policy` header.',
      references: ['https://developer.mozilla.org/docs/Web/HTTP/CSP'],
      cvss_score: 3.1,
      cwe_id: 'CWE-693',
      cve_id: null,
      owasp_category: 'A05:2021 · Security Misconfiguration',
      source: 'header',
    })
  }

  /*
   * Clickjacking protection can come from either X-Frame-Options or the more
   * modern CSP `frame-ancestors` directive. Reporting XFO as "missing" when
   * frame-ancestors is present would be a false positive, so the row reflects
   * whichever control is actually in place.
   */
  const xfo = headerValue(headers, 'x-frame-options')
  const frameAncestors = csp ? /frame-ancestors/i.test(csp) : false
  const clickjackingCovered = xfo !== null || frameAncestors

  rows.push({
    name: 'X-Frame-Options',
    present: clickjackingCovered,
    value: xfo ? trimValue(xfo) : frameAncestors ? 'covered by CSP frame-ancestors' : null,
    recommendation:
      "Send `X-Frame-Options: DENY` or a CSP `frame-ancestors 'none'` directive to prevent the page being framed.",
  })

  if (!clickjackingCovered) {
    findings.push({
      title: 'No clickjacking protection configured',
      severity: 'low',
      description:
        'Neither an X-Frame-Options header nor a CSP `frame-ancestors` directive was returned.',
      impact:
        'The page can be embedded in a third-party iframe, which enables clickjacking against authenticated users.',
      recommendation:
        "Send `X-Frame-Options: DENY`, or add `frame-ancestors 'none'` to the Content-Security-Policy.",
      references: ['https://owasp.org/www-community/attacks/Clickjacking'],
      cvss_score: 4.3,
      cwe_id: 'CWE-1021',
      cve_id: null,
      owasp_category: 'A05:2021 · Security Misconfiguration',
      source: 'header',
    })
  }

  return { headers: rows, findings }
}

/**
 * Flag version disclosure only when a header genuinely contains a version
 * number. A bare `Server: cloudflare` discloses nothing actionable.
 */
export function analyzeDisclosure(headers: Record<string, string>): Finding[] {
  const findings: Finding[] = []
  const disclosing: string[] = []

  for (const name of ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator']) {
    const value = headerValue(headers, name)
    // Require a digit-dot-digit pattern: that is a version, not just a product.
    if (value && /\d+\.\d+/.test(value)) {
      disclosing.push(`${name}: ${value}`)
    }
  }

  if (disclosing.length) {
    findings.push({
      title: 'Software version disclosed in response headers',
      severity: 'low',
      description: `The following response headers disclose specific software versions: ${disclosing.join('; ')}.`,
      impact:
        'Precise version numbers let an attacker match known exploits to the target during reconnaissance without probing.',
      recommendation:
        'Suppress or genericize version-bearing headers (`Server`, `X-Powered-By`) at the web server or reverse proxy.',
      references: ['https://owasp.org/www-project-secure-headers/'],
      cvss_score: 3.1,
      cwe_id: 'CWE-200',
      cve_id: null,
      owasp_category: 'A05:2021 · Security Misconfiguration',
      source: 'header',
    })
  }

  return findings
}

/** Analyze the real `set-cookie` headers that were returned. */
export function analyzeCookies(setCookie: string[]): Finding[] {
  if (!setCookie.length) return []

  const insecure: string[] = []
  const scriptReadable: string[] = []
  const noSameSite: string[] = []

  for (const raw of setCookie) {
    const [namePart, ...attributeParts] = raw.split(';')
    const name = namePart.split('=')[0]?.trim() || 'cookie'
    const attributes = new Set(
      attributeParts.map((part) => part.trim().split('=')[0]?.toLowerCase()).filter(Boolean),
    )
    if (!attributes.has('secure')) insecure.push(name)
    if (!attributes.has('httponly')) scriptReadable.push(name)
    if (!attributes.has('samesite')) noSameSite.push(name)
  }

  const findings: Finding[] = []

  if (insecure.length) {
    findings.push({
      title: 'Cookie set without the Secure attribute',
      severity: 'medium',
      description: `${insecure.length} cookie(s) were issued without the \`Secure\` attribute: ${insecure.join(', ')}.`,
      impact:
        'The cookie can be transmitted over plaintext HTTP, exposing it to network interception.',
      recommendation: 'Add the `Secure` attribute to every cookie set over HTTPS.',
      references: ['https://owasp.org/www-community/controls/SecureCookieAttribute'],
      cvss_score: 5.0,
      cwe_id: 'CWE-614',
      cve_id: null,
      owasp_category: 'A05:2021 · Security Misconfiguration',
      source: 'cookie',
    })
  }

  if (scriptReadable.length) {
    findings.push({
      title: 'Cookie accessible to client-side JavaScript',
      severity: 'low',
      description: `${scriptReadable.length} cookie(s) were issued without \`HttpOnly\`: ${scriptReadable.join(', ')}.`,
      impact:
        'Injected JavaScript can read the cookie value. This matters most for session cookies.',
      recommendation:
        'Add `HttpOnly` to any cookie that does not need to be read by client-side scripts.',
      references: ['https://owasp.org/www-community/HttpOnly'],
      cvss_score: 3.7,
      cwe_id: 'CWE-1004',
      cve_id: null,
      owasp_category: 'A05:2021 · Security Misconfiguration',
      source: 'cookie',
    })
  }

  if (noSameSite.length) {
    findings.push({
      title: 'Cookie set without an explicit SameSite attribute',
      severity: 'info',
      description: `${noSameSite.length} cookie(s) did not declare \`SameSite\`: ${noSameSite.join(', ')}.`,
      impact:
        'Browsers apply their own default (usually `Lax`). Declaring the intent explicitly avoids behaviour differing between browsers.',
      recommendation: 'Set `SameSite=Lax` or `SameSite=Strict` explicitly on each cookie.',
      references: ['https://owasp.org/www-community/SameSite'],
      cvss_score: null,
      cwe_id: 'CWE-1275',
      cve_id: null,
      owasp_category: 'A05:2021 · Security Misconfiguration',
      source: 'cookie',
    })
  }

  return findings
}

/** Derive findings from the real certificate, and only when it was collected. */
export function analyzeTls(tlsResult: TlsResult, hostname: string): Finding[] {
  if (!tlsResult.available) return []

  const findings: Finding[] = []
  const { daysRemaining, authorized, authorizationError, protocol, altNames } = tlsResult

  if (daysRemaining !== null && daysRemaining < 0) {
    findings.push({
      title: 'TLS certificate has expired',
      severity: 'critical',
      description: `The certificate presented by ${hostname} expired ${Math.abs(daysRemaining)} day(s) ago.`,
      impact:
        'Browsers block access with a full-page interstitial, effectively taking the site offline and destroying user trust.',
      recommendation:
        'Renew the certificate immediately and automate renewal (for example with ACME) plus expiry alerting.',
      references: ['https://letsencrypt.org/docs/'],
      cvss_score: 7.4,
      cwe_id: 'CWE-298',
      cve_id: null,
      owasp_category: 'A02:2021 · Cryptographic Failures',
      source: 'ssl',
    })
  } else if (daysRemaining !== null && daysRemaining <= 14) {
    findings.push({
      title: 'TLS certificate expires within 14 days',
      severity: 'high',
      description: `The certificate for ${hostname} expires in ${daysRemaining} day(s).`,
      impact: 'If renewal fails the site becomes inaccessible to all users without warning.',
      recommendation: 'Renew now and verify that automated renewal is working.',
      references: ['https://letsencrypt.org/docs/'],
      cvss_score: 5.3,
      cwe_id: 'CWE-298',
      cve_id: null,
      owasp_category: 'A02:2021 · Cryptographic Failures',
      source: 'ssl',
    })
  } else if (daysRemaining !== null && daysRemaining <= 30) {
    findings.push({
      title: 'TLS certificate expires within 30 days',
      severity: 'low',
      description: `The certificate for ${hostname} expires in ${daysRemaining} day(s).`,
      impact: 'There is still time to renew, but an unattended expiry would cause an outage.',
      recommendation: 'Confirm automated renewal is configured and monitored.',
      references: ['https://letsencrypt.org/docs/'],
      cvss_score: null,
      cwe_id: 'CWE-298',
      cve_id: null,
      owasp_category: 'A02:2021 · Cryptographic Failures',
      source: 'ssl',
    })
  }

  if (!authorized) {
    findings.push({
      title: 'TLS certificate chain did not validate',
      severity: 'high',
      description: `Validation of the certificate for ${hostname} failed: ${authorizationError ?? 'unknown error'}.`,
      impact: 'Visitors see security warnings, and the failure can mask an interception attempt.',
      recommendation:
        'Install the full certificate chain including intermediates, and confirm the certificate matches the hostname.',
      references: ['https://owasp.org/www-project-secure-headers/'],
      cvss_score: 7.4,
      cwe_id: 'CWE-295',
      cve_id: null,
      owasp_category: 'A02:2021 · Cryptographic Failures',
      source: 'ssl',
    })
  }

  if (protocol && /TLSv1(\.1)?$/.test(protocol)) {
    findings.push({
      title: `Deprecated TLS protocol negotiated (${protocol})`,
      severity: 'medium',
      description: `The connection to ${hostname} negotiated ${protocol}, which is deprecated.`,
      impact:
        'Legacy protocol versions lack modern cipher suites and are disallowed by current compliance baselines.',
      recommendation: 'Disable TLS 1.0/1.1 and require TLS 1.2 or higher.',
      references: ['https://datatracker.ietf.org/doc/rfc8996/'],
      cvss_score: 5.3,
      cwe_id: 'CWE-327',
      cve_id: null,
      owasp_category: 'A02:2021 · Cryptographic Failures',
      source: 'ssl',
    })
  }

  // Only assert a hostname mismatch when we actually have SAN entries to check.
  if (altNames.length && !hostnameMatchesSan(hostname, altNames)) {
    findings.push({
      title: 'Certificate does not cover the requested hostname',
      severity: 'high',
      description: `${hostname} is not listed in the certificate's subject alternative names (${altNames.slice(0, 5).join(', ')}).`,
      impact: 'Browsers reject the certificate for this hostname and warn the user.',
      recommendation:
        'Reissue the certificate with the correct hostname, or serve the site from a covered name.',
      references: ['https://datatracker.ietf.org/doc/html/rfc6125'],
      cvss_score: 7.4,
      cwe_id: 'CWE-295',
      cve_id: null,
      owasp_category: 'A02:2021 · Cryptographic Failures',
      source: 'ssl',
    })
  }

  return findings
}

/** RFC 6125 style match, supporting a single leading wildcard label. */
function hostnameMatchesSan(hostname: string, altNames: string[]): boolean {
  const host = hostname.toLowerCase()
  return altNames.some((raw) => {
    const san = raw.toLowerCase()
    if (san === host) return true
    if (san.startsWith('*.')) {
      const suffix = san.slice(1) // ".example.com"
      if (!host.endsWith(suffix)) return false
      // A wildcard matches exactly one label.
      const remainder = host.slice(0, host.length - suffix.length)
      return remainder.length > 0 && !remainder.includes('.')
    }
    return false
  })
}

/** Findings about how the site handles transport, based on the real final URL. */
export function analyzeTransport(requestedUrl: string, http: HttpResult): Finding[] {
  const findings: Finding[] = []
  if (!http.ok || !http.finalUrl) return findings

  let finalScheme: string
  try {
    finalScheme = new URL(http.finalUrl).protocol
  } catch {
    return findings
  }

  if (finalScheme === 'http:') {
    findings.push({
      title: 'Site is served over plaintext HTTP',
      severity: 'high',
      description: `The request to ${requestedUrl} ended at ${http.finalUrl}, which uses unencrypted HTTP.`,
      impact:
        'All traffic, including credentials and session cookies, can be read and modified in transit.',
      recommendation:
        'Obtain a TLS certificate, serve the site over HTTPS, and redirect all HTTP traffic to HTTPS permanently.',
      references: ['https://https.cio.gov/'],
      cvss_score: 7.5,
      cwe_id: 'CWE-319',
      cve_id: null,
      owasp_category: 'A02:2021 · Cryptographic Failures',
      source: 'transport',
    })
  }

  return findings
}

interface TechSignal {
  name: string
  category: string
  /** Header whose presence proves the technology. */
  header?: string
  /** Regex applied to a header value to extract a version. */
  headerPattern?: RegExp
  /** Regex applied to the HTML body. */
  bodyPattern?: RegExp
}

/**
 * Fingerprints are only emitted when a concrete signal is observed in the real
 * response. Versions are reported only when the target itself discloses them.
 */
const TECH_SIGNALS: TechSignal[] = [
  { name: 'Cloudflare', category: 'CDN / WAF', header: 'cf-ray' },
  { name: 'Vercel', category: 'Hosting', header: 'x-vercel-id' },
  { name: 'Amazon CloudFront', category: 'CDN', header: 'x-amz-cf-id' },
  { name: 'Fastly', category: 'CDN', header: 'x-served-by' },
  { name: 'Netlify', category: 'Hosting', header: 'x-nf-request-id' },
  { name: 'Akamai', category: 'CDN', header: 'x-akamai-transformed' },
  {
    name: 'Next.js',
    category: 'Web Framework',
    bodyPattern: /\/_next\/static|__NEXT_DATA__/,
  },
  { name: 'Nuxt', category: 'Web Framework', bodyPattern: /__NUXT__|\/_nuxt\// },
  {
    name: 'React',
    category: 'JavaScript Library',
    bodyPattern: /data-reactroot|react(?:-dom)?[.@]/,
  },
  { name: 'Vue.js', category: 'JavaScript Library', bodyPattern: /data-v-[0-9a-f]{8}|__VUE__/ },
  { name: 'Svelte', category: 'JavaScript Library', bodyPattern: /svelte-[0-9a-z]{6}/ },
  {
    name: 'WordPress',
    category: 'CMS',
    bodyPattern: /wp-content|wp-includes|wp-json/,
  },
  { name: 'Drupal', category: 'CMS', bodyPattern: /drupal-settings-json|\/sites\/default\/files/ },
  { name: 'Shopify', category: 'E-commerce', bodyPattern: /cdn\.shopify\.com|Shopify\.theme/ },
  { name: 'Google Analytics', category: 'Analytics', bodyPattern: /googletagmanager\.com|gtag\(/ },
  {
    name: 'jQuery',
    category: 'JavaScript Library',
    bodyPattern: /jquery[.-]([0-9]+\.[0-9]+\.[0-9]+)/i,
  },
  { name: 'Bootstrap', category: 'CSS Framework', bodyPattern: /bootstrap(?:\.min)?\.css/i },
  { name: 'Tailwind CSS', category: 'CSS Framework', bodyPattern: /tailwind(?:css)?[.-]/i },
]

/**
 * Identify technologies from real response evidence.
 *
 * Returns an empty list when nothing is detectable — which is a legitimate,
 * truthful outcome for a hardened or minimal site.
 */
export function detectTechnologies(
  headers: Record<string, string>,
  body: string,
): TechnologyEntry[] {
  const found = new Map<string, TechnologyEntry>()

  const add = (name: string, category: string, version: string | null) => {
    const existing = found.get(name)
    if (existing) {
      // Prefer a concrete version if a later signal supplies one.
      if (!existing.version && version) existing.version = version
      return
    }
    found.set(name, { name, category, version })
  }

  // The Server header names the web server; keep a version only if disclosed.
  const server = headerValue(headers, 'server')
  if (server) {
    const match = server.match(/^([A-Za-z][\w.+-]*)(?:\/([\d.]+))?/)
    if (match) {
      const [, product, version] = match
      // "cloudflare" as a Server value is a CDN, categorized by its own signal.
      if (!/^cloudflare$/i.test(product)) {
        add(product, 'Web Server', version ?? null)
      }
    }
  }

  const poweredBy = headerValue(headers, 'x-powered-by')
  if (poweredBy) {
    const match = poweredBy.match(/^([A-Za-z][\w.+-]*)(?:[/ ]([\d.]+))?/)
    if (match) add(match[1], 'Runtime / Framework', match[2] ?? null)
  }

  // A generator meta tag is authoritative when present.
  const generator = body.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)
  if (generator) {
    const raw = generator[1].trim()
    const match = raw.match(/^([A-Za-z][\w.+ -]*?)\s*([\d.]+)?$/)
    if (match) add(match[1].trim(), 'CMS / Generator', match[2] ?? null)
  }

  for (const signal of TECH_SIGNALS) {
    if (signal.header && headerValue(headers, signal.header)) {
      add(signal.name, signal.category, null)
      continue
    }
    if (signal.bodyPattern && body) {
      const match = body.match(signal.bodyPattern)
      if (match) {
        // Capture group 1, when present, is a genuinely disclosed version.
        add(signal.name, signal.category, match[1] ?? null)
      }
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Extract the real `<title>`; returns null when the page has none. */
export function extractTitle(body: string): string | null {
  const match = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return null
  const text = match[1]
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
  return text.length ? text.slice(0, 200) : null
}

/** Resolve the favicon href to an absolute URL, when one is declared. */
export function extractFavicon(body: string, baseUrl: string): string | null {
  const match = body.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i)
  if (!match) return null
  const href = match[0].match(/href=["']([^"']+)["']/i)
  if (!href) return null
  try {
    return new URL(href[1], baseUrl).toString()
  } catch {
    return null
  }
}
