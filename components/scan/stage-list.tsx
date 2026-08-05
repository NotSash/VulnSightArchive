'use client'

import { channelForStage } from '@/lib/scanner/channels'
import { cn } from '@/lib/utils'
import type { TimelineEvent } from '@/types/report'

/**
 * Every check in the scan, in order, with what it actually found.
 *
 * The detail line under each finished stage is the point of this list. It is
 * not decoration: "Port 80 open, port 443 closed" is the evidence behind a
 * finding, shown at the moment it is produced rather than only in the report.
 * It comes from `TimelineEvent.detail`, which the scanner has always emitted.
 *
 * Four states, and they must stay visually distinct without relying on colour
 * alone, because colour on this site means severity or agreement:
 *
 *   done     phosphor tick in a lit chip, timestamp on the right
 *   live     amber index in a pulsing chip, animated ellipsis
 *   skipped  hatched chip and a struck-through name, with the reason
 *   todo     dim index, no chip, no time
 */

export interface StageListProps {
  timeline: TimelineEvent[]
  liveIndex: number
  className?: string
}

export function StageList({ timeline, liveIndex, className }: StageListProps) {
  if (timeline.length === 0) return null

  return (
    <ol className={cn('divide-y divide-border', className)}>
      {timeline.map((event, i) => {
        const skipped = event.status === 'skipped'
        const done = event.status === 'completed'
        const live = !done && !skipped && i === liveIndex
        const channel = channelForStage(event.event)

        return (
          <li
            key={event.event}
            className={cn(
              'stage-row grid grid-cols-[26px_1fr_auto] items-start gap-3 px-3.5 py-3',
              live && 'stage-row-live',
            )}
          >
            {/* The marker. A chip when the stage has a result, bare when not. */}
            <span
              className={cn(
                'mt-[1px] grid h-[22px] w-[22px] shrink-0 place-items-center font-mono text-[10px] font-bold leading-none',
                done && 'bg-phos text-[#03070B]',
                live && 'stage-chip-live bg-amber text-[#03070B]',
                skipped && 'stage-chip-skipped text-[var(--dim-2)]',
                !done && !live && !skipped && 'text-[var(--dim-2)]',
              )}
            >
              {done ? (
                // A tick, drawn rather than an icon font: it stays crisp at 22px.
                <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                  <title>Finished</title>
                  <path
                    d="M2 6.4 4.7 9 10 3.2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="square"
                  />
                </svg>
              ) : (
                String(i + 1).padStart(2, '0')
              )}
            </span>

            <div className="min-w-0">
              <p
                className={cn(
                  'text-[14px] leading-snug',
                  live && 'font-semibold text-amber',
                  done && 'text-foreground',
                  skipped && 'text-[var(--dim-2)] line-through decoration-[var(--dim-2)]/50',
                  !done && !live && !skipped && 'text-[var(--dim-2)]',
                )}
              >
                {event.event}
              </p>

              {/*
                What the stage found. Present for finished and skipped stages,
                because "could not run, and here is why" is as much a result as
                a measurement. Never invented: absent when the scanner did not
                report one.
              */}
              {event.detail && (
                <p className="mt-1 text-pretty text-[12.5px] leading-relaxed text-[var(--dim)]">
                  {event.detail}
                </p>
              )}

              {live && !event.detail && (
                <p className="mt-1 font-mono text-[11px] text-[var(--dim-2)]">
                  Working
                  <span className="stage-ellipsis" />
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2.5 pt-[3px]">
              <span className="hidden font-mono text-[9px] uppercase tracking-[0.09em] text-[var(--dim-2)] sm:inline">
                {channel}
              </span>
              {/*
                Only stages that actually ran carry a clock time.

                An earlier version printed a transparent `--:--:--` to hold the
                column width. That is invisible text in the accessibility tree
                and it failed the contrast audit at 1.09:1, which is the
                correct result: text you cannot read is still text. A reserved
                empty box does the same layout job with nothing to read.
              */}
              <span className="tnum inline-block min-w-[58px] text-right font-mono text-[10.5px] text-[var(--dim-2)]">
                {done ? event.time : ''}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
