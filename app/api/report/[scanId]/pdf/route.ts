import { NextResponse } from 'next/server'
import { generateReportPdf } from '@/lib/report/pdf'
import { isSampleId, SAMPLE_REPORT } from '@/lib/sample-report'
import { getScan } from '@/lib/scan-store'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params

  // The sample must export like any other report, or its Download PDF lies.
  if (isSampleId(scanId)) {
    const pdf = await generateReportPdf(SAMPLE_REPORT)
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="vulnsight-sample.pdf"',
      },
    })
  }

  const entry = getScan(scanId)

  if (!entry) {
    return NextResponse.json({ error: 'Scan not found.' }, { status: 404 })
  }
  if (entry.status === 'failed') {
    return NextResponse.json(
      { error: entry.error ?? 'This scan failed, so no PDF can be generated.' },
      { status: 409 },
    )
  }
  if (entry.status !== 'completed' || !entry.report) {
    return NextResponse.json(
      { error: 'Scan is still in progress.', scan_id: scanId },
      { status: 409 },
    )
  }

  try {
    const pdf = await generateReportPdf(entry.report)
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="vulnsight-${entry.report.website.domain || scanId}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'PDF generation failed.',
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    )
  }
}
