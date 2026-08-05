'use client'

import { RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { BrandLogo } from '@/components/brand-logo'
import { ExportMenu } from '@/components/results/export-menu'
import type { ScanReport } from '@/types/report'

const MODE_LABEL: Record<string, string> = {
  quick: 'Surface scan',
  standard: 'Standard scan',
  comprehensive: 'Deep scan',
}

/**
 * The report's masthead.
 *
 * The hostname lives here rather than as a giant pixel heading further down.
 * Jersey 25 is a display face: it carries personality on short marketing
 * headlines, but a long lowercase domain full of dots set in it is genuinely
 * hard to read, and the one thing a reader must never have to squint at is
 * *which site this report is about*. So the domain is set in the mono face —
 * still console-appropriate, unambiguous at any size.
 */
export function ReportHeader({ report }: { report: ScanReport }) {
  const { website, metadata } = report

  return (
    <div className="sticky top-0 z-50 border-b border-border bg-[#070C12]/85 backdrop-blur-xl print:static print:border-none print:bg-white">
      {/*
        Two rows on a phone, one row from `sm` up.

        The old layout put the logo, the domain block and the export buttons on
        a single `flex-wrap` line. That reads as reasonable and is not: the
        domain block was `flex-1`, which is `flex-basis: 0`, so it claimed no
        intrinsic width at all and simply absorbed whatever the buttons left
        over. At 390px the buttons need about 270px of the 358px available, so
        the domain was handed **13 pixels**. It wrapped one character per line
        and rendered as a vertical "s.", with the scan metadata stacked beside
        it in single letters.

        `flex-wrap` could not save it, because nothing ever overflowed: the
        line always "fit", by crushing the one element that had no floor. The
        fix is to stop asking three things to share one row on a phone.
      */}
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 2xl:max-w-[1600px] 2xl:px-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-x-5">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="VulnSight home"
              /*
               * 44px of hit area around a 28px mark. The negative margin keeps
               * the padding from pushing the logo off its optical alignment,
               * so the target grows without the layout moving.
               */
              className="-m-2 flex size-11 shrink-0 items-center justify-center p-2"
            >
              <BrandLogo showName={false} />
            </Link>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {/*
                  `break-all` as well as `truncate`: a domain has no spaces, so
                  a narrow column cannot break it on a word boundary and would
                  rather overflow than wrap. Truncation handles the common
                  case; the break is the guarantee that it can never force the
                  page wider.
                */}
                <h1 className="min-w-0 truncate break-all font-mono text-[16px] font-bold leading-tight tracking-tight sm:text-[17px] sm:leading-none">
                  {website.domain}
                </h1>
                <a
                  href={metadata.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  // `inline-flex` with a minimum height rather than `inline`:
                  // an inline element's box is only as tall as its text, so at
                  // 12px this was an 18px tap target sitting beside the
                  // hostname. It stays out of the flow of the baseline by
                  // aligning to it.
                  className="hidden min-h-11 items-center truncate text-[12px] text-[var(--dim-2)] underline-offset-2 hover:text-phos hover:underline sm:inline-flex"
                >
                  {metadata.url}
                </a>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--dim-2)] sm:gap-x-3 sm:text-[9.5px] sm:tracking-[0.09em]">
                <span className="whitespace-nowrap">
                  {MODE_LABEL[metadata.scan_mode] ?? metadata.scan_mode}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tnum whitespace-nowrap">{metadata.duration_seconds}s</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{report.scan_id}</span>
              </div>
            </div>
          </div>

          {/*
            On a phone the three actions share the full width as equal
            columns, which is both how a native app puts a toolbar at the top
            of a screen and the cheapest way to give each one a comfortable
            target. They stop growing at `sm`, where there is room for them to
            sit at their natural size beside the domain.
          */}
          <div className="flex items-center gap-2 sm:ml-auto sm:shrink-0 print:hidden">
            <Link
              href="/"
              className="press inline-flex min-h-11 flex-1 items-center justify-center gap-2 border border-input bg-secondary px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.07em] transition-colors hover:border-phos hover:text-phos sm:flex-none"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              New scan
            </Link>
            <ExportMenu report={report} />
          </div>
        </div>
      </div>
    </div>
  )
}

export { MODE_LABEL }
