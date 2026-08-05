import Link from 'next/link'
import { FieldCanvas } from '@/components/field-canvas'
import { ResultsView } from '@/components/results/results-view'

export default async function ResultsPage({ params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params
  return (
    <>
      <FieldCanvas />
      <div className="relative z-[2]">
        {/*
          Without JavaScript this page rendered 24 characters: "Loading
          security report…", forever, with `aria-busy="true"` left on so a
          screen reader was told to keep waiting for something that would never
          arrive.

          The report is fetched client-side, so it genuinely cannot render
          here. But a report is a *document*, and it is the one page on this
          site someone might reasonably save, print, or open in a stripped-down
          browser. Saying so plainly, and offering the raw JSON, which needs no
          JavaScript at all, is far better than an eternal spinner.
        */}
        <noscript>
          <div className="mx-auto max-w-2xl px-6 py-20 text-center">
            <h1 className="font-display text-[24px] leading-tight">This report needs JavaScript</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--dim)]">
              The report is assembled in your browser from the scan data, so it cannot be shown with
              scripts turned off. The underlying data does not need JavaScript: you can read it
              directly, or turn scripts on and reload.
            </p>
            <p className="mt-6">
              <a
                href={`/api/report/${scanId}`}
                className="press inline-flex min-h-11 items-center border border-phos bg-phos px-4 font-mono text-[12px] font-bold uppercase tracking-[0.07em] text-[#03070B]"
              >
                Open the raw report
              </a>
            </p>
            <p className="mt-6 font-mono text-[12px] text-[var(--dim-2)]">Scan {scanId}</p>
            <p className="mt-8 text-[13px]">
              <Link href="/" className="text-phos underline-offset-2 hover:underline">
                Back to VulnSight
              </Link>
            </p>
          </div>
        </noscript>
        <ResultsView scanId={scanId} />
      </div>
    </>
  )
}
