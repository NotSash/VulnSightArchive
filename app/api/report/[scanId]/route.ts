import { NextResponse } from 'next/server'
import { isSampleId, SAMPLE_REPORT } from '@/lib/sample-report'
import { getScan } from '@/lib/scan-store'

export const runtime = 'nodejs'

/**
 * GET /api/report/:scanId
 *
 * A report is only returned once the scan has genuinely completed. We never
 * synthesize a partial or placeholder report to fill the gap — a report the
 * reader cannot trust is worse than no report at all.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params

  /*
   * The seeded sample is always available. The homepage links to it and real
   * reports expire after an hour, so without this the promise of "read a
   * finished report before you scan anything" would usually be broken.
   */
  if (isSampleId(scanId)) {
    return NextResponse.json(SAMPLE_REPORT)
  }

  const entry = getScan(scanId)

  if (!entry) {
    return NextResponse.json(
      {
        error:
          'That scan could not be found. Scans are held in memory for the lifetime of the server process, so it may have expired.',
      },
      { status: 404 },
    )
  }

  // A failed scan produces no report. Say so plainly, and explain why.
  if (entry.status === 'failed') {
    return NextResponse.json(
      {
        error: entry.error ?? 'This scan could not be completed, so no report was produced.',
      },
      { status: 409 },
    )
  }

  if (entry.status !== 'completed' || !entry.report) {
    return NextResponse.json(
      { error: 'Scan is still in progress.', scan_id: scanId },
      { status: 409 },
    )
  }

  return NextResponse.json(entry.report)
}

/**
 * Cheap existence check, so the UI can confirm a remembered report is still
 * available before offering a link to it. Reports are held in memory with a
 * TTL, so a stored link is often dead — offering it blindly would be a control
 * that lies.
 */
export async function HEAD(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params

  /*
   * The seeded sample is always available. The homepage links to it, and
   * real reports expire after an hour, so without this the promise of
   * "read a finished report before you scan anything" would usually be broken.
   */
  if (isSampleId(scanId)) {
    return NextResponse.json(SAMPLE_REPORT)
  }

  const entry = getScan(scanId)
  const available = entry?.status === 'completed' && entry.report !== null
  return new Response(null, { status: available ? 200 : 404 })
}
