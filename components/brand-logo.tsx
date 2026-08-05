'use client'

import styled, { keyframes } from 'styled-components'
import { cn } from '@/lib/utils'

/**
 * The mark is a waveform on a phosphor square, the same signal the console
 * plots. It reads as "instrument" rather than "shield", which is the one visual
 * cliche every security product reaches for.
 *
 * The trace animates using the technique from Uiverse `chilly-swan-51` by
 * milley69: two copies of the same polyline, a dim one always visible and a
 * bright one whose dash window is swept along the path, so a pulse appears to
 * run through the line. The original is a single-peak medical heartbeat; this
 * keeps the existing VulnSight waveform, which already has the two peaks and
 * one trough the brand uses.
 *
 * Measured for the sweep: the polyline is 28.497 units long in a 17x17 viewBox,
 * computed segment by segment, so the offsets below are derived rather than
 * guessed.
 */

/** The VulnSight waveform: flat, peak, trough, peak, flat. */
const WAVE = '2,11 5,11 6.6,5.5 8.5,13.5 10.2,8.5 11.6,11 15,11'

/*
 * The dash enters at the left, crosses the whole waveform, and exits at the
 * right. The gap is far longer than the path so the pattern never repeats and
 * exactly one pulse exists; the original uses the same trick with `48, 144`.
 * An earlier version set the gap to the path length, which let a second dash
 * enter while the first was still crossing and left the pulse invisible for
 * most of the cycle.
 */
const trace = keyframes`
  0% {
    stroke-dashoffset: 9;
    opacity: 1;
  }
  72.5% {
    opacity: 1;
  }
  100% {
    stroke-dashoffset: -28.497;
    opacity: 0;
  }
`

const Mark = styled.span`
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  background: var(--phos);
  box-shadow: 3px 3px 0 rgb(3 7 11 / 85%);

  polyline {
    fill: none;
    stroke: #03070b;
    /*
     * The viewBox is cropped to the waveform's own bounds rather than the full
     * 17x17 square, so the trace fills the tile instead of floating in it. The
     * stroke is scaled down to match, or the heavier zoom would thicken it.
     */
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The resting trace, always visible so the mark never looks broken. */
  polyline.back {
    stroke-opacity: 0.28;
  }

  polyline.front {
    stroke-dasharray: 9 999;
    stroke-dashoffset: 9;
    animation: ${trace} 1.4s linear infinite;
  }

  /* Motion here is decorative, so it is dropped entirely when asked. */
  @media (prefers-reduced-motion: reduce) {
    polyline.front {
      animation: none;
      stroke-dasharray: none;
      stroke-dashoffset: 0;
      opacity: 1;
    }
    polyline.back {
      display: none;
    }
  }
`

export function BrandLogo({
  className,
  showName = true,
}: {
  className?: string
  showName?: boolean
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <Mark>
        <svg width="22" height="22" viewBox="1 4 15 11" fill="none" aria-hidden="true">
          <polyline className="back" points={WAVE} />
          <polyline className="front" points={WAVE} />
        </svg>
      </Mark>
      {showName && (
        <span className="font-display text-[19px] leading-none tracking-[0.01em]">VulnSight</span>
      )}
    </span>
  )
}
