import { NextResponse } from 'next/server'
import { computeProgress, getScan } from '@/lib/scan-store'
import type { ScanStatusResponse } from '@/types/report'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params

  const job = getScan(scanId)
  if (!job) {
    return NextResponse.json({ error: 'Scan not found.' }, { status: 404 })
  }

  const { progress, stage, status, timeline, findings, severityCounts, error } =
    computeProgress(job)

  const response: ScanStatusResponse = {
    scan_id: job.scanId,
    hostname: job.hostname,
    status,
    progress,
    stage,
    timeline,
    findings_so_far: findings,
    severity_counts: severityCounts,
    // Only present on failure, so the UI can explain what actually went wrong.
    ...(error ? { error } : {}),
  }
  return NextResponse.json(response)
}
