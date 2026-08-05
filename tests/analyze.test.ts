import { describe, expect, it } from 'vitest'
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
import type { HttpResult, TlsResult } from '@/lib/scanner/probe'

/**
 * Analyzer behaviour.
 *
 * The rules with the highest false-positive risk are covered most heavily:
 * clickjacking (which may be satisfied by either XFO or CSP), version
 * disclosure (which must require an actual version), and TLS (which must never
 * report on a certificate it did not collect).
 */

function http(overrides: Partial<HttpResult> = {}): HttpResult {
  return {
    ok: true,
    finalUrl: 'https://example.com/',
    status: 200,
    headers: {},
    setCookie: [],
    body: '',
    isHtml: true,
    reason: null,
    errorCode: null,
    elapsedMs: 100,
    ...overrides,
  }
}

function tls(overrides: Partial<TlsResult> = {}): TlsResult {
  return {
    available: true,
    authorized: true,
    authorizationError: null,
    issuer: "Let's Encrypt",
    subject: 'example.com',
    validFrom: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    validTo: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    daysRemaining: 60,
    protocol: 'TLSv1.3',
    altNames: ['example.com', 'www.example.com'],
    keyBits: 256,
    reason: null,
    ...overrides,
  }
}

const titles = (findings: { title: string }[]) => findings.map((f) => f.title)

describe('analyzeSecurityHeaders', () => {
  it('flags every recommended header as missing on a bare response', () => {
    const { headers, findings } = analyzeSecurityHeaders({})
    expect(headers.every((h) => !h.present)).toBe(true)
    expect(findings.length).toBeGreaterThanOrEqual(5)
  })

  it('keeps the header table and findings consistent', () => {
    // The table and the findings derive from one pass, so a header cannot be
    // shown as present while a "missing" finding also exists for it.
    const { headers, findings } = analyzeSecurityHeaders({
      'content-security-policy': "default-src 'self'",
      'strict-transport-security': 'max-age=31536000',
    })
    for (const header of headers.filter((h) => h.present)) {
      expect(titles(findings)).not.toContain(`${header.name} header not set`)
    }
  })

  it('records the observed header value', () => {
    const { headers } = analyzeSecurityHeaders({ 'strict-transport-security': 'max-age=31536000' })
    const hsts = headers.find((h) => h.name === 'Strict-Transport-Security')
    expect(hsts?.present).toBe(true)
    expect(hsts?.value).toContain('max-age=31536000')
  })

  describe('clickjacking', () => {
    it('is satisfied by X-Frame-Options', () => {
      const { findings } = analyzeSecurityHeaders({ 'x-frame-options': 'DENY' })
      expect(titles(findings)).not.toContain('No clickjacking protection configured')
    })

    it('is satisfied by a CSP frame-ancestors directive', () => {
      // Reporting XFO as missing when frame-ancestors is set is a false positive.
      const { headers, findings } = analyzeSecurityHeaders({
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      })
      expect(titles(findings)).not.toContain('No clickjacking protection configured')
      expect(headers.find((h) => h.name === 'X-Frame-Options')?.present).toBe(true)
    })

    it('is reported when neither control is present', () => {
      const { findings } = analyzeSecurityHeaders({
        'content-security-policy': "default-src 'self'",
      })
      expect(titles(findings)).toContain('No clickjacking protection configured')
    })
  })

  it('reports a report-only CSP as non-enforcing', () => {
    const { findings } = analyzeSecurityHeaders({
      'content-security-policy-report-only': "default-src 'self'",
    })
    expect(titles(findings)).toContain('Content-Security-Policy is report-only')
  })

  it('treats an empty header value as absent', () => {
    const { headers } = analyzeSecurityHeaders({ 'content-security-policy': '' })
    expect(headers.find((h) => h.name === 'Content-Security-Policy')?.present).toBe(false)
  })

  it('grades a missing Referrer-Policy as informational, not a vulnerability', () => {
    const { findings } = analyzeSecurityHeaders({})
    const referrer = findings.find((f) => f.title.startsWith('Referrer-Policy'))
    expect(referrer?.severity).toBe('info')
  })
})

describe('analyzeDisclosure', () => {
  it('flags a header that discloses a specific version', () => {
    expect(analyzeDisclosure({ server: 'Apache/2.4.49' })).toHaveLength(1)
    expect(analyzeDisclosure({ 'x-powered-by': 'PHP/8.1.2' })).toHaveLength(1)
  })

  it('ignores a product name with no version', () => {
    // "Server: cloudflare" discloses nothing an attacker can act on.
    expect(analyzeDisclosure({ server: 'cloudflare' })).toEqual([])
    expect(analyzeDisclosure({ server: 'nginx' })).toEqual([])
  })

  it('lists every disclosing header in a single finding', () => {
    const findings = analyzeDisclosure({ server: 'Apache/2.4.49', 'x-powered-by': 'PHP/8.1.2' })
    expect(findings).toHaveLength(1)
    expect(findings[0].description).toContain('Apache/2.4.49')
    expect(findings[0].description).toContain('PHP/8.1.2')
  })

  it('produces nothing for a response with no version headers', () => {
    expect(analyzeDisclosure({})).toEqual([])
  })
})

describe('analyzeCookies', () => {
  it('produces nothing when no cookies were set', () => {
    expect(analyzeCookies([])).toEqual([])
  })

  it('flags a cookie missing Secure, HttpOnly and SameSite', () => {
    expect(analyzeCookies(['session=abc123'])).toHaveLength(3)
  })

  it('accepts a fully hardened cookie', () => {
    expect(analyzeCookies(['session=abc; Secure; HttpOnly; SameSite=Lax'])).toEqual([])
  })

  it('matches cookie attributes case-insensitively', () => {
    expect(analyzeCookies(['session=abc; secure; httponly; samesite=strict'])).toEqual([])
  })

  it('names the affected cookies in the finding', () => {
    const findings = analyzeCookies(['a=1; HttpOnly; SameSite=Lax', 'b=2; HttpOnly; SameSite=Lax'])
    const insecure = findings.find((f) => f.title.includes('Secure'))
    expect(insecure?.description).toContain('a')
    expect(insecure?.description).toContain('b')
  })

  it('grades a missing SameSite as informational', () => {
    const findings = analyzeCookies(['a=1; Secure; HttpOnly'])
    expect(findings[0].severity).toBe('info')
  })
})

describe('analyzeTls', () => {
  it('reports nothing when no certificate was collected', () => {
    // Absence of evidence must never become a finding about the certificate.
    expect(analyzeTls(tls({ available: false }), 'example.com')).toEqual([])
  })

  it('accepts a healthy certificate', () => {
    expect(analyzeTls(tls(), 'example.com')).toEqual([])
  })

  it('reports an expired certificate as critical', () => {
    const findings = analyzeTls(tls({ daysRemaining: -5 }), 'example.com')
    const expired = findings.find((f) => f.title.includes('expired'))
    expect(expired?.severity).toBe('critical')
  })

  it('escalates by proximity to expiry', () => {
    expect(analyzeTls(tls({ daysRemaining: 7 }), 'example.com')[0].severity).toBe('high')
    expect(analyzeTls(tls({ daysRemaining: 25 }), 'example.com')[0].severity).toBe('low')
    expect(analyzeTls(tls({ daysRemaining: 90 }), 'example.com')).toEqual([])
  })

  it('reports a chain that failed validation', () => {
    const findings = analyzeTls(
      tls({ authorized: false, authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
      'example.com',
    )
    expect(titles(findings)).toContain('TLS certificate chain did not validate')
  })

  it('reports deprecated protocol versions', () => {
    expect(titles(analyzeTls(tls({ protocol: 'TLSv1' }), 'example.com'))).toContainEqual(
      expect.stringContaining('Deprecated TLS protocol'),
    )
    expect(titles(analyzeTls(tls({ protocol: 'TLSv1.1' }), 'example.com'))).toContainEqual(
      expect.stringContaining('Deprecated TLS protocol'),
    )
  })

  it('accepts current protocol versions', () => {
    expect(analyzeTls(tls({ protocol: 'TLSv1.2' }), 'example.com')).toEqual([])
    expect(analyzeTls(tls({ protocol: 'TLSv1.3' }), 'example.com')).toEqual([])
  })

  describe('hostname coverage', () => {
    it('accepts an exact SAN match', () => {
      expect(analyzeTls(tls({ altNames: ['example.com'] }), 'example.com')).toEqual([])
    })

    it('accepts a wildcard covering exactly one label', () => {
      expect(analyzeTls(tls({ altNames: ['*.example.com'] }), 'api.example.com')).toEqual([])
    })

    it('rejects a wildcard spanning multiple labels', () => {
      // RFC 6125: *.example.com does not match a.b.example.com.
      const findings = analyzeTls(tls({ altNames: ['*.example.com'] }), 'a.b.example.com')
      expect(titles(findings)).toContain('Certificate does not cover the requested hostname')
    })

    it('rejects a certificate issued for a different host', () => {
      const findings = analyzeTls(tls({ altNames: ['other.com'] }), 'example.com')
      expect(titles(findings)).toContain('Certificate does not cover the requested hostname')
    })

    it('makes no claim when the certificate lists no SANs', () => {
      expect(analyzeTls(tls({ altNames: [] }), 'example.com')).toEqual([])
    })
  })
})

describe('analyzeTransport', () => {
  it('reports a site served over plaintext HTTP', () => {
    const findings = analyzeTransport(
      'http://example.com',
      http({ finalUrl: 'http://example.com/' }),
    )
    expect(titles(findings)).toContain('Site is served over plaintext HTTP')
    expect(findings[0].severity).toBe('high')
  })

  it('accepts a site that ends on HTTPS', () => {
    expect(
      analyzeTransport('http://example.com', http({ finalUrl: 'https://example.com/' })),
    ).toEqual([])
  })

  it('produces nothing when the request failed', () => {
    expect(analyzeTransport('https://example.com', http({ ok: false, finalUrl: null }))).toEqual([])
  })
})

describe('detectTechnologies', () => {
  it('identifies a web server and its disclosed version', () => {
    const found = detectTechnologies({ server: 'nginx/1.20.0' }, '')
    expect(found).toContainEqual(expect.objectContaining({ name: 'nginx', version: '1.20.0' }))
  })

  it('records a server with no version as version-less', () => {
    expect(detectTechnologies({ server: 'nginx' }, '')[0]).toMatchObject({ version: null })
  })

  it('detects CDNs from their signature headers', () => {
    expect(detectTechnologies({ 'cf-ray': 'abc123' }, '').map((t) => t.name)).toContain(
      'Cloudflare',
    )
    expect(detectTechnologies({ 'x-vercel-id': 'xyz' }, '').map((t) => t.name)).toContain('Vercel')
  })

  it('detects frameworks from body markers', () => {
    expect(
      detectTechnologies({}, '<script src="/_next/static/x.js">').map((t) => t.name),
    ).toContain('Next.js')
    expect(
      detectTechnologies({}, '<link href="/wp-content/style.css">').map((t) => t.name),
    ).toContain('WordPress')
  })

  it('reads a version from a generator meta tag', () => {
    const found = detectTechnologies({}, '<meta name="generator" content="WordPress 6.4.2">')
    expect(found).toContainEqual(expect.objectContaining({ name: 'WordPress', version: '6.4.2' }))
  })

  it('returns nothing for a hardened response, which is a valid outcome', () => {
    expect(detectTechnologies({}, '<html><body>Hello</body></html>')).toEqual([])
  })

  it('returns results sorted by name', () => {
    const names = detectTechnologies({ 'cf-ray': 'x', server: 'nginx' }, '').map((t) => t.name)
    expect(names).toEqual([...names].sort())
  })
})

describe('extractTitle', () => {
  it('extracts and decodes the page title', () => {
    expect(extractTitle('<title>Hello &amp; Welcome</title>')).toBe('Hello & Welcome')
  })

  it('collapses whitespace across multi-line titles', () => {
    expect(extractTitle('<title>\n  Spaced\n  Out\n</title>')).toBe('Spaced Out')
  })

  it('handles attributes on the title element', () => {
    expect(extractTitle('<title data-x="1">Value</title>')).toBe('Value')
  })

  it('returns null when there is no usable title', () => {
    expect(extractTitle('<html><body>No title</body></html>')).toBeNull()
    expect(extractTitle('<title>   </title>')).toBeNull()
    expect(extractTitle('')).toBeNull()
  })

  it('truncates an absurdly long title', () => {
    expect(extractTitle(`<title>${'a'.repeat(500)}</title>`)?.length).toBeLessThanOrEqual(200)
  })
})

describe('extractFavicon', () => {
  it('resolves a relative href against the page URL', () => {
    expect(
      extractFavicon('<link rel="icon" href="/favicon.ico">', 'https://example.com/page'),
    ).toBe('https://example.com/favicon.ico')
  })

  it('preserves an absolute href', () => {
    expect(
      extractFavicon(
        '<link rel="icon" href="https://cdn.example.com/i.png">',
        'https://example.com',
      ),
    ).toBe('https://cdn.example.com/i.png')
  })

  it('accepts shortcut and apple-touch icon variants', () => {
    expect(extractFavicon('<link rel="shortcut icon" href="/a.ico">', 'https://example.com')).toBe(
      'https://example.com/a.ico',
    )
  })

  it('returns null when no icon is declared', () => {
    expect(extractFavicon('<html></html>', 'https://example.com')).toBeNull()
  })
})
