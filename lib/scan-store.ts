/**
 * In-memory scan registry for the local-first pipeline.
 *
 * Progress is derived from *actual* stage completion reported by the
 * orchestrator — there is no simulated timer. A stage only appears complete once
 * the work behind it has really finished, so the scan page reflects what the
 * scanner is genuinely doing.
 */

import { beginScan, endScan } from '@/lib/guard'
import { logger } from '@/lib/logger'
import type { DnsResult } from '@/lib/scanner/probe'
import { runScan, ScanFailedError, stagesForMode } from '@/lib/scanner/run'
import type {
  LiveFinding,
  ScanMode,
  ScanReport,
  ScanStatus,
  Severity,
  TimelineEvent,
} from '@/types/report'

export interface ScanJob {
  scanId: string
  url: string
  hostname: string
  mode: ScanMode
  createdAt: number
  status: ScanStatus
  /** Ordered stage names for this mode. */
  stages: string[]
  /** One entry per stage, updated as the scan really progresses. */
  timeline: TimelineEvent[]
  report: ScanReport | null
  /**
   * Findings observed so far, refreshed after each stage. Pre-correlation:
   * these carry a source but never a confidence.
   */
  liveFindings: LiveFinding[]
  /** Set when the scan could not complete. */
  error: string | null
}

const globalForScans = globalThis as unknown as {
  __vulnsightScans?: Map<string, ScanJob>
}

const scans: Map<string, ScanJob> = globalForScans.__vulnsightScans ?? new Map()
if (!globalForScans.__vulnsightScans) {
  globalForScans.__vulnsightScans = scans
}

/** Discard scans after this long so the map cannot grow without bound. */
const TTL_MS = 60 * 60 * 1000

function evictExpired() {
  const cutoff = Date.now() - TTL_MS
  for (const [id, job] of scans) {
    if (job.createdAt < cutoff) scans.delete(id)
  }
}

function makeScanId(): string {
  return `vs_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`
}

/**
 * Register a scan and start the real pipeline.
 *
 * DNS has already been resolved during request validation, so the result is
 * passed in rather than looked up again.
 */
export function createScan(
  url: string,
  hostname: string,
  mode: ScanMode,
  dns: DnsResult,
  /** True when `https://` was assumed rather than typed. See `runScan`. */
  schemeAssumed = false,
): ScanJob {
  evictExpired()

  const scanId = makeScanId()
  const stages = stagesForMode(mode)

  const job: ScanJob = {
    scanId,
    url,
    hostname,
    mode,
    createdAt: Date.now(),
    status: 'running',
    stages,
    // Every stage starts pending; the first is marked running immediately below.
    timeline: stages.map((stage, index) => ({
      time: '',
      event: stage,
      status: index === 0 ? 'running' : 'pending',
    })),
    report: null,
    liveFindings: [],
    error: null,
  }

  scans.set(scanId, job)

  /*
   * Register with the concurrency guard before the work starts, so the slot is
   * held for the entire lifetime of the scan rather than only while the
   * request is in flight.
   *
   * `beginScan` is a Set add, so it is idempotent. The API route reserves a
   * placeholder slot before its DNS await and swaps it for this id via
   * `adoptScanSlot`, which means the slot is already held by the time we get
   * here. Calling it again is harmless and keeps this function correct when
   * invoked directly, as the tests do. See AUDIT D1.
   */
  beginScan(scanId)

  // Fire-and-forget: the scan page polls /api/status for real progress.
  void executeScan(job, dns, schemeAssumed)

  return job
}

async function executeScan(job: ScanJob, dns: DnsResult, schemeAssumed: boolean): Promise<void> {
  try {
    const report = await runScan({
      scanId: job.scanId,
      url: job.url,
      hostname: job.hostname,
      mode: job.mode,
      dns,
      schemeAssumed,
      onFindings: (findings) => {
        job.liveFindings = findings
      },
      onStage: ({ index, name, status, time, detail }) => {
        job.timeline[index] = {
          time,
          /*
           * `event` is the stage name and nothing else; the outcome travels in
           * `detail`. These used to be joined as `name · detail` and split
           * apart in the UI, which meant a stage name containing that
           * separator would silently lose half its text.
           */
          event: name,
          detail,
          status: status === 'failed' ? 'skipped' : status,
        }
        // Advance the next stage to "running" so the UI shows live movement.
        const next = job.timeline[index + 1]
        if (next && next.status === 'pending') next.status = 'running'
      },
    })

    // The orchestrator does not own the timeline; attach the real one here.
    report.timeline = job.timeline
    job.report = report
    job.status = 'completed'
  } catch (err) {
    job.status = 'failed'
    job.error =
      err instanceof ScanFailedError
        ? err.message
        : `The scan failed unexpectedly${err instanceof Error && err.message ? `: ${err.message}` : '.'}`

    // Any stage still pending never ran — say so instead of leaving it spinning.
    job.timeline = job.timeline.map((event) =>
      event.status === 'pending' || event.status === 'running'
        ? { ...event, status: 'skipped' }
        : event,
    )
    logger.error('scan failed', err, {
      scan_id: job.scanId,
      hostname: job.hostname,
      mode: job.mode,
    })
  } finally {
    // Release the concurrency slot on every path, including failure — a leaked
    // slot would permanently reduce the instance's capacity.
    endScan(job.scanId)
  }
}

export function getScan(scanId: string): ScanJob | undefined {
  return scans.get(scanId)
}

export interface ScanProgress {
  progress: number
  stage: string
  status: ScanStatus
  timeline: TimelineEvent[]
  findings: LiveFinding[]
  severityCounts: Record<Severity, number>
  error: string | null
}

/** Tally live findings by severity for the scan page's running counters. */
export function countSeverities(findings: LiveFinding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  }
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}

/** Progress is the share of stages that have actually finished. */
export function computeProgress(job: ScanJob): ScanProgress {
  const total = job.timeline.length || 1
  const settled = job.timeline.filter(
    (event) => event.status === 'completed' || event.status === 'skipped',
  ).length

  const running = job.timeline.find((event) => event.status === 'running')

  let progress: number
  if (job.status === 'completed') {
    progress = 100
  } else if (job.status === 'failed') {
    progress = Math.round((settled / total) * 100)
  } else {
    // Cap in-flight progress below 100 so it never looks done prematurely.
    progress = Math.min(99, Math.round((settled / total) * 100))
  }

  const stage =
    job.status === 'completed'
      ? 'Completed'
      : job.status === 'failed'
        ? 'Scan failed'
        : (running?.event ?? job.stages[Math.min(settled, total - 1)] ?? 'Working')

  return {
    // `event` no longer carries an appended detail, so nothing to strip.
    progress,
    stage,
    status: job.status,
    timeline: job.timeline,
    findings: job.liveFindings,
    severityCounts: countSeverities(job.liveFindings),
    error: job.error,
  }
}
