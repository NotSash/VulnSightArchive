'use client'

import { useEffect, useRef, useState } from 'react'
import { RevealOnScroll } from '@/components/reveal-on-scroll'
import { cn } from '@/lib/utils'

/**
 * What actually runs, and where the four minutes go.
 *
 * This used to be a table with six small duration meters in their own column.
 * Six separate bars could not show the thing that matters most: one step is
 * more than two thirds of the entire wait. A single bar split by share does,
 * at a glance, and it is why someone watching Nuclei sit still for two minutes
 * does not conclude the scan has hung.
 *
 * Real durations from the reference scan `vs_amdym9f9p0`.
 */
const STEPS = [
  {
    n: 1,
    title: 'Look up the site',
    detail: 'DNS, redirects, headers, cookies, how traffic travels',
    tool: 'DNS + HTTP',
    time: '2s',
    share: 1,
  },
  {
    n: 2,
    title: 'Open it in a browser',
    detail: 'Real Chromium, screenshot, the page as it actually renders',
    tool: 'Chromium',
    time: '6s',
    share: 3,
  },
  {
    n: 3,
    title: 'Check which doors are open',
    detail: 'Top 3,000 ports, plus what software answers on each',
    tool: 'Nmap',
    time: '41s',
    share: 18,
  },
  {
    n: 4,
    title: 'Test known weaknesses',
    detail: 'Thousands of community checks, low through critical',
    tool: 'Nuclei',
    time: '154s',
    share: 69,
  },
  {
    n: 5,
    title: 'Read the traffic',
    detail: 'Watching only. Nothing is crawled and nothing is attacked',
    tool: 'ZAP',
    time: '3s',
    share: 2,
  },
  {
    n: 6,
    title: 'Match against known flaws',
    detail: 'Public CVE records for the versions found, then score it',
    tool: 'NVD',
    time: '4s',
    share: 2,
  },
]

/** Phosphor intensity tracks share, so the bar reads as one gradient of cost. */
const TONE = [
  'bg-[#1c4a3b]',
  'bg-[#22785e]',
  'bg-[#3ba883]',
  'bg-phos',
  'bg-[#22785e]',
  'bg-[#1c4a3b]',
]

/**
 * Which bars are light enough to need dark text on them.
 *
 * The label colour used to switch on `share > 50`, which is a proxy for
 * brightness rather than the thing itself, and it was wrong for Nmap: an 18%
 * bar painted `#3ba883` carried pale text at 2.61:1. Reading the tone instead
 * of the width fixes it and cannot drift when a duration changes.
 */
const LIGHT_TONE = [false, false, true, true, false, false]

export function Pipeline() {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: '-60px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <RevealOnScroll
      as="section"
      id="how"
      className="section-y mx-auto max-w-[1180px] scroll-mt-20 px-6"
    >
      <div className="max-w-[var(--measure)]">
        <p className="mb-3 font-mono text-[10.5px] font-bold uppercase tracking-[0.15em] text-phos">
          Under the hood
        </p>
        <h2>What runs, in order.</h2>
        <p className="prose-measure mt-5 text-[15.5px] text-[var(--dim)]">
          The real steps and real times from the scan above, as one bar split by where the time
          went. If a tool cannot run, the report says so rather than quietly leaving a hole.
        </p>
      </div>

      <div ref={ref} className="mt-12">
        {/*
          The bar is 44px tall on a phone rather than 32.
          
          Segment *widths* are the data: they are proportional to how long each
          tool actually took, so a 2 second stage against a 223 second total is
          genuinely 1% and cannot be widened without lying about the timings.
          Height is not data, so height is where the touch target comes from.
          The narrow segments stay narrow and honest, and every one of them is
          now at least 44px in the direction that is free to change.
        */}
        <div className="flex h-11 w-full gap-[2px] overflow-hidden lg:h-8">
          {STEPS.map((step, i) => (
            <button
              key={step.n}
              type="button"
              onMouseEnter={() => setHover(step.n)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(step.n)}
              onBlur={() => setHover(null)}
              aria-label={`${step.tool}, ${step.time} of 223 seconds`}
              className={cn(
                /*
                 * `touch-target` gives the narrow segments a 44px-wide
                 * invisible hit area, centred, without changing the drawn
                 * width. The widths ARE the data here: they are proportional
                 * to how long each tool actually took, so a 2 second stage
                 * against 223 seconds is genuinely 4 pixels and widening it
                 * would be inventing a timing. See `globals.css`.
                 */
                'touch-target relative flex items-center overflow-hidden outline-none transition-opacity',
                'focus-visible:ring-2 focus-visible:ring-phos focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                TONE[i],
                seen && 'budget-grow',
                hover !== null && hover !== step.n && 'opacity-45',
              )}
              style={{ width: `${step.share}%`, animationDelay: `${i * 70}ms` }}
            >
              {/* Only segments wide enough to hold text are labelled. Four of
                  the six are under 4% and their labels overlapped into mush. */}
              {step.share >= 15 && (
                <>
                  <span
                    className={cn(
                      'pl-3 font-mono text-[11px] font-bold',
                      LIGHT_TONE[i] ? 'text-[#03070B]' : 'text-foreground',
                    )}
                  >
                    {step.tool}
                  </span>
                  <span
                    className={cn(
                      'ml-auto pr-3 font-mono text-[11px] font-bold',
                      LIGHT_TONE[i] ? 'text-[#123026]' : 'text-[var(--dim)]',
                    )}
                  >
                    {step.time}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>

        <div className="mt-2.5 flex items-baseline justify-between gap-4 font-mono text-[9.5px] text-[var(--dim-2)]">
          <span>0s</span>
          <span className="text-center">the four short steps together are 15s of the 223</span>
          <span className="font-bold text-[var(--dim)]">223s total</span>
        </div>
      </div>

      <ol className="mt-12">
        {STEPS.map((step, i) => (
          <li
            key={step.n}
            className={cn(
              'flex flex-wrap items-baseline gap-x-5 gap-y-1 py-4 transition-colors sm:flex-nowrap',
              i > 0 && 'border-t border-border',
              hover === step.n && 'bg-card/60',
            )}
          >
            <span
              aria-hidden="true"
              className={cn('h-6 w-[3px] shrink-0', step.share > 50 ? 'bg-phos' : 'bg-[#1c4a3b]')}
            />
            <span className="tnum w-5 shrink-0 font-mono text-[11px] font-bold text-[var(--dim-2)]">
              {step.n}
            </span>
            <span className="min-w-[15em] flex-1">
              <span className="block text-[15px] font-semibold">{step.title}</span>
              <span className="mt-1 block text-[13px] leading-snug text-[var(--dim)]">
                {step.detail}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[11px] text-[var(--dim-2)]">{step.tool}</span>
            <span
              className={cn(
                'tnum w-14 shrink-0 text-right font-mono text-[12px] font-bold',
                step.share > 50 ? 'text-phos' : 'text-[var(--dim)]',
              )}
            >
              {step.time}
            </span>
          </li>
        ))}
      </ol>
    </RevealOnScroll>
  )
}
