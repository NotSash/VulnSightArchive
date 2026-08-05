'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BrandLogo } from '@/components/brand-logo'
import { useScanLive } from '@/components/scan/scan-live-context'

/**
 * A header for a scan in flight. "Stop scan" is destructive and irreversible,
 * so it asks once rather than acting on a stray click.
 */
export function ScanHeader() {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  /*
   * Only offer to stop a scan that is actually running.
   *
   * On the failed screen this button sat directly above the words "The scan
   * stopped", and on the expired screen it offered to stop a scan that no
   * longer exists. Both opened a destructive confirmation for a no-op.
   */
  const { live } = useScanLive()

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-[#070C12]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-[62px] max-w-[1120px] items-center gap-4 px-6 2xl:max-w-[1600px] 2xl:px-10">
        <Link
          href="/"
          aria-label="VulnSight home"
          // 44px of hit area without moving the mark: the negative margin
          // cancels the padding that creates the target. Same treatment as the
          // site header and the report header.
          className="-m-2 flex min-h-11 shrink-0 items-center p-2"
        >
          <BrandLogo />
        </Link>
        <span className="flex-1" />
        {!live ? null : confirming ? (
          <span className="flex items-center gap-2">
            <span className="hidden text-[12.5px] text-[var(--dim)] sm:inline">
              Stop and lose this scan?
            </span>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="press inline-flex min-h-11 items-center border border-severity-critical bg-severity-critical px-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-[#03070B]"
            >
              Yes, stop
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-11 items-center border border-input bg-secondary px-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.07em]"
            >
              Keep going
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-11 items-center border border-input bg-secondary px-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.07em] transition-colors hover:border-severity-critical hover:text-severity-critical"
          >
            Stop scan
          </button>
        )}
      </div>
    </header>
  )
}
