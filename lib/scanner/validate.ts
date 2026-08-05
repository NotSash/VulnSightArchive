/**
 * Target validation.
 *
 * VulnSight refuses to scan anything it cannot legitimately and safely assess.
 * Rejecting early — with a specific, user-facing reason — is always preferable
 * to producing a report about a target that was never really reachable.
 */

/** A validated, safe-to-scan target. */
export interface ValidTarget {
  ok: true
  /** Absolute URL with an explicit scheme. */
  url: string
  /** ASCII (punycode) hostname. */
  hostname: string
  /** True when the hostname is a literal IP rather than a domain name. */
  isIpLiteral: boolean
  /**
   * True when the user typed a bare hostname and we supplied `https://`
   * ourselves.
   *
   * This matters because the assumption can be wrong: plenty of real hosts
   * serve HTTP only. When we guessed, the scanner is allowed to fall back to
   * `http://` if HTTPS refuses the connection. When the user explicitly typed
   * a scheme, their choice is honoured and a failure is reported as a failure.
   */
  schemeAssumed: boolean
}

export interface InvalidTarget {
  ok: false
  /** Stable machine code, useful for tests and logging. */
  code: string
  /** Plain-language message shown directly to the user. */
  message: string
}

export type TargetValidation = ValidTarget | InvalidTarget

function reject(code: string, message: string): InvalidTarget {
  return { ok: false, code, message }
}

/**
 * Emoji and pictographic characters. These form technically-valid IDN domains
 * but effectively never resolve, so we reject them with a clear explanation
 * rather than letting the user wait for a DNS timeout.
 */
const PICTOGRAPHIC = /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]|\u{FE0F})/u

/** Hostnames that always refer to the machine running the scanner. */
const LOOPBACK_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
])

/**
 * Reserved / internal-only suffixes (RFC 6761 and common intranet conventions).
 * Scanning these would either fail or probe the user's own network.
 */
const INTERNAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.test',
  '.invalid',
]

/**
 * True for IPv4 literals in a private, loopback, or link-local range.
 *
 * **Unparseable input returns `true`, not `false`.** This is a guard: the
 * caller asks "must I refuse this?", so the safe answer to "I do not
 * understand this address" is yes. The previous default of `false` meant
 * "public", which is the least safe answer a security control can give, and
 * was only harmless because every caller happened to validate the shape
 * first.
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true
  }
  const [a, b, c] = parts
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // loopback
  if (a === 0) return true // "this network"
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 protocol assignments
  if (a === 192 && b === 0 && c === 2) return true // TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast + reserved
  return false
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups.
 *
 * Returns `null` when the input is not a parseable address, which callers must
 * treat as "refuse", never as "public".
 */
function hextets(ip: string): number[] | null {
  let v = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (v.includes('%')) v = v.slice(0, v.indexOf('%')) // strip zone id

  /*
   * A trailing dotted quad (`::ffff:127.0.0.1`) is the same address as two
   * hextets, so convert it before splitting. Without this the two spellings
   * parse differently, which is precisely the bug this function replaces.
   */
  const dotted = v.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted) {
    const octets = dotted[2].split('.').map(Number)
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    v = `${dotted[1]}${hi}:${lo}`
  }

  const halves = v.split('::')
  if (halves.length > 2) return null

  const parse = (part: string) =>
    part === ''
      ? []
      : part.split(':').map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : Number.NaN))

  const head = parse(halves[0] ?? '')
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : []
  if ([...head, ...tail].some((n) => Number.isNaN(n))) return null

  if (halves.length === 2) {
    const gap = 8 - head.length - tail.length
    if (gap < 0) return null
    return [...head, ...Array<number>(gap).fill(0), ...tail]
  }
  return head.length === 8 ? head : null
}

/**
 * True for IPv6 literals that must never be scanned.
 *
 * **Compares numbers, not strings.** The previous version pattern-matched the
 * dotted spelling of an IPv4-mapped address, but the WHATWG URL parser
 * rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]` before validation ever
 * runs, so the regex never matched and loopback was treated as public. Both
 * SSRF gates shared that function, so both failed together. See AUDIT A1.
 */
export function isPrivateIpv6(ip: string): boolean {
  const h = hextets(ip)
  if (h === null) return true // unparseable: refuse, never assume public

  const [h0, h1] = h

  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96: defer to IPv4 rules.
  const isMapped = h.slice(0, 5).every((x) => x === 0) && h1 !== undefined
  if (isMapped && (h[5] === 0xffff || h[5] === 0)) {
    const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`
    return isPrivateIpv4(v4)
  }

  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48 embed an IPv4 address too.
  if (h0 === 0x64 && h1 === 0xff9b) {
    const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`
    return isPrivateIpv4(v4)
  }

  if (h.every((x) => x === 0)) return true // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true // ::1
  if ((h0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((h0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((h0 & 0xff00) === 0xff00) return true // ff00::/8 multicast
  if (h0 === 0x2001 && h1 === 0x0db8) return true // 2001:db8::/32 documentation
  if (h0 === 0x2002) return true // 6to4, can encapsulate anything
  if (h0 === 0x0100 && h1 === 0x0000) return true // 100::/64 discard-only

  return false
}

/** True when an address literal must never be scanned. */
export function isPrivateAddress(ip: string): boolean {
  return ip.includes(':') ? isPrivateIpv6(ip) : isPrivateIpv4(ip)
}

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * Validate and normalize raw user input into a scannable target.
 *
 * Accepts bare hostnames ("example.com") by assuming HTTPS, which is what
 * users expect from a URL field.
 */
export function validateTarget(raw: string): TargetValidation {
  const trimmed = (raw ?? '').trim()

  if (!trimmed) {
    return reject('empty', 'Enter a website URL to scan.')
  }

  if (trimmed.length > 2000) {
    return reject('too_long', 'That URL is too long to be valid.')
  }

  if (/\s/.test(trimmed)) {
    return reject('whitespace', 'URLs cannot contain spaces. Check the address and try again.')
  }

  if (PICTOGRAPHIC.test(trimmed)) {
    return reject(
      'emoji',
      'Emoji domains are not supported. Enter a standard domain name such as example.com.',
    )
  }

  // Reject unsupported schemes explicitly so the user understands why.
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') {
      return reject(
        'scheme',
        `Unsupported URL scheme "${scheme}". VulnSight only scans http:// and https:// targets.`,
      )
    }
  }

  const hasExplicitScheme = /^https?:\/\//i.test(trimmed)

  let parsed: URL
  try {
    parsed = new URL(hasExplicitScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return reject('malformed', 'That does not look like a valid URL.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return reject('scheme', 'VulnSight only scans http:// and https:// targets.')
  }

  // Credentials in the URL are a strong signal of a malformed or pasted value.
  if (parsed.username || parsed.password) {
    return reject('credentials', 'Remove the username and password from the URL before scanning.')
  }

  const hostname = parsed.hostname.toLowerCase()

  if (!hostname) {
    return reject('no_host', 'That URL is missing a hostname.')
  }

  // WHATWG URL already converted any IDN to punycode; anything left outside
  // this character set is not a usable hostname.
  if (!/^[a-z0-9.\-[\]:]+$/.test(hostname)) {
    return reject('invalid_host', `"${hostname}" is not a valid hostname.`)
  }

  if (LOOPBACK_NAMES.has(hostname)) {
    return reject(
      'loopback',
      'Localhost cannot be scanned. VulnSight assesses publicly reachable websites.',
    )
  }

  if (INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return reject(
      'internal',
      `"${hostname}" is a private or reserved hostname and cannot be scanned from the internet.`,
    )
  }

  const isIpv6Literal = hostname.startsWith('[') || hostname.includes(':')
  const isIpv4Literal = IPV4_LITERAL.test(hostname)
  const isIpLiteral = isIpv4Literal || isIpv6Literal

  if (isIpLiteral) {
    const bare = hostname.replace(/^\[|\]$/g, '')
    if (isPrivateAddress(bare)) {
      return reject(
        'private_ip',
        `${bare} is a private or loopback address. VulnSight only scans publicly routable hosts.`,
      )
    }
    if (isIpv4Literal && hostname.split('.').some((o) => Number(o) > 255)) {
      return reject('invalid_ip', `${hostname} is not a valid IP address.`)
    }
  } else {
    // Domain names need at least one dot and a plausible alphabetic TLD.
    if (!hostname.includes('.')) {
      return reject('no_tld', `"${hostname}" is missing a domain suffix. Try example.com instead.`)
    }
    if (hostname.startsWith('.') || hostname.endsWith('.') || hostname.includes('..')) {
      return reject('malformed_host', `"${hostname}" is not a valid domain name.`)
    }
    const tld = hostname.slice(hostname.lastIndexOf('.') + 1)
    if (!/^[a-z]{2,}$/.test(tld) && !tld.startsWith('xn--')) {
      return reject('invalid_tld', `".${tld}" is not a valid domain suffix.`)
    }
    if (hostname.split('.').some((label) => label.length > 63)) {
      return reject('label_too_long', 'One of the domain labels is too long to be valid.')
    }
  }

  // Normalize: drop the fragment, keep path and query as given.
  parsed.hash = ''

  return {
    ok: true,
    url: parsed.toString(),
    hostname: hostname.replace(/^\[|\]$/g, ''),
    isIpLiteral,
    schemeAssumed: !hasExplicitScheme,
  }
}
