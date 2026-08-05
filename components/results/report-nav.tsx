'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ai-summary', label: 'Executive summary' },
  { id: 'vulnerabilities', label: 'Vulnerabilities' },
  { id: 'technical', label: 'Technical' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'cves', label: 'CVEs' },
  { id: 'owasp', label: 'OWASP' },
  { id: 'timeline', label: 'Scan timeline' },
]

interface ReportNavProps {
  hasCoverage: boolean
  hasCves: boolean
  /**
   * Which of the two presentations to render.
   *
   * They cannot both come from one call site. The desktop sidebar lives in the
   * `aside`, which is only as tall as its own content, and a sticky element
   * can never outlive its containing block; the phone bar has to sit inside
   * `main`, which spans the whole report, or it unsticks after 61 pixels.
   * Rendering both from one place put two copies in the document.
   */
  variant: 'sidebar' | 'bar'
}

export function ReportNav({ hasCoverage, hasCves, variant }: ReportNavProps) {
  const [active, setActive] = useState('overview')

  const sections = useMemo(
    () =>
      SECTIONS.filter((section) => {
        if (section.id === 'coverage') return hasCoverage
        if (section.id === 'cves') return hasCves
        return true
      }),
    [hasCoverage, hasCves],
  )

  useEffect(() => {
    /*
     * Track the section nearest the top of the viewport.
     *
     * The previous version only ever *set* on `isIntersecting` and never
     * cleared, so the last section to fire stuck for the rest of the page: at
     * 4,600px of a 7,800px report the sidebar still said "Vulnerabilities".
     * It was also decided by callback order rather than position whenever two
     * sections intersected at once.
     *
     * Compounding it, the anchors are headings and measure 21px, while the
     * old `-20% 0px -70%` margin left a 90px detection band, so a target
     * often crossed it between frames and nothing was active at all.
     *
     * This keeps every observed entry in a map and recomputes the winner on
     * each callback: the last section whose top has passed the reading line.
     * That is well defined at every scroll position, including the gaps.
     * See AUDIT F1.
     */
    const elements = sections
      .map(({ id }) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return

    // A quarter down the viewport: the line a reader's eye actually follows.
    const readingLine = () => window.innerHeight * 0.25

    const pick = () => {
      const line = readingLine()
      let current = elements[0]
      for (const el of elements) {
        if (el.getBoundingClientRect().top <= line) current = el
        else break
      }
      /*
       * At the very bottom the last section may never reach the line, because
       * the page cannot scroll far enough. Whatever is closest to the bottom
       * of the viewport is what the reader is looking at.
       */
      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2
      if (atBottom) current = elements[elements.length - 1]
      setActive(current.id)
    }

    const observer = new IntersectionObserver(pick, {
      rootMargin: '0px',
      threshold: [0, 1],
    })
    for (const el of elements) observer.observe(el)

    /*
     * The observer alone is not enough: it fires only when an element crosses
     * the viewport edge, and the sections here are short anchors, so a slow
     * scroll through the middle of a long section produces no callbacks at
     * all. A passive scroll listener fills those gaps.
     */
    window.addEventListener('scroll', pick, { passive: true })
    window.addEventListener('resize', pick, { passive: true })
    pick()

    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', pick)
      window.removeEventListener('resize', pick)
    }
  }, [sections])

  if (variant === 'bar') {
    return (
      <>
        {/*
        The phone version: a horizontally scrolling bar of the same sections.

        The sidebar is `hidden lg:block`, so on a phone a 7,800px report had no
        way to jump between sections at all: reaching the CVE list meant
        scrolling past everything above it. A scrolling chip row is how a
        native app handles more tabs than fit, it costs one line of vertical
        space, and it keeps the section names rather than hiding them behind an
        icon.

        `top-[124px]` parks it directly under the report header, which is that
        tall on a phone once its actions wrap to a second row.
      */}
        <nav
          aria-label="Report sections"
          // Only one of the two navs is ever displayed, so they can share a
          // label: `lg:hidden` and `hidden lg:block` are exact complements.
          /*
           * `min-w-0` matters more than it looks.
           *
           * This sits inside a CSS grid, and a grid item's default minimum size
           * is `auto`, meaning "at least as wide as my content". A row of
           * non-wrapping chips is very wide content, so instead of the chips
           * scrolling inside a 390px bar, the bar itself grew to fit them and
           * dragged the whole page 432px sideways. `min-w-0` lets the item be
           * narrower than its content, which is what makes `overflow-x` on the
           * child actually scroll.
           */
          className="sticky top-[124px] z-30 -mx-4 min-w-0 border-b border-border bg-[#070C12]/92 backdrop-blur-xl sm:top-[69px] lg:hidden print:hidden"
        >
          {/*
          `scrollbar-none` would hide the only affordance telling you this
          scrolls, so instead the last chip is allowed to sit against the edge:
          a half-visible chip is the clearest possible "there is more here".
        */}
          <ul className="flex snap-x snap-mandatory gap-1 overflow-x-auto px-4 py-2">
            {sections.map((section) => (
              <li key={section.id} className="snap-start">
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? 'location' : undefined}
                  className={cn(
                    'flex min-h-11 items-center whitespace-nowrap border px-3 font-mono text-[12px] transition-colors',
                    active === section.id
                      ? 'border-phos bg-phos/10 font-bold text-phos'
                      : 'border-border bg-card text-[var(--dim)]',
                  )}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </>
    )
  }

  return (
    <nav aria-label="Report sections" className="sticky top-24 hidden lg:block">
      <p className="mb-3 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        On this page
      </p>
      <ul className="space-y-0.5">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? 'location' : undefined}
              className={cn(
                'block border-l-2 px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                active === section.id
                  ? 'border-primary bg-secondary/60 font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
              )}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
