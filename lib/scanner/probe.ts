/**
 * Real network probes.
 *
 * Every function here performs an actual network operation and reports exactly
 * what it observed. On failure they return a structured "unavailable" result
 * with a reason — they never substitute plausible-looking values.
 */

import dns from 'node:dns'
import net from 'node:net'
import tls from 'node:tls'
import { isPrivateAddress } from '@/lib/scanner/validate'

const USER_AGENT =
  'Mozilla/5.0 (compatible; VulnSight/1.0; +https://vulnsight.local/about) SecurityScanner'

/** Cap the response body we retain so a huge page cannot exhaust memory. */
const MAX_BODY_BYTES = 512 * 1024

export interface DnsResult {
  ok: boolean
  /** Primary address actually returned by the resolver. */
  address: string | null
  family: 4 | 6 | null
  /** Every address the resolver returned, in order. */
  addresses: string[]
  reason: string | null
}

/**
 * Resolve a hostname to its real address.
 *
 * Also acts as an SSRF guard: if a public-looking hostname resolves to a
 * private address, the scan is refused rather than probing internal infra.
 */
export async function resolveHost(hostname: string): Promise<DnsResult> {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  // A literal address needs no resolution, but the SSRF guard still applies.
  if (net.isIP(normalizedHostname)) {
    if (isPrivateAddress(normalizedHostname)) {
      return {
        ok: false,
        address: null,
        family: null,
        addresses: [normalizedHostname],
        reason: `${normalizedHostname} is a private, reserved, or loopback address. VulnSight only scans publicly routable hosts.`,
      }
    }

    return {
      ok: true,
      address: normalizedHostname,
      family: net.isIPv6(normalizedHostname) ? 6 : 4,
      addresses: [normalizedHostname],
      reason: null,
    }
  }

  try {
    const records = await dns.promises.lookup(normalizedHostname, {
      all: true,
      verbatim: true,
    })
    if (!records.length) {
      return {
        ok: false,
        address: null,
        family: null,
        addresses: [],
        reason: `DNS returned no records for ${normalizedHostname}.`,
      }
    }

    const addresses = records.map((r) => r.address)
    const primary = records[0]
    const privateAddress = addresses.find((addr) => isPrivateAddress(addr))

    if (privateAddress) {
      return {
        ok: false,
        address: null,
        family: null,
        addresses,
        reason: `${normalizedHostname} resolves to a private, reserved, or loopback address (${privateAddress}). VulnSight does not scan internal hosts.`,
      }
    }

    return {
      ok: true,
      address: primary.address,
      family: primary.family === 6 ? 6 : 4,
      addresses,
      reason: null,
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const reason =
      code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        ? `Unable to resolve host "${hostname}". Check the domain name and try again.`
        : `DNS lookup for "${hostname}" failed (${code ?? 'unknown error'}).`
    return { ok: false, address: null, family: null, addresses: [], reason }
  }
}

/** Extra DNS record types, collected only in comprehensive scans. */
export interface DnsRecords {
  mx: string[]
  txt: string[]
  ns: string[]
  caa: string[]
}

export async function resolveRecords(hostname: string): Promise<DnsRecords> {
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch {
      return fallback
    }
  }

  const [mx, txt, ns, caa] = await Promise.all([
    safe(() => dns.promises.resolveMx(hostname), []),
    safe(() => dns.promises.resolveTxt(hostname), []),
    safe(() => dns.promises.resolveNs(hostname), []),
    safe(() => dns.promises.resolveCaa(hostname) as Promise<{ issue?: string }[]>, []),
  ])

  return {
    mx: mx.map((r) => r.exchange),
    txt: txt.map((chunks) => chunks.join('')),
    ns,
    caa: caa.map((r) => r.issue ?? '').filter(Boolean),
  }
}

export interface HttpResult {
  ok: boolean
  /** URL after following redirects. */
  finalUrl: string | null
  status: number | null
  /** Lower-cased header names mapped to their real values. */
  headers: Record<string, string>
  /** Raw `set-cookie` values, which can legitimately repeat. */
  setCookie: string[]
  body: string
  /** True when the response advertised an HTML content type. */
  isHtml: boolean
  reason: string | null
  /**
   * The underlying system error code, when the request failed at the network
   * layer (`ECONNREFUSED`, `ERR_TLS_CERT_ALTNAME_INVALID`, ...).
   *
   * `reason` is written for a human and deliberately does not always include
   * the code. Callers that need to *branch* on the failure must read this
   * instead: matching on prose is fragile and silently stops working the
   * moment a message is reworded.
   */
  errorCode: string | null
  /** Wall-clock time for the request, in milliseconds. */
  elapsedMs: number
}

const EMPTY_HTTP: Omit<HttpResult, 'ok' | 'reason' | 'elapsedMs'> = {
  // Defaults to "no network-layer error"; the catch block overrides it.
  errorCode: null,
  finalUrl: null,
  status: null,
  headers: {},
  setCookie: [],
  body: '',
  isHtml: false,
}

/** Follow at most this many redirects during server-side fetches. */
const MAX_REDIRECTS = 5

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400
}

function getHeaderMap(headersList: Headers): Record<string, string> {
  const headers: Record<string, string> = {}
  headersList.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return headers
}

function getSetCookies(headersList: Headers, headers: Record<string, string>): string[] {
  return typeof headersList.getSetCookie === 'function'
    ? headersList.getSetCookie()
    : headers['set-cookie']
      ? [headers['set-cookie']]
      : []
}

type FetchTargetCheck = { ok: true; url: URL } | { ok: false; reason: string }

async function assertPublicHttpTarget(rawUrl: string): Promise<FetchTargetCheck> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: `Invalid URL: ${rawUrl}.` }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: `Refusing to fetch unsupported URL scheme "${parsed.protocol.replace(':', '')}".`,
    }
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '')

  /*
   * Test-only escape hatch.
   *
   * Redirect handling can only be verified honestly against a real HTTP
   * server, and a test server necessarily binds to loopback — which the SSRF
   * guard blocks by design. This opens that one door, and only when the test
   * runner has explicitly set the flag.
   *
   * Guarded twice: the env var must be set AND the process must not be running
   * in production, so it cannot be switched on against a deployed instance.
   */
  const loopbackAllowedForTests =
    process.env.ALLOW_LOOPBACK_FETCH_FOR_TESTS === '1' &&
    process.env.NODE_ENV !== 'production' &&
    (host === '127.0.0.1' || host === '::1' || host === 'localhost')

  if (!loopbackAllowedForTests) {
    const dns = await resolveHost(host)
    if (!dns.ok) {
      return {
        ok: false,
        reason:
          dns.reason ??
          `Refusing to fetch ${parsed.toString()} because the host is not publicly reachable.`,
      }
    }
  }

  return { ok: true, url: parsed }
}

/**
 * Fetch a URL and capture the real response.
 *
 * Redirects are followed manually rather than delegated to `fetch`. That gives
 * us a chance to validate every hop and refuse redirects to localhost/private
 * addresses before the server makes a request there.
 */
export async function fetchSite(url: string, timeoutMs = 15_000): Promise<HttpResult> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  /*
   * Cookies are attributed to the FINAL response only. An intermediate hop
   * (a marketing redirector, a login shim on another host) can set its own
   * cookies, and reporting those as the target's would produce findings about
   * a site the user did not ask us to assess.
   */
  let finalCookies: string[] = []

  try {
    let currentUrl = url

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const target = await assertPublicHttpTarget(currentUrl)
      if (!target.ok) {
        return {
          ok: false,
          ...EMPTY_HTTP,
          reason: target.reason,
          elapsedMs: Date.now() - started,
        }
      }

      const res = await fetch(target.url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
        cache: 'no-store',
      })

      const headers = getHeaderMap(res.headers)
      finalCookies = getSetCookies(res.headers, headers)

      if (isRedirect(res.status)) {
        const location = res.headers.get('location')
        if (!location) {
          return {
            ok: false,
            ...EMPTY_HTTP,
            reason: `HTTP ${res.status} redirect from ${target.url.toString()} did not include a Location header.`,
            elapsedMs: Date.now() - started,
          }
        }

        if (redirectCount === MAX_REDIRECTS) {
          return {
            ok: false,
            ...EMPTY_HTTP,
            reason: `The request to ${url} exceeded ${MAX_REDIRECTS} redirects.`,
            elapsedMs: Date.now() - started,
          }
        }

        try {
          currentUrl = new URL(location, target.url).toString()
        } catch {
          return {
            ok: false,
            ...EMPTY_HTTP,
            reason: `Redirect from ${target.url.toString()} points to an invalid URL.`,
            elapsedMs: Date.now() - started,
          }
        }
        continue
      }

      const contentType = headers['content-type'] ?? ''
      const isHtml = /text\/html|application\/xhtml/i.test(contentType)

      let body = ''
      try {
        const buffer = await res.arrayBuffer()
        const sliced = buffer.byteLength > MAX_BODY_BYTES ? buffer.slice(0, MAX_BODY_BYTES) : buffer
        body = new TextDecoder('utf-8', { fatal: false }).decode(sliced)
      } catch {
        body = ''
      }

      return {
        ok: true,
        finalUrl: target.url.toString(),
        status: res.status,
        headers,
        setCookie: finalCookies,
        body,
        isHtml,
        reason: null,
        errorCode: null,
        elapsedMs: Date.now() - started,
      }
    }

    return {
      ok: false,
      ...EMPTY_HTTP,
      reason: `The request to ${url} exceeded ${MAX_REDIRECTS} redirects.`,
      elapsedMs: Date.now() - started,
    }
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError'
    const cause = (err as { cause?: NodeJS.ErrnoException }).cause
    const code = cause?.code ?? (err as NodeJS.ErrnoException).code
    let reason: string
    if (aborted) {
      reason = `The request to ${url} timed out after ${Math.round(timeoutMs / 1000)}s.`
    } else if (code === 'ECONNREFUSED') {
      reason = `Connection refused by ${url}.`
    } else if (code === 'ECONNRESET') {
      reason = `The connection to ${url} was reset before a response arrived.`
    } else if (code === 'ENOTFOUND') {
      reason = `Unable to resolve the host for ${url}.`
    } else if (code?.startsWith('ERR_TLS') || code === 'EPROTO') {
      reason = `The TLS handshake with ${url} failed (${code}).`
    } else {
      reason = `The request to ${url} failed${code ? ` (${code})` : ''}.`
    }
    return {
      ok: false,
      ...EMPTY_HTTP,
      reason,
      errorCode: aborted ? 'ETIMEDOUT' : (code ?? null),
      elapsedMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
  }
}

export interface TlsResult {
  /** False means "not collected", never "certificate is invalid". */
  available: boolean
  /** Whether the chain validated against the system trust store. */
  authorized: boolean
  authorizationError: string | null
  issuer: string | null
  subject: string | null
  validFrom: string | null
  validTo: string | null
  daysRemaining: number | null
  protocol: string | null
  /** Subject alternative names, used to verify hostname coverage. */
  altNames: string[]
  keyBits: number | null
  reason: string | null
}

/**
 * Read a distinguished-name field from a peer certificate.
 *
 * Node types these as `string | string[]` because a DN may legitimately repeat
 * an attribute (for example two `O=` entries). We keep the first non-empty
 * value rather than rendering `[object Array]` into the report.
 */
export function certField(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    const first = value.find((entry) => entry?.trim())
    return first?.trim() ?? null
  }
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const TLS_UNAVAILABLE: Omit<TlsResult, 'reason'> = {
  available: false,
  authorized: false,
  authorizationError: null,
  issuer: null,
  subject: null,
  validFrom: null,
  validTo: null,
  daysRemaining: null,
  protocol: null,
  altNames: [],
  keyBits: null,
}

/**
 * Inspect the real TLS certificate presented by a host.
 *
 * `rejectUnauthorized: false` lets us *report* on an invalid chain instead of
 * throwing; the true validation outcome is captured in `authorized`.
 */
export function inspectTls(hostname: string, port = 443, timeoutMs = 10_000): Promise<TlsResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: TlsResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: net.isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: false,
        ALPNProtocols: ['h2', 'http/1.1'],
      },
      () => {
        const cert = socket.getPeerCertificate(false)
        if (!cert || Object.keys(cert).length === 0) {
          finish({
            ...TLS_UNAVAILABLE,
            reason: `${hostname} completed a TLS handshake but presented no certificate.`,
          })
          return
        }

        const validTo = cert.valid_to ? new Date(cert.valid_to) : null
        const validFrom = cert.valid_from ? new Date(cert.valid_from) : null
        const daysRemaining =
          validTo && !Number.isNaN(validTo.getTime())
            ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000)
            : null

        const altNames = (cert.subjectaltname ?? '')
          .split(',')
          .map((entry) => entry.trim().replace(/^DNS:/i, ''))
          .filter(Boolean)

        finish({
          available: true,
          authorized: socket.authorized,
          authorizationError: socket.authorized
            ? null
            : (socket.authorizationError?.toString() ?? 'unknown validation error'),
          issuer:
            certField(cert.issuer?.O) ?? certField(cert.issuer?.CN) ?? certField(cert.issuer?.OU),
          subject: certField(cert.subject?.CN),
          validFrom:
            validFrom && !Number.isNaN(validFrom.getTime()) ? validFrom.toISOString() : null,
          validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : null,
          daysRemaining,
          protocol: socket.getProtocol(),
          altNames,
          keyBits: typeof cert.bits === 'number' ? cert.bits : null,
          reason: null,
        })
      },
    )

    socket.setTimeout(timeoutMs, () => {
      finish({
        ...TLS_UNAVAILABLE,
        reason: `TLS connection to ${hostname}:${port} timed out.`,
      })
    })

    socket.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code
      finish({
        ...TLS_UNAVAILABLE,
        reason:
          code === 'ECONNREFUSED'
            ? `${hostname} refused a TLS connection on port ${port}.`
            : `TLS inspection of ${hostname}:${port} failed${code ? ` (${code})` : ''}.`,
      })
    })
  })
}

/**
 * Check whether a TCP port accepts a connection.
 *
 * Used only to confirm ports VulnSight already needs to contact (80 / 443) so
 * the report can state observed reachability without fabricating a port scan.
 */
export function probePort(
  host: string,
  port: number,
  timeoutMs = 4_000,
): Promise<'open' | 'closed' | 'filtered'> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const done = (state: 'open' | 'closed' | 'filtered') => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(state)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done('open'))
    socket.once('timeout', () => done('filtered'))
    socket.once('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code
      done(code === 'ECONNREFUSED' ? 'closed' : 'filtered')
    })
    socket.connect(port, host)
  })
}
