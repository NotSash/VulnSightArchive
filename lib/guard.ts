/**
 * Abuse controls for the public scan endpoint.
 *
 * VulnSight points real security tooling at whatever host a visitor types.
 * Left open, that is a free attack proxy: someone can point it at a target
 * they do not own, run it in a loop, or use it to fingerprint infrastructure
 * anonymously. Every request that reaches the pipeline consumes minutes of
 * CPU on a two-core box, so an unthrottled endpoint is also trivially easy to
 * knock over.
 *
 * This module is the gate in front of that. Each control is independent and
 * fails closed:
 *
 * 1. **Blocklist** — hosts that must never be scanned, whatever the requester
 *    claims. Government, military, and major cloud/CDN control planes.
 * 2. **Authorisation** — the requester must affirm they are permitted to scan
 *    the target. This is a legal necessity, not a formality.
 * 3. **Access code** — optional shared secret, for keeping the deployment
 *    private during a soft launch.
 * 4. **Rate limit** — per-client cap over a rolling window.
 * 5. **Concurrency cap** — a hard ceiling on simultaneous scans, because the
 *    host has finite CPU and each scan spawns external processes.
 *
 * State is in-memory and per-process. That is the honest scope of the current
 * single-container deployment; when the app is scaled horizontally this must
 * move to shared storage (Redis or Postgres), and the limits below become
 * per-instance rather than global.
 */

import { logger } from '@/lib/logger'

/* --------------------------------------------------------------- blocklist */

/**
 * Hosts VulnSight refuses to scan under any circumstances.
 *
 * Two categories, for two different reasons:
 *
 * - **Government and military.** Unauthorised scanning of these is prosecuted
 *   aggressively in most jurisdictions, and no checkbox from an anonymous
 *   visitor is a credible authorisation.
 * - **Cloud and CDN control planes.** Scanning `amazonaws.com` or a metadata
 *   endpoint is either meaningless or an attempt to reach infrastructure the
 *   requester does not own. Note this blocks the *provider's* own domains, not
 *   customer sites that happen to be hosted on them.
 */
const BLOCKED_SUFFIXES = [
  // Government and military.
  '.gov',
  '.mil',
  '.gov.uk',
  '.gov.in',
  '.gov.au',
  '.gc.ca',
  '.gouv.fr',
  '.europa.eu',
  '.nic.in',
  // Cloud provider control planes and metadata services.
  'amazonaws.com',
  'azure.com',
  'windows.net',
  'googleapis.com',
  'cloudfunctions.net',
  'oraclecloud.com',
  'digitaloceanspaces.com',
  'metadata.google.internal',
  // CDN and infrastructure operators — scanning these tests the CDN, not a site.
  'cloudflare.com',
  'akamai.net',
  'akamaiedge.net',
  'fastly.net',
]

/**
 * Exact hostnames that are blocked outright.
 *
 * These are either infrastructure that would be harmed by scan traffic, or
 * targets where a scan produces nothing but noise.
 */
const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'instance-data',
  // Public resolvers: scanning them is pointless and looks like an attack.
  'dns.google',
  'one.one.one.one',
  'resolver1.opendns.com',
])

/**
 * Decide whether a hostname is permanently off limits.
 *
 * Suffix matching is anchored on a dot boundary so that `notgov.com` is not
 * caught by the `.gov` rule while `agency.gov` is.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host) return false
  if (BLOCKED_HOSTS.has(host)) return true

  return BLOCKED_SUFFIXES.some((suffix) => {
    if (suffix.startsWith('.')) return host === suffix.slice(1) || host.endsWith(suffix)
    return host === suffix || host.endsWith(`.${suffix}`)
  })
}

/* ------------------------------------------------------------ rate limiting */

/** Rolling-window limits, overridable per deployment. */
export interface GuardLimits {
  /** Scans one client may start within the window. */
  perClient: number
  /** Length of the rolling window, in milliseconds. */
  windowMs: number
  /** Scans that may run at the same time across the whole process. */
  maxConcurrent: number
}

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (Number.isFinite(parsed) && parsed >= min && parsed <= max) return parsed
  return fallback
}

/**
 * Effective limits for this process.
 *
 * The defaults assume the Oracle Always Free box: two cores, and a
 * comprehensive scan that occupies one of them for several minutes. Three
 * concurrent scans is already optimistic; the cap exists so the fourth
 * requester gets a clear "try again shortly" instead of a timeout.
 */
export function guardLimits(env: NodeJS.ProcessEnv = process.env): GuardLimits {
  return {
    perClient: readInt(env.RATE_LIMIT_PER_CLIENT, 5, 1, 1000),
    windowMs: readInt(env.RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
    maxConcurrent: readInt(env.MAX_CONCURRENT_SCANS, 3, 1, 64),
  }
}

interface ClientRecord {
  /** Timestamps of scans started, oldest first. */
  hits: number[]
}

const globalForGuard = globalThis as unknown as {
  __vulnsightGuard?: { clients: Map<string, ClientRecord>; active: Set<string> }
}

const state = globalForGuard.__vulnsightGuard ?? {
  clients: new Map<string, ClientRecord>(),
  active: new Set<string>(),
}
if (!globalForGuard.__vulnsightGuard) globalForGuard.__vulnsightGuard = state

/**
 * Identify the requesting client.
 *
 * Behind Caddy the real address arrives in `X-Forwarded-For`; the leftmost
 * entry is the original client. This is spoofable in principle, but the proxy
 * rewrites the header, so in the deployed topology it is trustworthy. Falling
 * back to a shared bucket is deliberate: if we cannot identify the caller, the
 * safe behaviour is to throttle them together rather than let them through.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Drop expired hits so the map cannot grow without bound. */
function prune(record: ClientRecord, cutoff: number): void {
  while (record.hits.length && record.hits[0] < cutoff) record.hits.shift()
}

export interface RateDecision {
  allowed: boolean
  /** Scans still available in the current window. */
  remaining: number
  /** Seconds until the oldest hit expires, when the limit is reached. */
  retryAfterSeconds: number
}

/**
 * Check the rate limit *without* recording a hit.
 *
 * Separated from `recordScan` so a request rejected later in validation does
 * not consume the caller's quota — being told "that URL is malformed" should
 * not cost you a scan.
 */
export function checkRateLimit(
  key: string,
  limits: GuardLimits = guardLimits(),
  now = Date.now(),
): RateDecision {
  const cutoff = now - limits.windowMs
  const record = state.clients.get(key)
  if (!record) return { allowed: true, remaining: limits.perClient, retryAfterSeconds: 0 }

  prune(record, cutoff)
  if (record.hits.length === 0) {
    state.clients.delete(key)
    return { allowed: true, remaining: limits.perClient, retryAfterSeconds: 0 }
  }

  const remaining = Math.max(0, limits.perClient - record.hits.length)
  if (remaining > 0) return { allowed: true, remaining, retryAfterSeconds: 0 }

  const oldest = record.hits[0]
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + limits.windowMs - now) / 1000)),
  }
}

/**
 * Atomically reserve a rate-limit slot: check and record in one step.
 *
 * `checkRateLimit` followed later by `recordScan` is a check-then-act race.
 * The scan route awaited DNS between the two, so every request that arrived
 * during that window read the counter before any of them had incremented and
 * they all passed: 20 concurrent requests started 20 scans against a limit of
 * 5. Node is single-threaded, so doing both here, with no `await` in between,
 * closes the window completely. See AUDIT D1.
 *
 * Call `releaseRateSlot` if the request subsequently fails, so a caller is
 * still never charged for a scan that did not start.
 */
export function reserveRateSlot(
  key: string,
  limits: GuardLimits = guardLimits(),
  now = Date.now(),
): RateDecision {
  const decision = checkRateLimit(key, limits, now)
  if (decision.allowed) recordScan(key, now)
  return decision
}

/** Undo a reservation made by `reserveRateSlot`. */
export function releaseRateSlot(key: string, now = Date.now()): void {
  const record = state.clients.get(key)
  if (!record) return
  const index = record.hits.lastIndexOf(now)
  if (index >= 0) record.hits.splice(index, 1)
  else record.hits.pop()
  if (record.hits.length === 0) state.clients.delete(key)
}

/** Record that a client actually started a scan. Call only on success. */
export function recordScan(key: string, now = Date.now()): void {
  const record = state.clients.get(key) ?? { hits: [] }
  record.hits.push(now)
  state.clients.set(key, record)

  // Opportunistic sweep: keeps the map proportional to *recent* traffic.
  if (state.clients.size > 5000) {
    const cutoff = now - guardLimits().windowMs
    for (const [id, entry] of state.clients) {
      prune(entry, cutoff)
      if (entry.hits.length === 0) state.clients.delete(id)
    }
  }
}

/* --------------------------------------------------------------- concurrency */

/** Number of scans currently running in this process. */
export function activeScanCount(): number {
  return state.active.size
}

export function beginScan(scanId: string): void {
  state.active.add(scanId)
}

/**
 * Claim a concurrency slot atomically, returning false when the cap is full.
 *
 * Same race as the rate limit: `activeScanCount()` was read, DNS was awaited,
 * and only then was the slot taken. Reserving under a placeholder id at
 * decision time means concurrent callers see each other. The placeholder is
 * swapped for the real scan id once it exists. See AUDIT D1.
 */
export function tryClaimScanSlot(token: string, limits: GuardLimits = guardLimits()): boolean {
  if (state.active.size >= limits.maxConcurrent) return false
  state.active.add(token)
  return true
}

/** Swap a placeholder reservation for the real scan id. */
export function adoptScanSlot(token: string, scanId: string): void {
  state.active.delete(token)
  state.active.add(scanId)
}

export function endScan(scanId: string): void {
  state.active.delete(scanId)
}

/** For tests: forget all rate-limit and concurrency state. */
export function resetGuardState(): void {
  state.clients.clear()
  state.active.clear()
}

/* ------------------------------------------------------------- access code */

/**
 * Whether the deployment requires a shared access code.
 *
 * Unset means the instance is fully public, which is the intended end state.
 * Setting `ACCESS_CODE` gates it during a soft launch without building auth.
 */
export function accessCodeRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ACCESS_CODE?.trim())
}

/**
 * Constant-time comparison of the supplied code against the configured one.
 *
 * A naive `===` leaks the length and the position of the first mismatch
 * through timing. The cost of doing this properly is negligible.
 */
export function accessCodeValid(supplied: string | undefined, env = process.env): boolean {
  const expected = env.ACCESS_CODE?.trim()
  if (!expected) return true
  const given = (supplied ?? '').trim()

  // Compare over a fixed length so a short guess cannot short-circuit.
  const length = Math.max(expected.length, given.length)
  let diff = expected.length ^ given.length
  for (let i = 0; i < length; i += 1) {
    diff |= (expected.charCodeAt(i) || 0) ^ (given.charCodeAt(i) || 0)
  }
  return diff === 0
}

/* -------------------------------------------------------------- entry point */

export type GuardRejection = {
  ok: false
  status: number
  code: string
  message: string
  /** Seconds the client should wait, for a `Retry-After` header. */
  retryAfterSeconds?: number
}

export type GuardApproval = { ok: true; clientKey: string }

export type GuardResult = GuardRejection | GuardApproval

export interface GuardRequest {
  hostname: string
  headers: Headers
  /** Whether the requester affirmed they are authorised to scan the target. */
  authorized: boolean
  /** Shared access code, when the deployment requires one. */
  accessCode?: string
}

/**
 * Run every abuse control, in the order that produces the most useful error.
 *
 * Ordering is deliberate: a blocked host is told so regardless of rate limits,
 * because that answer will never change. Rate limiting is checked last so a
 * caller is not burned by a limit for a request that was invalid anyway.
 */
export function guardScanRequest(request: GuardRequest): GuardResult {
  const key = clientKey(request.headers)
  const limits = guardLimits()

  if (accessCodeRequired() && !accessCodeValid(request.accessCode)) {
    logger.warn('scan rejected: bad access code', { client: key })
    return {
      ok: false,
      status: 401,
      code: 'access_code',
      message: 'This VulnSight instance is private. Enter a valid access code to run a scan.',
    }
  }

  if (!request.authorized) {
    return {
      ok: false,
      status: 403,
      code: 'not_authorized',
      message:
        'You must confirm that you own this website, or have written permission to test it, before a scan can start.',
    }
  }

  if (isBlockedHost(request.hostname)) {
    logger.warn('scan rejected: blocked host', { client: key, hostname: request.hostname })
    return {
      ok: false,
      status: 403,
      code: 'blocked_host',
      message:
        'This host is on VulnSight\u2019s permanent blocklist. Government, military and cloud-provider infrastructure cannot be scanned through this service.',
    }
  }

  if (activeScanCount() >= limits.maxConcurrent) {
    return {
      ok: false,
      status: 503,
      code: 'busy',
      // A specific wait beats a vague "try later": the user knows what to do.
      message: `VulnSight is running its maximum of ${limits.maxConcurrent} scans right now. Please try again in a minute.`,
      retryAfterSeconds: 60,
    }
  }

  const rate = checkRateLimit(key, limits)
  if (!rate.allowed) {
    logger.warn('scan rejected: rate limit', { client: key, hostname: request.hostname })
    const minutes = Math.ceil(rate.retryAfterSeconds / 60)
    return {
      ok: false,
      status: 429,
      code: 'rate_limited',
      message: `You have started ${limits.perClient} scans recently, which is the limit for this instance. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      retryAfterSeconds: rate.retryAfterSeconds,
    }
  }

  return { ok: true, clientKey: key }
}
