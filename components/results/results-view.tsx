'use client'

import { SearchX } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import useSWR from 'swr'
import { AiSummarySection } from '@/components/results/ai-summary-section'
import { CoverageNotes } from '@/components/results/coverage-notes'
import { CveSection } from '@/components/results/cve-section'
import { OwaspSection } from '@/components/results/owasp-section'
import { ReportHeader } from '@/components/results/report-header'
import { ReportNav } from '@/components/results/report-nav'
import { ReportOverview } from '@/components/results/report-overview'
import { ReportSkeleton } from '@/components/results/report-skeleton'
import { TechnicalDetailsSection } from '@/components/results/technical-details-section'
import { TimelineSection } from '@/components/results/timeline-section'
import { Verdict } from '@/components/results/verdict'
import { VulnerabilitiesSection } from '@/components/results/vulnerabilities-section'
import { Button } from '@/components/ui/button'
import { recordScan } from '@/lib/scan-history'
import type { ScanReport } from '@/types/report'

type ReportError = Error & { status: number }

const fetcher = async (url: string): Promise<ScanReport> => {
  const res = await fetch(url)
  if (!res.ok) {
    // Carry the server's explanation through so the UI can state the real
    // reason instead of guessing that the scan "expired".
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    const err = new Error(body.error ?? 'Failed to load report') as ReportError
    err.status = res.status
    throw err
  }
  return res.json()
}

function SectionHeading({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div id={id} className="scroll-mt-[132px] sm:scroll-mt-24">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-xl leading-none">{title}</h2>
        {hint && (
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--dim-2)]">
            {hint}
          </span>
        )}
      </div>
    </div>
  )
}

export function ResultsView({ scanId }: { scanId: string }) {
  const { data, error, isLoading } = useSWR<ScanReport>(`/api/report/${scanId}`, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  /*
   * Remember this scan so the home page can offer it again without an account.
   * The sample is excluded: it is not something the visitor ran.
   */
  useEffect(() => {
    if (!data || scanId === 'sample') return
    recordScan({
      scanId,
      url: data.website?.domain ?? data.metadata.url,
      score: data.risk.score,
      at: Date.now(),
      mode: data.metadata.scan_mode,
      findings: data.vulnerabilities.length,
    })
  }, [data, scanId])

  if (isLoading) {
    return <ReportSkeleton />
  }

  if (error || !data) {
    const err = error as ReportError | undefined
    // A scan that ran and failed is a different story from one that vanished.
    const failed = err?.status === 409

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <span className="flex size-12 items-center justify-center border border-border bg-card text-[var(--dim)]">
          <SearchX className="size-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl">{failed ? 'No report was produced' : 'Report not available'}</h1>
          <p className="mt-1 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
            {err?.message ??
              'This scan could not be found. Scans are held in memory for the lifetime of the server process, so it may have expired.'}
          </p>
          {failed && (
            <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
              VulnSight does not publish a report it cannot stand behind, so nothing was generated
              for this attempt.
            </p>
          )}
        </div>
        <Button render={<Link href="/#scan" />} nativeButton={false}>
          Start a new scan
        </Button>
      </div>
    )
  }

  const report = data

  /*
   * The header rises; the body does not.
   *
   * This was `motion-safe:animate-rise` on the whole page, so a 7,800px report
   * faded in as one slab. Animating a document of that size as a single
   * element is both the least interesting choice and the most expensive one.
   * The masthead is what a reader looks at first, so that is what gets the
   * entrance; the sections below reveal as they are scrolled to, which is the
   * job of `RevealOnScroll`.
   */
  return (
    <div className="min-h-screen">
      <div className="animate-rise">
        <ReportHeader report={report} />
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/*
          The section bar is rendered OUTSIDE the grid on a phone.

          Inside the `aside` it was a sticky element in a grid item that is
          only as tall as its own content, so it scrolled away with that item
          after a few hundred pixels. A sticky element can never outlive its
          containing block, and here the container ended long before the
          report did. Lifting it out gives it the whole page to stick against.

          `min-w-0`: a grid item defaults to `min-width: auto`, meaning "at
          least as wide as my content", and a row of non-wrapping chips is very
          wide. Without it the column grew to fit them and dragged the page
          432px sideways instead of scrolling inside the bar.
        */}
        <div className="grid gap-10 lg:grid-cols-[180px_1fr]">
          <aside className="hidden min-w-0 lg:block print:hidden">
            <ReportNav
              variant="sidebar"
              hasCoverage={Boolean(report.notes?.length)}
              hasCves={report.cves.length > 0}
            />
          </aside>

          <main className="min-w-0 space-y-12">
            {/*
              The phone section bar lives here, inside `main`, not in the
              `aside` beside it.

              A sticky element can never outlive its containing block, and the
              `aside` is only as tall as its own content: 61px on a phone. So
              the bar "stuck" for 61 pixels and then scrolled away with its
              parent. `main` spans the entire 7,800px report, which is exactly
              the distance the bar needs to stay pinned for.

              `-mt-12` cancels the first `space-y-12` gap so the bar sits
              directly under the report header rather than a section-gap below
              it.
            */}
            <ReportNav
              variant="bar"
              hasCoverage={Boolean(report.notes?.length)}
              hasCves={report.cves.length > 0}
            />

            {/* The answer first: score, and what to do about it. */}
            <div id="overview" className="scroll-mt-[132px] space-y-6 sm:scroll-mt-24">
              <Verdict report={report} />
              <ReportOverview report={report} />
            </div>

            <section className="space-y-4" id="ai-summary-wrap">
              <SectionHeading
                id="ai-summary"
                title="Executive summary"
                hint="Plain-language risk overview"
              />
              <AiSummarySection ai={report.ai} />
            </section>

            <section className="space-y-4">
              <SectionHeading
                id="vulnerabilities"
                title="Vulnerabilities"
                hint={`${report.vulnerabilities.length} findings`}
              />
              <VulnerabilitiesSection vulnerabilities={report.vulnerabilities} />
            </section>

            <section className="space-y-4">
              <SectionHeading
                id="technical"
                title="Technical details"
                hint="Reconnaissance & configuration"
              />
              <TechnicalDetailsSection report={report} />
            </section>

            {report.notes && report.notes.length > 0 && (
              <section className="space-y-4">
                <SectionHeading id="coverage" title="Scan coverage" hint="What was not checked" />
                <CoverageNotes notes={report.notes} />
              </section>
            )}

            {report.cves.length > 0 && (
              <section className="space-y-4">
                <SectionHeading
                  id="cves"
                  title="Known CVEs"
                  hint={`${report.cves.length} matched`}
                />
                <CveSection cves={report.cves} />
              </section>
            )}

            <section className="space-y-4">
              <SectionHeading id="owasp" title="OWASP Top 10 coverage" hint="2021 mapping" />
              <OwaspSection mapping={report.owasp_mapping} />
            </section>

            <section className="space-y-4">
              <SectionHeading
                id="timeline"
                title="Scan timeline"
                hint={`Completed in ${report.metadata.duration_seconds}s`}
              />
              <TimelineSection timeline={report.timeline} />
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}
