'use client'

import { cn } from '@/lib/utils'
import type { TimelineEvent } from '@/types/report'

/**
 * The scan as one segmented bar: a pixel readout, not a web progress bar.
 *
 * One segment per real stage, laid on a recessed track. A settled segment
 * fills solid phosphor and carries a scanline texture plus a bright top
 * highlight, so it reads as a lit cell rather than a coloured rectangle. The
 * running segment is amber and pulses under a travelling sweep. Queued
 * segments are empty wells.
 *
 * **Why there is no percentage.** A stage has no knowable midpoint: nobody can
 * say how far through an Nmap run they are. The only figure the backend truly
 * has is how many stages have settled, so that is the only figure shown. The
 * sweep is what says "work is happening here" without inventing a number.
 *
 * **Why segments and not a single fill.** A continuous fill would have to
 * interpolate inside a stage, which is the same lie in a smoother form. A
 * segment is a fact: it is lit or it is not.
 */

export interface StageBarProps {
  timeline: TimelineEvent[]
  /** Index of the stage currently running, or -1 when none is. */
  liveIndex: number
  className?: string
}

type CellState = 'done' | 'live' | 'todo' | 'skipped'

function stateFor(event: TimelineEvent, i: number, liveIndex: number): CellState {
  if (event.status === 'skipped') return 'skipped'
  if (event.status === 'completed') return 'done'
  if (i === liveIndex) return 'live'
  return 'todo'
}

export function StageBar({ timeline, liveIndex, className }: StageBarProps) {
  if (timeline.length === 0) {
    /*
     * Before the first poll the stage count is unknown. An empty track is
     * honest; inventing fifteen cells would be guessing at the shape of a
     * scan that has not reported yet.
     */
    return <div className={cn('stage-track h-[26px]', className)} aria-hidden="true" />
  }

  return (
    <div
      /*
       * Decorative. The same progress is published once as a real
       * `progressbar` in `scan-progress.tsx`, and spoken through the live
       * region there. Exposing every cell would make a screen reader recite
       * the whole bar on each 1.2s poll.
       */
      aria-hidden="true"
      className={cn('stage-track flex gap-[3px] p-[3px]', className)}
    >
      {timeline.map((event, i) => {
        const state = stateFor(event, i, liveIndex)
        return (
          <span
            key={event.event}
            className={cn(
              'stage-cell',
              state === 'done' && 'stage-cell-done',
              state === 'live' && 'stage-cell-live',
              state === 'skipped' && 'stage-cell-skipped',
            )}
            style={
              /*
               * Stagger the ignition so a burst of fast stages lights up as a
               * run rather than all at once. Capped: a 15 stage scan should
               * not have a delay long enough to look broken.
               */
              state === 'done' ? { animationDelay: `${Math.min(i * 45, 420)}ms` } : undefined
            }
          />
        )
      })}
    </div>
  )
}
