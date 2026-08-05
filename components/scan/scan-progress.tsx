'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useScanLive } from '@/components/scan/scan-live-context'
import { StageBar } from '@/components/scan/stage-bar'
import { StageCommentary } from '@/components/scan/stage-commentary'
import { StageList } from '@/components/scan/stage-list'
import { useScanAnnouncer } from '@/components/scan/use-scan-announcer'
import { SEVERITY_META } from '@/lib/severity'
import { cn } from '@/lib/utils'
import type { LiveFinding, ScanStatusResponse, Severity } from '@/types/report'

/**
 * The live scan.
 *
 * Two rules shape this screen. First, never leave someone staring at a
 * spinner — show the named step, the verbatim command, and findings as they
 * arrive. Second, never show a number the backend does not actually have: the
 * running step uses an indeterminate sweep rather than an invented percentage,
 * because a product whose whole claim is "we don't invent data" cannot invent a
 * progress figure on the very screen where it is working.
 */

/*
 * Severity colours and labels come from `lib/severity.ts`.
 *
 * This file used to keep private copies of both, which is how the scan page
 * ended up saying "Med" while the results page said "Medium" for the same
 * finding. The short form is now a property of the shared table rather than a
 * second table that happens to disagree.
 */

/**
 * Typical duration of the step currently running.
 *
 * Nuclei is measured at roughly 95 seconds against a live host, which is far
 * longer than every other step combined. Without saying so, a user watching a
 * bar sit still for a minute and a half reasonably concludes it has hung.
 */
function typicalFor(stage: string): string | null {
  const s = stage.toLowerCase()
  if (s.includes('nuclei') || s.includes('template')) return 'about 90 seconds'
  if (s.includes('nmap') || s.includes('port')) return 'about 40 seconds'
  if (s.includes('render') || s.includes('playwright')) return 'a few seconds'
  return null
}

function elapsedLabel(from: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - from) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export function ScanProgress({ scanId }: { scanId: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<ScanStatusResponse | null>(null)
  const [missing, setMissing] = useState(false)
  const [elapsed, setElapsed] = useState('0m 00s')
  const startedAt = useRef(Date.now())
  /*
   * Tell the header when the scan is over, so it stops offering to stop it.
   * The two are siblings under the page; see `scan-live-context.tsx`.
   */
  const { setLive } = useScanLive()

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const res = await fetch(`/api/status/${scanId}`)
        if (!active) return
        if (res.status === 404) {
          setMissing(true)
          setLive(false)
          return
        }
        const data = (await res.json()) as ScanStatusResponse
        if (!active) return
        setStatus(data)

        if (data.status === 'completed') {
          setLive(false)
          /*
           * Captured in `timer` so the cleanup can cancel it. Untracked, a
           * visitor who navigated away (or pressed Stop scan) inside this
           * 650ms window was still dragged to the report, which made the
           * control look broken. See AUDIT E1.
           */
          timer = setTimeout(() => {
            if (active) router.push(`/results/${scanId}`)
          }, 650)
          return
        }
        if (data.status === 'failed') {
          setLive(false)
          return
        }
        timer = setTimeout(poll, 1200)
      } catch {
        if (active) timer = setTimeout(poll, 2500)
      }
    }

    void poll()
    const tick = setInterval(() => setElapsed(elapsedLabel(startedAt.current)), 1000)
    return () => {
      active = false
      clearTimeout(timer)
      clearInterval(tick)
    }
  }, [scanId, router, setLive])

  /*
   * Derived state and hooks must sit above the early returns: React requires
   * hooks to run unconditionally and in the same order on every render.
   */
  const timeline = status?.timeline ?? []
  const done = timeline.filter((t) => t.status === 'completed' || t.status === 'skipped').length
  const total = timeline.length || 1
  /*
   * Which stage is actually running. `scan-store.ts` promotes the next stage
   * to `running` as soon as the previous one settles, so this is the server's
   * own opinion rather than "done + 1", which would be wrong whenever a stage
   * was skipped.
   */
  const liveIndex = timeline.findIndex((t) => t.status === 'running')

  /*
   * `useSmoothProgress` is gone with the thin bar it eased.
   *
   * It existed because a single fill jumping from 8/15 to 9/15 looked abrupt.
   * The wall does not have that problem: each block animates its own courses
   * in, so progress is already gradual and easing a width would fight it.
   */

  /*
   * What a screen reader hears. Throttled, because polling every 1.2 seconds
   * would otherwise read out a backlog of steps that have already finished.
   * See `use-scan-announcer.ts` for why it never speaks a percentage.
   */
  const announcement = useScanAnnouncer({
    status: status?.status,
    stage: status?.stage,
    done,
    total,
    findingCount: status?.findings_so_far?.length ?? 0,
    typical: typicalFor(status?.stage ?? ''),
  })

  if (missing) {
    return (
      <Centred
        title="That scan has gone"
        body="Scans are kept in memory for an hour, so this one may have expired. Starting a new one takes a few minutes."
        action={
          <button
            type="button"
            onClick={() => router.push('/')}
            className="press border border-phos bg-phos px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-[#03070B] shadow-hard-sm"
          >
            Start a new scan
          </button>
        }
      />
    )
  }

  if (status?.status === 'failed') {
    return (
      <Centred
        title="The scan stopped"
        body={status.error ?? 'Something went wrong and no report was produced.'}
        action={
          <button
            type="button"
            onClick={() => router.push('/')}
            className="press border border-phos bg-phos px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-[#03070B] shadow-hard-sm"
          >
            Try another scan
          </button>
        }
      />
    )
  }

  const findings = status?.findings_so_far ?? []
  const counts = status?.severity_counts
  const agreedCount = 0 // Correlation only runs at the end; never claim it early.

  return (
    <main className="mx-auto max-w-[1120px] px-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-6 pb-6 pt-9">
        <div>
          {/*
            The heading follows the scan, rather than always claiming it is
            running. For the 650ms between the last stage settling and the
            redirect the page used to read "Scanning ...", which contradicted
            the 15/15 counter directly below it.
          */}
          <h1 className="text-[clamp(21px,2.5vw,30px)]">
            {status?.status === 'completed' ? 'Scanned' : 'Scanning'}{' '}
            <span className="text-phos">{status?.hostname ?? '…'}</span>
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Meta>
              {status?.status === 'completed' ? 'Took' : 'Running'} {elapsed}
            </Meta>
            {/* Only while the step is actually in flight: quoting how long a
                finished step usually takes is noise at best. */}
            {status?.status !== 'completed' && typicalFor(status?.stage ?? '') && (
              <Meta>This step usually takes {typicalFor(status?.stage ?? '')}</Meta>
            )}
            {/*
              Only once the server has actually told us how many stages there
              are. Before the first poll the timeline is empty and `total`
              falls back to 1, which rendered "Step 1 of 1": a scan that
              appears to have one step and be stuck on it. With scripts off
              that fabricated state is all a visitor ever sees. This product
              does not invent progress figures.
            */}
            {timeline.length > 0 && (
              <Meta>
                Step {Math.min(done + 1, total)} of {total}
              </Meta>
            )}
            <Meta mono>{scanId}</Meta>
          </div>
        </div>

        {/*
          The one big number on the page, and it is a real count.

          Deliberately `done / total` rather than a percentage: the backend
          knows exactly how many stages have settled and cannot know how far
          through a stage it is. JetBrains Mono with tabular figures, because
          Jersey 25's digits are not uniform width and a number that changes
          every second would jitter.
        */}
        <div className="shrink-0 text-right">
          <p className="tnum font-mono text-[clamp(30px,4vw,46px)] font-bold leading-none text-phos">
            {done}
            <span className="text-[0.55em] text-[var(--dim-2)]"> / {total}</span>
          </p>
          <p className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--dim-2)]">
            Checks reported
          </p>
        </div>
      </div>

      {/*
        The instrument. One cell per real stage, lit as each one reports.

        Every cell exists from the first frame because `lib/scan-store.ts`
        seeds every stage as pending, so the length of the bar is a fact, not
        an estimate. No percentage appears anywhere on this page: a stage has
        no knowable midpoint, so the running cell sweeps instead.
      */}
      <StageBar timeline={timeline} liveIndex={liveIndex} className="mb-2.5" />

      {/*
        Under the bar: the stage now running, and a rotating line explaining
        what that tool is doing and why a long wait is normal.

        The commentary is keyed to the running stage and changes every few
        seconds. It exists because the honest answer to "how long is left" is
        "unknown", and a reader who understands WHY Nuclei takes two minutes
        waits more happily than one watching a silent bar.
      */}
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-amber">
          {status?.status === 'completed'
            ? 'All checks reported'
            : (status?.stage ?? 'Starting up')}
        </p>
        {status?.status !== 'completed' && (
          <div className="min-w-0 flex-1 basis-[26em] text-right">
            <StageCommentary stage={status?.stage ?? ''} />
          </div>
        )}
      </div>

      {/*
        The progress bar a screen reader uses.

        The wall above is the visual progress and is `aria-hidden`, because
        reading fifteen blocks on every poll is noise. This carries the same
        fact in one line. `aria-valuetext` is what actually gets spoken, so it
        says "8 of 15 steps finished" rather than a bare number, and it is
        measured in settled stages, never a fabricated percentage.
      */}
      <span
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} steps finished`}
        className="sr-only"
      />

      {/*
        The one live region on this page.

        Everything above is visual: lamps, a sweep, a rotating line of flavour
        text. None of it reached a screen reader, so a four minute scan was
        four minutes of silence. This is the spoken version of the same
        progress, throttled so it reports the present rather than reciting
        every step that has already gone by.

        Visually hidden rather than absent: it duplicates what is already on
        screen, so showing it twice would be noise for everyone else.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/*
        Two columns on a wide screen, stacked on a phone.

        Progress on the left because it is the reason the page exists; what has
        been found on the right, so a reader can watch either without the two
        fighting for the same space. `lg` rather than `md`: at 768px the detail
        lines wrapped to three lines each and the list became a wall of text.
      */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="border border-border bg-card shadow-hard backdrop-blur-md">
          <div className="flex justify-between border-b border-border bg-[#03070B]/55 px-3.5 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim)]">
            <span>Progress</span>
            <span className="tnum">
              {done} / {total}
            </span>
          </div>
          <StageList timeline={timeline} liveIndex={liveIndex} />
        </div>

        <div className="border border-border bg-card shadow-hard backdrop-blur-md">
          <div className="flex justify-between border-b border-border bg-[#03070B]/55 px-3.5 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim)]">
            <span>Found so far</span>
            <span className="tnum">{findings.length}</span>
          </div>

          <div className="grid grid-cols-4 border-b border-border">
            {(['high', 'medium', 'low', 'info'] as Severity[]).map((sev, i) => (
              <div
                key={sev}
                className={cn('px-2 py-3.5 text-center', i > 0 && 'border-l border-border')}
              >
                <div
                  className={cn(
                    'tnum font-mono text-[23px] font-bold leading-none',
                    sev === 'high' && 'text-severity-high',
                    sev === 'medium' && 'text-severity-medium',
                    sev === 'low' && 'text-severity-low',
                    sev === 'info' && 'text-severity-info',
                  )}
                >
                  {counts?.[sev] ?? 0}
                </div>
                <div className="mt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.09em] text-[var(--dim-2)]">
                  {SEVERITY_META[sev].abbrev}
                </div>
              </div>
            ))}
          </div>

          {findings.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[13px] text-[var(--dim-2)]">
              Nothing found yet.
            </p>
          ) : (
            <ul>
              {findings.map((finding, i) => (
                <FindingRow key={`${finding.title}-${i}`} finding={finding} index={i} />
              ))}
            </ul>
          )}

          <p className="border-t border-border bg-[#03070B]/35 px-3.5 py-3 text-center font-mono text-[10px] leading-relaxed tracking-[0.04em] text-[var(--dim-2)]">
            {agreedCount === 0
              ? 'Cross-checking runs once every tool has reported.'
              : `${agreedCount} confirmed by more than one tool.`}
          </p>
        </div>
      </div>
    </main>
  )
}

function FindingRow({ finding, index }: { finding: LiveFinding; index: number }) {
  return (
    <li
      className={cn(
        'row-scan grid grid-cols-[4px_1fr_auto] items-center gap-3 px-3.5 py-3',
        index > 0 && 'border-t border-border',
      )}
      style={{
        animation: `rise var(--dur-base) var(--ease) ${Math.min(index * 0.04, 0.3)}s both`,
      }}
    >
      <i aria-hidden="true" className={cn('h-[26px] w-1', SEVERITY_META[finding.severity].bg)} />
      <div>
        <div className="text-[13.5px] font-medium leading-snug">{finding.title}</div>
        {/*
          Mid-scan a finding can only name the tool that saw it. Agreement is
          not knowable until every tool has reported, so nothing here is ever
          badged "confirmed".
        */}
        <div className="mt-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] text-[var(--dim-2)]">
          {finding.source}
        </div>
      </div>
      <span
        className={cn(
          'px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.06em] text-[#03070B]',
          SEVERITY_META[finding.severity].bg,
        )}
      >
        {SEVERITY_META[finding.severity].abbrev}
      </span>
    </li>
  )
}

/**
 * A small labelled fact above the lamp street.
 *
 * 11.5px on a phone rather than 10.5px. These are the only things on the
 * screen that carry the elapsed time and the step count, so they are read
 * often and at arm's length; the desktop size is kept from `sm` up, where the
 * viewing distance is longer but the pixel density is lower.
 */
function Meta({ children }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span className="border border-border bg-card px-2 py-1 font-mono text-[11.5px] leading-snug text-[var(--dim)] sm:py-0.5 sm:text-[10.5px]">
      {children}
    </span>
  )
}

function Centred({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action: React.ReactNode
}) {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl">{title}</h1>
      <p className="max-w-md text-[14px] leading-relaxed text-[var(--dim)]">{body}</p>
      <div className="mt-2">{action}</div>
    </main>
  )
}
