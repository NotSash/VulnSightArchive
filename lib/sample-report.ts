import type { ScanNote, ScanReport, Vulnerability } from '@/types/report'

/**
 * A permanent, seeded sample report.
 *
 * The homepage promises "read a finished report before you scan anything", so
 * one has to exist at all times — reports otherwise live in memory with a
 * one-hour TTL, which would leave that link broken for most visitors.
 *
 * Every value here is transcribed from a real comprehensive scan of
 * scanme.nmap.org (report vs_amdym9f9p0, 2 August 2026, 223 seconds). Nothing
 * is embellished: the four corroborated findings, the two CVEs, the closed 443
 * port and the three coverage gaps are all exactly what that run produced.
 * A fabricated sample would undercut the one thing this product sells.
 *
 * scanme.nmap.org is published by the Nmap authors expressly for scan testing.
 */

const SAMPLE_ID = 'sample'

function vuln(v: Omit<Vulnerability, 'references'> & { references?: string[] }): Vulnerability {
  return { references: [], ...v }
}

const VULNERABILITIES: Vulnerability[] = [
  vuln({
    id: 'VS-001',
    title: 'Content-Security-Policy header not set',
    severity: 'high',
    description:
      'A Content-Security-Policy tells the browser which scripts it is allowed to run. Without one, any script that reaches the page will be executed without question, whether it arrived through a comment box, a URL parameter, or a compromised third-party widget.',
    impact:
      'This is the most common route by which small sites are turned into crypto-miners or card skimmers. It also removes a key defence against cross-site scripting.',
    recommendation:
      "Add a policy, starting strict and loosening only where the site breaks: default-src 'self'; object-src 'none'; frame-ancestors 'none'. Deploy it as Content-Security-Policy-Report-Only first so you can see what it would have blocked.",
    references: ['https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Security-Policy'],
    cvss_score: null,
    cwe_id: 'CWE-693',
    cve_id: null,
    owasp_category: 'A05:2021',
    source: 'header',
    evidence: 'No content-security-policy header in the response.',
    location: null,
    confidence: 'confirmed',
    confirmations: [
      {
        source: 'header',
        raw_title: 'Content-Security-Policy header not set',
        evidence: 'No content-security-policy header in the response.',
        location: null,
      },
      {
        source: 'zap-passive',
        raw_title: 'Content Security Policy (CSP) Header Not Set',
        evidence: 'ZAP passive alert 10038.',
        location: 'http://scanme.nmap.org/',
      },
    ],
    correlation_key: 'topic:csp-missing',
  }),
  vuln({
    id: 'VS-002',
    title: 'Site is served over plaintext HTTP',
    severity: 'high',
    description:
      'The site answers on plain HTTP and nothing is listening on the HTTPS port, so traffic travels unencrypted.',
    impact:
      'Anyone on the same network, such as a caf\u00e9, an airport or an office, can read and alter what visitors send and receive, including any credentials or session cookies.',
    recommendation:
      'Obtain a free certificate from Let\u2019s Encrypt, serve on port 443, redirect all HTTP traffic to HTTPS, and add HSTS once you are confident.',
    references: ['https://letsencrypt.org/getting-started/'],
    cvss_score: null,
    cwe_id: 'CWE-319',
    cve_id: null,
    owasp_category: 'A02:2021',
    source: 'header',
    evidence: 'Scheme http:// with port 443 closed.',
    location: 'http://scanme.nmap.org/',
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:plaintext-http',
  }),
  vuln({
    id: 'VS-003',
    title: 'Server version disclosed: Apache httpd 2.4.7',
    severity: 'medium',
    description:
      'The server announces its exact version in every response. Apache 2.4.7 dates from 2013 and has publicly documented flaws.',
    impact:
      'An attacker can look up exactly which exploits apply without probing the server first, so the reconnaissance that would normally alert you never happens.',
    recommendation:
      'Upgrade Apache, because this release is years out of date. Then set ServerTokens Prod and ServerSignature Off so the version is not advertised.',
    references: ['https://httpd.apache.org/security/vulnerabilities_24.html'],
    cvss_score: 8.2,
    cwe_id: 'CWE-200',
    cve_id: 'CVE-2021-44224',
    owasp_category: 'A06:2021',
    source: 'header',
    evidence: 'Server: Apache/2.4.7 (Ubuntu)',
    location: null,
    confidence: 'confirmed',
    confirmations: [
      {
        source: 'header',
        raw_title: 'Server version disclosed',
        evidence: 'Server: Apache/2.4.7 (Ubuntu)',
        location: null,
      },
      {
        source: 'nmap',
        raw_title: 'Apache httpd 2.4.7 on 80/tcp',
        evidence: 'Service/version detection on port 80.',
        location: '80/tcp',
      },
      {
        source: 'zap-passive',
        raw_title: 'Server Leaks Version Information',
        evidence: 'ZAP passive alert 10036.',
        location: 'http://scanme.nmap.org/',
      },
      {
        source: 'nvd',
        raw_title: 'CVE-2021-44224 affects Apache httpd 2.4.7',
        evidence: 'CVSS 8.2.',
        location: 'apache:http_server:2.4.7',
      },
    ],
    correlation_key: 'topic:version-disclosure',
  }),
  vuln({
    id: 'VS-004',
    title: 'Missing anti-clickjacking protection',
    severity: 'medium',
    description: 'Nothing stops another site from loading this page inside an invisible frame.',
    impact:
      'A malicious page can overlay its own controls and trick a visitor into clicking something they cannot see, such as approving a change or a payment.',
    recommendation:
      "Add frame-ancestors 'none' to your Content-Security-Policy, which also addresses VS-001.",
    references: ['https://owasp.org/www-community/attacks/Clickjacking'],
    cvss_score: null,
    cwe_id: 'CWE-1021',
    cve_id: null,
    owasp_category: 'A05:2021',
    source: 'header',
    evidence: 'Neither X-Frame-Options nor frame-ancestors present.',
    location: null,
    confidence: 'confirmed',
    confirmations: [
      {
        source: 'header',
        raw_title: 'Missing anti-clickjacking protection',
        evidence: 'Neither X-Frame-Options nor frame-ancestors present.',
        location: null,
      },
      {
        source: 'zap-passive',
        raw_title: 'Missing Anti-clickjacking Header',
        evidence: 'ZAP passive alert 10020.',
        location: 'http://scanme.nmap.org/',
      },
    ],
    correlation_key: 'topic:clickjacking',
  }),
  vuln({
    id: 'VS-005',
    title: 'X-Content-Type-Options header missing',
    severity: 'medium',
    description:
      'Browsers are allowed to guess the type of a file rather than trusting the type the server declares.',
    impact:
      'A file uploaded as an image can be re-interpreted as a script and executed, turning an upload feature into a code-execution route.',
    recommendation: 'Send X-Content-Type-Options: nosniff on every response.',
    references: ['https://developer.mozilla.org/docs/Web/HTTP/Headers/X-Content-Type-Options'],
    cvss_score: null,
    cwe_id: 'CWE-16',
    cve_id: null,
    owasp_category: 'A05:2021',
    source: 'header',
    evidence: 'No x-content-type-options header in the response.',
    location: null,
    confidence: 'confirmed',
    confirmations: [
      {
        source: 'header',
        raw_title: 'X-Content-Type-Options header missing',
        evidence: 'No x-content-type-options header in the response.',
        location: null,
      },
      {
        source: 'zap-passive',
        raw_title: 'X-Content-Type-Options Header Missing',
        evidence: 'ZAP passive alert 10021.',
        location: 'http://scanme.nmap.org/',
      },
    ],
    correlation_key: 'topic:content-type-options',
  }),
  vuln({
    id: 'VS-006',
    title: 'Referrer-Policy not set',
    severity: 'low',
    description:
      'Without a referrer policy the browser may send the full URL of this page to any site a visitor clicks through to.',
    impact:
      'URLs containing tokens, identifiers or private paths can leak to third parties in the Referer header.',
    recommendation: 'Send Referrer-Policy: strict-origin-when-cross-origin.',
    references: [],
    cvss_score: null,
    cwe_id: 'CWE-200',
    cve_id: null,
    owasp_category: 'A05:2021',
    source: 'header',
    evidence: 'No referrer-policy header in the response.',
    location: null,
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:referrer-policy',
  }),
  vuln({
    id: 'VS-007',
    title: 'Permissions-Policy not set',
    severity: 'low',
    description:
      'The site does not state which browser features (camera, microphone, geolocation) embedded content may use.',
    impact: 'Third-party frames inherit access to powerful features that they have no need for.',
    recommendation:
      'Send a Permissions-Policy header disabling the features the site does not use.',
    references: [],
    cvss_score: null,
    cwe_id: 'CWE-16',
    cve_id: null,
    owasp_category: 'A05:2021',
    source: 'header',
    evidence: 'No permissions-policy header in the response.',
    location: null,
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:permissions-policy',
  }),
  vuln({
    id: 'VS-008',
    title: 'SSH service exposed: OpenSSH 6.6.1p1',
    severity: 'low',
    description: 'Port 22 is open and running OpenSSH 6.6.1p1, a release from 2014.',
    impact:
      'An outdated SSH daemon reachable from the internet is a standing target for credential-stuffing and known protocol weaknesses.',
    recommendation:
      'Upgrade OpenSSH, restrict port 22 to known addresses, and disable password authentication in favour of keys.',
    references: [],
    cvss_score: null,
    cwe_id: 'CWE-1104',
    cve_id: null,
    owasp_category: 'A06:2021',
    source: 'nmap',
    evidence: 'OpenSSH 6.6.1p1 Ubuntu 2ubuntu2.13 (Ubuntu Linux; protocol 2.0)',
    location: '22/tcp',
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:ssh-exposed',
  }),
  vuln({
    id: 'VS-009',
    title: 'Unusual service on port 31337',
    severity: 'info',
    description: 'Port 31337 is open but did not identify itself to the scanner.',
    impact:
      'An unidentified listening service is worth confirming is intentional; this host runs it deliberately.',
    recommendation: 'Confirm the service is expected and firewall it if not.',
    references: [],
    cvss_score: null,
    cwe_id: null,
    cve_id: null,
    owasp_category: null,
    source: 'nmap',
    evidence: 'tcpwrapped',
    location: '31337/tcp',
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:unknown-service:31337',
  }),
  vuln({
    id: 'VS-010',
    title: 'Nping echo service on port 9929',
    severity: 'info',
    description: 'Port 9929 runs the Nping echo service.',
    impact: 'Expected on this host, which exists for scan testing.',
    recommendation: 'No action needed for this target.',
    references: [],
    cvss_score: null,
    cwe_id: null,
    cve_id: null,
    owasp_category: null,
    source: 'nmap',
    evidence: 'Nping echo',
    location: '9929/tcp',
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:service:9929',
  }),
  vuln({
    id: 'VS-011',
    title: 'No Strict-Transport-Security header',
    severity: 'info',
    description: 'HSTS was not evaluated because the site does not serve HTTPS at all.',
    impact:
      'Reported for completeness. The underlying issue is the lack of HTTPS, covered by VS-002.',
    recommendation: 'Enable HTTPS first, then add Strict-Transport-Security.',
    references: [],
    cvss_score: null,
    cwe_id: null,
    cve_id: null,
    owasp_category: 'A05:2021',
    source: 'header',
    evidence: 'Not applicable over plaintext HTTP.',
    location: null,
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:hsts',
  }),
  vuln({
    id: 'VS-012',
    title: 'Cookies not evaluated',
    severity: 'info',
    description: 'The server set no cookies, so cookie flags could not be assessed.',
    impact: 'No exposure. Recorded so the absence is explicit rather than assumed.',
    recommendation: 'None.',
    references: [],
    cvss_score: null,
    cwe_id: null,
    cve_id: null,
    owasp_category: null,
    source: 'header',
    evidence: 'No Set-Cookie headers observed.',
    location: null,
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:cookies',
  }),
  vuln({
    id: 'VS-013',
    title: 'Directory listing not enabled',
    severity: 'info',
    description: 'Probed paths did not return directory indexes.',
    impact: 'None. This is the desired configuration.',
    recommendation: 'No action needed.',
    references: [],
    cvss_score: null,
    cwe_id: null,
    cve_id: null,
    owasp_category: null,
    source: 'exposure',
    evidence: 'No index pages returned for probed paths.',
    location: null,
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:directory-listing',
  }),
  vuln({
    id: 'VS-014',
    title: 'Cross-Origin-Opener-Policy not set',
    severity: 'medium',
    description: 'The page does not isolate its browsing context from cross-origin windows.',
    impact:
      'A window opened by, or opening, this page can retain a reference to it, enabling cross-origin interference.',
    recommendation: 'Send Cross-Origin-Opener-Policy: same-origin.',
    references: [],
    cvss_score: null,
    cwe_id: 'CWE-1021',
    cve_id: null,
    owasp_category: 'A05:2021',
    source: 'header',
    evidence: 'No cross-origin-opener-policy header in the response.',
    location: null,
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:coop',
  }),
  vuln({
    id: 'VS-015',
    title: 'Outdated Apache release in use',
    severity: 'medium',
    description:
      'Apache httpd 2.4.7 is matched by a second published advisory beyond the headline CVE.',
    impact: 'Multiple known issues apply to this release; the vendor no longer patches it.',
    recommendation: 'Upgrade to a currently supported Apache release.',
    references: [],
    cvss_score: 5.4,
    cwe_id: 'CWE-1104',
    cve_id: 'CVE-2025-66200',
    owasp_category: 'A06:2021',
    source: 'nvd',
    evidence: 'CVSS 5.4.',
    location: 'apache:http_server:2.4.7',
    confidence: 'observed',
    confirmations: [],
    correlation_key: 'topic:outdated-component',
  }),
]

const NOTES: ScanNote[] = [
  {
    stage: 'Inspecting TLS certificate',
    status: 'skipped',
    detail:
      'The HTTPS certificate was not checked: this host only answers on plain HTTP, and port 443 was closed.',
  },
  {
    stage: 'AI correlation review',
    status: 'skipped',
    detail: 'No AI provider key is configured, so the deterministic correlation stands alone.',
  },
  {
    stage: 'LLM summary',
    status: 'skipped',
    detail: 'The written summary was generated from the rules rather than a model.',
  },
]

export const SAMPLE_REPORT: ScanReport = {
  scan_id: SAMPLE_ID,
  status: 'completed',
  metadata: {
    url: 'http://scanme.nmap.org/',
    scan_mode: 'comprehensive',
    timestamp: '2026-08-02T09:56:31.000Z',
    duration_seconds: 223,
  },
  website: {
    title: 'Go ahead and ScanMe!',
    domain: 'scanme.nmap.org',
    ip_address: '45.33.32.156',
    server: 'Apache/2.4.7 (Ubuntu)',
    favicon: null,
    screenshot: null,
  },
  technologies: [
    { name: 'Apache HTTP Server', category: 'Web server', version: '2.4.7', source: 'header' },
    { name: 'Ubuntu', category: 'Operating system', version: null, source: 'nmap' },
    { name: 'OpenSSH', category: 'Remote access', version: '6.6.1p1', source: 'nmap' },
  ],
  security_headers: [
    {
      name: 'Content-Security-Policy',
      present: false,
      value: null,
      recommendation: "Start with default-src 'self'; object-src 'none'; frame-ancestors 'none'.",
    },
    {
      name: 'X-Frame-Options',
      present: false,
      value: null,
      recommendation: "Prefer frame-ancestors 'none' in your Content-Security-Policy.",
    },
    {
      name: 'X-Content-Type-Options',
      present: false,
      value: null,
      recommendation: 'Send nosniff on every response.',
    },
    {
      name: 'Strict-Transport-Security',
      present: false,
      value: null,
      recommendation: 'Enable HTTPS first, then add HSTS.',
    },
    {
      name: 'Referrer-Policy',
      present: false,
      value: null,
      recommendation: 'Send strict-origin-when-cross-origin.',
    },
    {
      name: 'Permissions-Policy',
      present: false,
      value: null,
      recommendation: 'Disable browser features the site does not use.',
    },
  ],
  /*
   * available:false is load-bearing. Every other field here is a placeholder,
   * and `valid: false` must be read as "not collected", never as "the
   * certificate is invalid".
   */
  ssl: {
    valid: false,
    available: false,
    issuer: 'Not collected',
    subject: 'Not collected',
    expires: 'Not collected',
    days_remaining: 0,
    tls_version: 'Not collected',
    grade: 'N/A',
  },
  open_ports: [
    {
      port: 22,
      protocol: 'tcp',
      state: 'open',
      service: 'ssh',
      risk: 'low',
      product: 'OpenSSH',
      version: '6.6.1p1 Ubuntu 2ubuntu2.13',
      extrainfo: 'Ubuntu Linux; protocol 2.0',
      evidence: 'nmap -sV service detection',
    },
    {
      port: 80,
      protocol: 'tcp',
      state: 'open',
      service: 'http',
      risk: 'info',
      product: 'Apache httpd',
      version: '2.4.7',
      extrainfo: '(Ubuntu)',
      evidence: 'nmap -sV service detection',
    },
    {
      port: 9929,
      protocol: 'tcp',
      state: 'open',
      service: 'nping-echo',
      risk: 'info',
      product: 'Nping echo',
      version: null,
      extrainfo: null,
      evidence: 'nmap -sV service detection',
    },
    {
      port: 31337,
      protocol: 'tcp',
      state: 'open',
      service: 'tcpwrapped',
      risk: 'info',
      product: null,
      version: null,
      extrainfo: null,
      evidence: 'nmap -sV service detection',
    },
  ],
  reachability: [
    { port: 80, protocol: 'tcp', state: 'open', service: 'http', risk: 'info' },
    { port: 443, protocol: 'tcp', state: 'closed', service: 'https', risk: 'info' },
  ],
  timeline: [
    { time: '09:52:46', event: 'Resolving DNS · 45.33.32.156', status: 'completed' },
    {
      time: '09:52:48',
      event: 'Fetching site over HTTP · port 443 closed, continued over HTTP',
      status: 'completed',
    },
    { time: '09:52:48', event: 'Analyzing security headers · 6 checked', status: 'completed' },
    { time: '09:52:48', event: 'Inspecting TLS certificate · skipped', status: 'skipped' },
    { time: '09:52:49', event: 'Fingerprinting technologies · 3 identified', status: 'completed' },
    { time: '09:52:49', event: 'Analyzing cookies and transport', status: 'completed' },
    { time: '09:52:50', event: 'Checking port reachability', status: 'completed' },
    { time: '09:52:51', event: 'Collecting DNS records', status: 'completed' },
    { time: '09:52:52', event: 'Probing for exposed files · none found', status: 'completed' },
    { time: '09:52:58', event: 'Rendering page (Playwright)', status: 'completed' },
    {
      time: '09:52:48',
      event: 'Enumerating ports (Nmap) · 4 open port(s)',
      status: 'completed',
    },
    {
      time: '09:55:22',
      event: 'Template scanning (Nuclei) · no template findings',
      status: 'completed',
    },
    {
      time: '09:55:25',
      event: 'Passive analysis (OWASP ZAP) · 6 alert(s)',
      status: 'completed',
    },
    {
      time: '09:55:29',
      event: 'CVE enrichment (NVD) · 2 matching CVE(s)',
      status: 'completed',
    },
    {
      time: '09:55:29',
      event:
        'Scoring and assembling report · 15 finding(s), 4 merged, 4 confirmed by multiple tools',
      status: 'completed',
    },
  ],
  vulnerabilities: VULNERABILITIES,
  severity_distribution: { critical: 0, high: 2, medium: 5, low: 3, info: 5 },
  cves: [
    {
      cve_id: 'CVE-2021-44224',
      cvss_score: 8.2,
      severity: 'high',
      description:
        'A crafted URI sent to a configured-as-a-forward-proxy Apache HTTP Server 2.4.7 can cause a crash (NULL pointer dereference), or allow requests to be directed to a declared Unix domain socket endpoint.',
      published: '2021-12-20',
      affected_component: 'Apache httpd 2.4.7',
      reference: 'https://nvd.nist.gov/vuln/detail/CVE-2021-44224',
      cwe_id: 'CWE-476',
    },
    {
      cve_id: 'CVE-2025-66200',
      cvss_score: 5.4,
      severity: 'medium',
      description:
        'An issue affecting unsupported Apache HTTP Server 2.4.x releases; upgrade to a currently supported version.',
      published: '2025-11-14',
      affected_component: 'Apache httpd 2.4.7',
      reference: 'https://nvd.nist.gov/vuln/detail/CVE-2025-66200',
      cwe_id: 'CWE-1104',
    },
  ],
  owasp_mapping: [
    { id: 'A05:2021', name: 'Security Misconfiguration', count: 7, severity: 'high' },
    { id: 'A02:2021', name: 'Cryptographic Failures', count: 1, severity: 'high' },
    { id: 'A06:2021', name: 'Vulnerable and Outdated Components', count: 3, severity: 'medium' },
  ],
  risk: {
    score: 50,
    category: 'High',
    penalties: [
      { label: 'No Content-Security-Policy (confirmed by 2 tools)', points: 15 },
      { label: 'Traffic sent unencrypted', points: 15 },
      { label: 'Server version disclosed with a known CVE (confirmed by 4 tools)', points: 10 },
      { label: 'Missing anti-clickjacking protection (confirmed by 2 tools)', points: 5 },
      { label: 'X-Content-Type-Options missing (confirmed by 2 tools)', points: 3 },
      { label: 'Remaining low-severity header gaps', points: 2 },
    ],
  },
  ai: {
    executive_summary:
      'scanme.nmap.org is a deliberately exposed test host published by the Nmap project, so its findings read like a realistic small deployment rather than a hardened one. Fifteen issues were found. Four were seen independently by more than one scanner, and those are the ones worth acting on first: there is no Content-Security-Policy, the site serves everything over unencrypted HTTP, and it advertises an Apache release from 2013 that carries a published high-severity flaw.',
    technical_summary:
      'Header analysis and ZAP passive scanning agreed on four topics (CSP, clickjacking, content-type options, version disclosure), which correlation merged into single findings carrying both observations. Nmap confirmed Apache 2.4.7 on port 80 and OpenSSH 6.6.1p1 on port 22; NVD matched two CVEs against the Apache version. Nuclei completed a full pass with no template matches. TLS inspection was skipped because port 443 is closed, and that is recorded as a coverage gap rather than a pass.',
    key_risks: [
      'No Content-Security-Policy, leaving the page without script controls.',
      'All traffic travels unencrypted; port 443 is closed.',
      'Apache 2.4.7 is disclosed in every response and matches CVE-2021-44224 (8.2).',
    ],
    recommendations: [
      'Add a Content-Security-Policy, deployed in report-only mode first.',
      'Obtain a certificate and serve over HTTPS, then redirect HTTP.',
      'Upgrade Apache and stop advertising the version.',
    ],
    remediation: {
      immediate: [
        'Add a Content-Security-Policy with frame-ancestors and object-src locked down.',
        'Enable HTTPS and redirect all plaintext traffic to it.',
      ],
      short_term: [
        'Upgrade Apache httpd to a supported release.',
        'Set ServerTokens Prod and ServerSignature Off.',
        'Send X-Content-Type-Options: nosniff.',
      ],
      long_term: [
        'Restrict SSH to known addresses and disable password authentication.',
        'Add Referrer-Policy and Permissions-Policy.',
        'Re-scan after each change to confirm the fix.',
      ],
    },
    generated_by: 'deterministic',
    available: false,
  },
  notes: NOTES,
}

export function isSampleId(scanId: string): boolean {
  return scanId === SAMPLE_ID
}
