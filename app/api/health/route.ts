import { NextResponse } from 'next/server'
import { checkScannerHealth } from '@/lib/scanner/health'

export const runtime = 'nodejs'
// Availability is environment state, not page data: never cache it.
export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 *
 * Reports which scanner integrations are actually usable in this environment.
 *
 * Used by the container health check and by the UI's tool-availability panel.
 * A missing optional tool is `degraded`, not a failure — the app still scans
 * and still reports honestly about what it could not check.
 */
export async function GET() {
  try {
    const health = await checkScannerHealth()
    return NextResponse.json(health, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        detail: error instanceof Error ? error.message : 'Health check failed.',
        checked_at: new Date().toISOString(),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}
