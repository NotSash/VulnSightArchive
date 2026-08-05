'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CoincidencePlot, SAMPLE_CHANNELS, SAMPLE_EVENTS } from '@/components/coincidence-plot'

/**
 * The signature element: a CRT workstation showing a real scan.
 *
 * The monitor tilts toward the cursor so it reads as a physical object rather
 * than a drawing. That is the whole reason it earns the space it takes — a flat
 * screenshot would not.
 *
 * It is explicitly labelled a sample and links to the full report. A security
 * tool has to prove it works before anyone will type their own domain in, but
 * showing example data without saying so would be its own small dishonesty.
 */
export function CrtConsole() {
  const stageRef = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [interactive, setInteractive] = useState(false)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const wide = window.matchMedia('(min-width: 1041px)')
    const update = () => setInteractive(!reduced.matches && wide.matches)
    update()
    reduced.addEventListener('change', update)
    wide.addEventListener('change', update)
    return () => {
      reduced.removeEventListener('change', update)
      wide.removeEventListener('change', update)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive) return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width - 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => setTilt({ x, y }))
    },
    [interactive],
  )

  const onLeave = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => setTilt({ x: 0, y: 0 }))
  }, [])

  return (
    /*
     * A <figure> rather than a <div>: this really is a self-contained
     * illustration with a caption, and it carries an implicit role, so the
     * decorative pointer tilt is not an interaction bolted onto a bare element.
     */
    <figure
      ref={stageRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="m-0"
      style={{ perspective: interactive ? 1100 : undefined }}
    >
      <div
        style={{
          transformStyle: 'preserve-3d',
          transform: interactive
            ? `rotateY(${(tilt.x * 7).toFixed(2)}deg) rotateX(${(-tilt.y * 5).toFixed(2)}deg)`
            : undefined,
          transition: 'transform var(--dur-base) var(--ease)',
        }}
      >
        {/* Bezel */}
        <div
          className="relative rounded-[15px] px-3.5 pt-3.5"
          style={{
            background:
              'linear-gradient(168deg, var(--bone) 0%, var(--bone-2) 68%, var(--bone-dk) 100%)',
            boxShadow:
              '0 30px 70px -24px rgba(0,0,0,.9), 0 0 0 1px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.5)',
          }}
        >
          {/* Glass */}
          <div
            className="scanlines relative overflow-hidden rounded-[7px] bg-screen"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.8), inset 0 0 42px rgba(0,0,0,.85)' }}
          >
            {/* Vignette */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[4]"
              style={{
                background:
                  'radial-gradient(ellipse 125% 135% at 50% 50%, transparent 52%, rgba(0,0,0,.62) 100%)',
              }}
            />
            {/* Specular sheen that slides as the monitor turns */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[6] opacity-50"
              style={{
                background:
                  'linear-gradient(105deg, transparent 30%, rgba(255,255,255,.07) 45%, rgba(255,255,255,.12) 50%, rgba(255,255,255,.05) 56%, transparent 70%)',
                transform: `translateX(${(tilt.x * 55).toFixed(1)}%)`,
                transition: 'transform var(--dur-base) var(--ease)',
              }}
            />

            <div className="relative z-[3] flex flex-wrap items-center justify-between gap-2.5 border-b border-phos/20 px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--dim)]">
              <span className="flex items-center gap-2">
                <span className="bg-amber px-1.5 py-0.5 font-bold text-[#03070B]">Sample</span>
                scanme.nmap.org
              </span>
              <span>
                <b className="font-medium text-phos">5</b> scanners &middot;{' '}
                <b className="tnum font-medium text-phos">223</b>s
              </span>
            </div>

            <div className="relative z-[1] px-3.5 pb-1.5 pt-4">
              <CoincidencePlot channels={SAMPLE_CHANNELS} events={SAMPLE_EVENTS} />
            </div>

            <div className="relative z-[3] flex flex-wrap items-center justify-between gap-3 border-t border-phos/20 px-3.5 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--dim-2)]">
              <span className="flex gap-3.5">
                <span className="flex items-center gap-1.5">
                  <i className="block size-2 border border-phos bg-phos" aria-hidden="true" />
                  2+ agree
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="block size-2 border border-[var(--dim-2)]" aria-hidden="true" />
                  only one saw it
                </span>
              </span>
              <Link
                href="/results/sample"
                className="press inline-flex min-h-11 items-center border border-phos/45 bg-phos/10 px-3 font-bold text-phos transition-colors hover:bg-phos hover:text-[#03070B] lg:min-h-0 lg:px-2.5 lg:py-1"
              >
                Open this report &rarr;
              </Link>
            </div>
          </div>

          {/* Chin */}
          <div className="flex items-center justify-between px-1.5 pb-2.5 pt-2.5">
            <span className="font-display text-[11px] tracking-[0.06em] text-bone-edge">
              VULNSIGHT CONSOLE
            </span>
            <span className="flex gap-1.5" aria-hidden="true">
              <i
                className="size-[7px] bg-phos"
                style={{ boxShadow: '0 0 5px rgba(103,232,176,.8)' }}
              />
              <i
                className="size-[7px] bg-phos"
                style={{ boxShadow: '0 0 5px rgba(103,232,176,.8)' }}
              />
              <i
                className="size-[7px] bg-amber"
                style={{ boxShadow: '0 0 5px rgba(255,180,84,.8)' }}
              />
            </span>
          </div>
        </div>

        <div
          className="mx-auto h-3.5 w-[92px] rounded-b-[3px]"
          style={{ background: 'linear-gradient(180deg, var(--bone-2), var(--bone-dk))' }}
          aria-hidden="true"
        />
        <div
          className="mx-auto h-2 w-[168px] rounded-[2px] bg-bone-dk"
          style={{ boxShadow: '0 14px 26px -8px rgba(0,0,0,.85)' }}
          aria-hidden="true"
        />
      </div>
      <figcaption className="sr-only">
        A sample VulnSight report for scanme.nmap.org, shown on a console display: five scanners
        plotted together, four weaknesses found by two or more of them.
      </figcaption>
    </figure>
  )
}
