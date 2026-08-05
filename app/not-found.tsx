import Link from 'next/link'
import { LostSignal } from '@/components/lost-signal'

export const metadata = {
  title: 'Page not found · VulnSight',
}

/**
 * The 404.
 *
 * There was not one: a mistyped URL got Next's stock white page with "404 This
 * page could not be found", which was the only screen on the site that did not
 * belong to it, and it offered no way back.
 *
 * Three things this has to do, in order. Say plainly what happened. Look like
 * the rest of the product, so the visitor knows they are still in the right
 * place. And offer the two things they might actually want: the front page, or
 * a report they can read without running anything.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <LostSignal />

      <p className="mt-8 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--dim-2)]">
        404 · no signal
      </p>

      <h1 className="mt-3 font-display text-[clamp(28px,5vw,44px)] leading-tight">
        Nothing at this address.
      </h1>

      <p className="prose-measure mt-4 text-[15px] text-[var(--dim)]">
        The page you asked for does not exist. If you followed a link to a report, it may have
        expired: scans are held in memory for an hour, then dropped.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="press inline-flex min-h-11 items-center gap-2 bg-phos px-5 font-mono text-[12px] font-bold uppercase tracking-[0.07em] text-[#03070B] transition-colors hover:bg-[#7DF0BF]"
        >
          Scan a site
        </Link>
        <Link
          href="/results/sample"
          className="press inline-flex min-h-11 items-center gap-2 border border-input bg-secondary px-5 font-mono text-[12px] font-bold uppercase tracking-[0.07em] transition-colors hover:border-phos hover:text-phos"
        >
          See a sample report
        </Link>
      </div>
    </main>
  )
}
