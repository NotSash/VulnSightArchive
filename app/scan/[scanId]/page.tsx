import { FieldCanvas } from '@/components/field-canvas'
import { ScanHeader } from '@/components/scan/scan-header'
import { ScanLiveProvider } from '@/components/scan/scan-live-context'
import { ScanProgress } from '@/components/scan/scan-progress'

export default async function ScanPage({ params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params

  return (
    <>
      <FieldCanvas />
      {/* The header and the progress view are siblings, so the header cannot
          see when the scan ends. This shares one boolean between them; see
          `scan-live-context.tsx`. */}
      <ScanLiveProvider>
        <div className="relative z-[2] flex min-h-dvh flex-col">
          <ScanHeader />
          <ScanProgress scanId={scanId} />
        </div>
      </ScanLiveProvider>
    </>
  )
}
