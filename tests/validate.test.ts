import { describe, expect, it, vi } from 'vitest'
import {
  isPrivateAddress,
  isPrivateIpv4,
  isPrivateIpv6,
  validateTarget,
} from '@/lib/scanner/validate'

/**
 * Target validation is the primary SSRF boundary.
 *
 * These tests exist because a regression here would let VulnSight be used to
 * scan internal infrastructure from the server's own network position. Every
 * reserved range is asserted explicitly so that a future refactor of the range
 * checks cannot silently narrow them.
 */

/** Narrow a validation result to the success branch, failing loudly otherwise. */
function expectValid(raw: string) {
  const result = validateTarget(raw)
  if (!result.ok) {
    throw new Error(`expected "${raw}" to be accepted, got ${result.code}: ${result.message}`)
  }
  return result
}

/** Assert rejection and return the machine-readable code. */
function expectRejected(raw: string): string {
  const result = validateTarget(raw)
  if (result.ok) {
    throw new Error(`expected "${raw}" to be rejected, but it was accepted as ${result.url}`)
  }
  return result.code
}

describe('isPrivateIpv4', () => {
  const PRIVATE: [string, string][] = [
    ['10.0.0.1', 'RFC1918 10/8'],
    ['10.255.255.255', 'RFC1918 10/8 upper bound'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback upper bound'],
    ['0.0.0.0', '"this network"'],
    ['169.254.169.254', 'link-local / cloud metadata'],
    ['172.16.0.1', 'RFC1918 172.16/12 lower bound'],
    ['172.31.255.255', 'RFC1918 172.16/12 upper bound'],
    ['192.168.1.1', 'RFC1918 192.168/16'],
    ['100.64.0.1', 'CGNAT 100.64/10 lower bound'],
    ['100.127.255.255', 'CGNAT 100.64/10 upper bound'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.2.5', 'TEST-NET-1'],
    ['198.51.100.5', 'TEST-NET-2'],
    ['203.0.113.5', 'TEST-NET-3'],
    ['198.18.0.1', 'benchmarking 198.18/15'],
    ['198.19.255.255', 'benchmarking upper bound'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast upper bound'],
    ['255.255.255.255', 'broadcast / reserved'],
  ]

  for (const [ip, label] of PRIVATE) {
    it(`blocks ${ip} (${label})`, () => {
      expect(isPrivateIpv4(ip)).toBe(true)
    })
  }

  const PUBLIC = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '223.255.255.255',
  ]

  for (const ip of PUBLIC) {
    it(`allows public address ${ip}`, () => {
      expect(isPrivateIpv4(ip)).toBe(false)
    })
  }

  it('treats boundary addresses just outside reserved ranges as public', () => {
    // These sit one address outside a reserved block. Getting these wrong is
    // the classic off-by-one in hand-rolled range checks.
    expect(isPrivateIpv4('11.0.0.0')).toBe(false)
    expect(isPrivateIpv4('126.255.255.255')).toBe(false)
    expect(isPrivateIpv4('169.253.255.255')).toBe(false)
    expect(isPrivateIpv4('192.167.255.255')).toBe(false)
  })

  it('treats malformed IPv4 input as unsafe, not as public', () => {
    /*
     * Changed deliberately in Phase 0.5 (AUDIT A3). This is a guard: the
     * caller is asking "must I refuse this?", so the only safe answer to "I
     * cannot parse this" is yes. Returning false meant "publicly routable",
     * which is the worst possible default for a security control, and it was
     * harmless only because every caller happened to check the shape first.
     */
    expect(isPrivateIpv4('not-an-ip')).toBe(true)
    expect(isPrivateIpv4('1.2.3')).toBe(true)
    expect(isPrivateIpv4('1.2.3.4.5')).toBe(true)
    expect(isPrivateIpv4('999.1.1.1')).toBe(true)
  })
})

describe('isPrivateIpv6', () => {
  const PRIVATE: [string, string][] = [
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['FE80::1', 'link-local, uppercase'],
    ['ff02::1', 'multicast'],
    ['fc00::1', 'unique-local fc00::/7'],
    ['fd12:3456::1', 'unique-local fd00::/8'],
    ['2001:db8::1', 'documentation prefix'],
    ['[::1]', 'bracketed loopback'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
  ]

  for (const [ip, label] of PRIVATE) {
    it(`blocks ${ip} (${label})`, () => {
      expect(isPrivateIpv6(ip)).toBe(true)
    })
  }

  it('allows public IPv6 addresses', () => {
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateIpv6('2001:4860:4860::8888')).toBe(false)
  })

  it('defers IPv4-mapped public addresses to the IPv4 rules', () => {
    expect(isPrivateIpv6('::ffff:8.8.8.8')).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('dispatches on the presence of a colon', () => {
    expect(isPrivateAddress('192.168.0.1')).toBe(true)
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('2606:4700::1111')).toBe(false)
  })
})

describe('validateTarget — accepted input', () => {
  it('assumes HTTPS for a bare hostname', () => {
    const result = expectValid('example.com')
    expect(result.url).toBe('https://example.com/')
    expect(result.hostname).toBe('example.com')
    expect(result.isIpLiteral).toBe(false)
  })

  it('preserves an explicit http scheme rather than silently upgrading', () => {
    // Downgrade detection is a real finding, so we must not rewrite the scheme.
    expect(expectValid('http://example.com').url).toBe('http://example.com/')
  })

  it('keeps path and query but drops the fragment', () => {
    const result = expectValid('https://example.com/app?a=1#section')
    expect(result.url).toBe('https://example.com/app?a=1')
  })

  it('lowercases the hostname', () => {
    expect(expectValid('https://EXAMPLE.COM').hostname).toBe('example.com')
  })

  it('converts internationalised domains to punycode', () => {
    expect(expectValid('https://bücher.de').hostname).toBe('xn--bcher-kva.de')
  })

  it('accepts an explicit punycode hostname', () => {
    expect(expectValid('xn--bcher-kva.de').hostname).toBe('xn--bcher-kva.de')
  })

  it('accepts a public IPv4 literal and flags it as such', () => {
    const result = expectValid('https://8.8.8.8')
    expect(result.isIpLiteral).toBe(true)
    expect(result.hostname).toBe('8.8.8.8')
  })

  it('accepts a public IPv6 literal and strips the brackets', () => {
    const result = expectValid('https://[2606:4700:4700::1111]')
    expect(result.isIpLiteral).toBe(true)
    expect(result.hostname).toBe('2606:4700:4700::1111')
  })

  it('accepts subdomains, hyphens and non-standard ports', () => {
    expect(expectValid('https://api-v2.staging.example.co.uk:8443').hostname).toBe(
      'api-v2.staging.example.co.uk',
    )
  })

  it('trims surrounding whitespace', () => {
    expect(expectValid('  example.com  ').hostname).toBe('example.com')
  })
})

describe('validateTarget — SSRF and reserved targets', () => {
  const BLOCKED: [string, string][] = [
    ['localhost', 'loopback'],
    ['http://localhost:3000', 'loopback'],
    ['LOCALHOST', 'loopback'],
    ['localhost.localdomain', 'loopback'],
    ['ip6-localhost', 'loopback'],
    ['ip6-loopback', 'loopback'],
    ['myapp.localhost', 'internal'],
    ['printer.local', 'internal'],
    ['vault.internal', 'internal'],
    ['wiki.intranet', 'internal'],
    ['nas.lan', 'internal'],
    ['router.home', 'internal'],
    ['portal.corp', 'internal'],
    ['staging.test', 'internal'],
    ['nothing.invalid', 'internal'],
    ['http://127.0.0.1', 'private_ip'],
    ['http://10.0.0.5', 'private_ip'],
    ['http://192.168.1.1', 'private_ip'],
    ['http://172.16.5.4', 'private_ip'],
    ['http://169.254.169.254', 'private_ip'],
    ['http://100.64.0.1', 'private_ip'],
    ['http://0.0.0.0', 'private_ip'],
    ['http://[::1]', 'private_ip'],
    ['http://[fe80::1]', 'private_ip'],
    ['http://[fc00::1]', 'private_ip'],
  ]

  for (const [input, code] of BLOCKED) {
    it(`rejects ${input} with code "${code}"`, () => {
      expect(expectRejected(input)).toBe(code)
    })
  }

  it('blocks the AWS metadata endpoint, which is the highest-value SSRF target', () => {
    expect(expectRejected('http://169.254.169.254/latest/meta-data/')).toBe('private_ip')
  })
})

describe('validateTarget — malformed input', () => {
  const CASES: [string, string][] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['exa mple.com', 'whitespace'],
    ['🔒.com', 'emoji'],
    ['example.com/🎉', 'emoji'],
    ['file:///etc/passwd', 'scheme'],
    ['ftp://example.com', 'scheme'],
    ['gopher://example.com', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,<h1>x', 'scheme'],
    ['https://user:pass@example.com', 'credentials'],
    ['localhost-only-label', 'no_tld'],
    ['example.', 'malformed_host'],
    ['example..com', 'malformed_host'],
    ['example.c', 'invalid_tld'],
  ]

  for (const [input, code] of CASES) {
    it(`rejects ${JSON.stringify(input)} with code "${code}"`, () => {
      expect(expectRejected(input)).toBe(code)
    })
  }

  it('rejects an all-numeric TLD', () => {
    // WHATWG URL refuses to parse a fully numeric final label, so this is
    // caught as "malformed" before the TLD rule is reached. Either code is an
    // acceptable outcome; what matters is that it never reaches the scanner.
    expect(['malformed', 'invalid_tld']).toContain(expectRejected('example.123'))
  })

  it('rejects a URL longer than the accepted maximum', () => {
    expect(expectRejected(`https://example.com/${'a'.repeat(2100)}`)).toBe('too_long')
  })

  it('rejects a domain label longer than 63 characters', () => {
    expect(expectRejected(`${'a'.repeat(64)}.com`)).toBe('label_too_long')
  })

  it('rejects an IPv4 literal with an out-of-range octet', () => {
    // 999 is not a valid octet; WHATWG URL treats this as a domain name, so the
    // TLD rule catches it. Either way it must never reach the scanner.
    expect(['invalid_ip', 'invalid_tld', 'malformed']).toContain(expectRejected('http://1.2.3.999'))
  })

  it('always returns a user-facing message alongside the code', () => {
    const result = validateTarget('localhost')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(10)
      expect(result.message).toMatch(/[.!]$/)
    }
  })
})

describe('loopback test escape hatch cannot weaken production', () => {
  it('is inert when NODE_ENV is production', async () => {
    // The hatch in probe.ts requires NODE_ENV !== 'production'. Verified
    // directly so a refactor cannot quietly drop that condition.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_LOOPBACK_FETCH_FOR_TESTS', '1')
    try {
      const { fetchSite } = await import('@/lib/scanner/probe')
      const result = await fetchSite('http://127.0.0.1:1/', 2000)
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/private|loopback|reserved/i)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('still rejects loopback when the flag is unset', async () => {
    vi.stubEnv('ALLOW_LOOPBACK_FETCH_FOR_TESTS', '')
    try {
      const { fetchSite } = await import('@/lib/scanner/probe')
      const result = await fetchSite('http://127.0.0.1:1/', 2000)
      expect(result.ok).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

/**
 * Scheme assumption.
 *
 * A bare hostname is normalised to `https://`, which is the right default but
 * is still a guess. The flag below is what lets the scanner recover when the
 * guess is wrong, so it must be set precisely: too eager and we would override
 * a user who deliberately asked for HTTPS.
 */
describe('schemeAssumed', () => {
  it('is set when the user typed a bare hostname', () => {
    const result = validateTarget('scanme.nmap.org')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.schemeAssumed).toBe(true)
      expect(result.url).toBe('https://scanme.nmap.org/')
    }
  })

  it('is not set when the user typed https:// explicitly', () => {
    // Their stated intent must win: a TLS failure is then a real failure.
    const result = validateTarget('https://example.com')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.schemeAssumed).toBe(false)
  })

  it('is not set when the user typed http:// explicitly', () => {
    const result = validateTarget('http://example.com')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.schemeAssumed).toBe(false)
  })

  it('is set for a bare hostname carrying a path', () => {
    const result = validateTarget('example.com/login?next=/admin')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.schemeAssumed).toBe(true)
  })

  it('treats a scheme typed in mixed case as explicit', () => {
    const result = validateTarget('HTTPS://example.com')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.schemeAssumed).toBe(false)
  })
})
