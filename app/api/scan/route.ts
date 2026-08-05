import { NextResponse } from 'next/server'
import { DEMO_SCAN_CODE, DEMO_SCAN_MESSAGE, isDemoMode } from '@/lib/demo-mode'
import {
  adoptScanSlot,
  endScan,
  guardScanRequest,
  releaseRateSlot,
  reserveRateSlot,
  tryClaimScanSlot,
} from '@/lib/guard'
import { createScan } from '@/lib/scan-store'
import { resolveHost } from '@/lib/scanner/probe'
import { validateTarget } from '@/lib/scanner/validate'
import type { ScanMode, ScanStartResponse } from '@/types/report'

export const runtime = 'nodejs'

const VALID_MODES: ScanMode[] = ['quick', 'standard', 'comprehensive']

export async function POST(request: Request) {
  let body: {
    url?: string
    scan_mode?: string
    authorized?: boolean
    access_code?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  /*
   * Demo mode refuses before anything else runs.
   *
   * Placed above validation deliberately: on a preview deployment there is no
   * scan to be had regardless of how good the input is, and telling someone
   * their URL is malformed when the real answer is "this host cannot scan
   * anything" would be a lie by omission. 503, because the capability is
   * absent rather than the request being wrong.
   */
  if (isDemoMode()) {
    return NextResponse.json(
      { error: DEMO_SCAN_MESSAGE, code: DEMO_SCAN_CODE, sample_report: '/results/sample' },
      { status: 503 },
    )
  }

  const rawUrl = (body.url ?? '').trim()
  const mode = (body.scan_mode ?? 'standard') as ScanMode

  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json(
      { error: `scan_mode must be one of: ${VALID_MODES.join(', ')}.` },
      { status: 400 },
    )
  }

  /*
   * Validate before doing anything else. Every rejection carries a specific,
   * user-facing reason — an unscannable target must never reach the pipeline
   * and produce a report about a host that was never really assessed.
   */
  const target = validateTarget(rawUrl)
  if (!target.ok) {
    return NextResponse.json({ error: target.message, code: target.code }, { status: 400 })
  }

  /*
   * Abuse controls run after syntactic validation but *before* DNS, so a
   * blocked or unauthorised target never causes this server to emit even a
   * DNS query on the requester's behalf. Rate limiting only reads the counter
   * here — the hit is recorded once a scan genuinely starts, so a caller is
   * never charged for a request that was rejected.
   */
  const guard = guardScanRequest({
    hostname: target.hostname,
    headers: request.headers,
    authorized: body.authorized === true,
    accessCode: body.access_code,
  })
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.message, code: guard.code },
      {
        status: guard.status,
        headers: guard.retryAfterSeconds
          ? { 'Retry-After': String(guard.retryAfterSeconds) }
          : undefined,
      },
    )
  }

  /*
   * Reserve BOTH limits before the first `await`.
   *
   * `guardScanRequest` above only reads the counters. Everything between a
   * read and its matching write is a window in which concurrent requests all
   * see the same pre-write state, and the DNS lookup below is exactly such a
   * window: 20 simultaneous requests started 20 scans against a cap of 3.
   * Node is single-threaded, so reserving here, with no await in between,
   * closes it. Both reservations are rolled back on every failure path, so a
   * caller is still never charged for a scan that did not start.
   * See AUDIT D1.
   */
  const reservationToken = `pending:${Math.random().toString(36).slice(2)}`
  if (!tryClaimScanSlot(reservationToken)) {
    return NextResponse.json(
      {
        error:
          'VulnSight is running its maximum number of scans right now. Please try again in a minute.',
        code: 'busy',
      },
      { status: 503, headers: { 'Retry-After': '60' } },
    )
  }

  const reservedAt = Date.now()
  const rate = reserveRateSlot(guard.clientKey, undefined, reservedAt)
  if (!rate.allowed) {
    endScan(reservationToken)
    const minutes = Math.ceil(rate.retryAfterSeconds / 60)
    return NextResponse.json(
      {
        error: `You have started several scans recently, which is the limit for this instance. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        code: 'rate_limited',
      },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    )
  }

  const release = () => {
    endScan(reservationToken)
    releaseRateSlot(guard.clientKey, reservedAt)
  }

  /*
   * Resolve DNS up front. This is what makes a typo or a dead domain fail
   * immediately and clearly in the form, instead of producing a scan that
   * silently invents results for a host that does not exist.
   */
  let dns: Awaited<ReturnType<typeof resolveHost>>
  try {
    dns = await resolveHost(target.hostname)
  } catch (error) {
    release()
    throw error
  }
  if (!dns.ok) {
    release()
    return NextResponse.json(
      { error: dns.reason ?? `Unable to resolve host "${target.hostname}".`, code: 'dns' },
      { status: 400 },
    )
  }

  let job: ReturnType<typeof createScan>
  try {
    job = createScan(target.url, target.hostname, mode, dns, target.schemeAssumed)
  } catch (error) {
    release()
    throw error
  }

  // The real scan now owns the slot the placeholder was holding.
  adoptScanSlot(reservationToken, job.scanId)

  const response: ScanStartResponse = {
    scan_id: job.scanId,
    status: job.status,
  }
  return NextResponse.json(response, { status: 201 })
}
