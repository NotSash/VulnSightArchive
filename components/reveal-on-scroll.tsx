'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A section that rises into place the first time it is seen.
 *
 * Home had no entrance at all: `Triage`, `Pipeline`, `Evidence`, `Methodology`
 * and `Closing` simply appeared as static blocks. The results page had the
 * opposite problem, one `animate-rise` on the whole page, so the entire report
 * faded in as a single slab rather than resolving.
 *
 * Three rules this follows, all learned the hard way elsewhere in this project.
 *
 * **Reveal, never hide.** The element is visible by default and the animation
 * only ever moves it *toward* its resting state. A component that starts at
 * `opacity: 0` and waits for JavaScript is the exact bug Part 1 spent a
 * session fixing: with scripts off, or if the observer never fires, the
 * content is gone and nothing says so. Here the worst case is that the
 * animation does not play.
 *
 * **Once, then done.** The observer disconnects after the first intersection.
 * Sections that re-animate every time they scroll past are a well-known way to
 * make a long page feel restless.
 *
 * **Reduced motion opts out entirely**, rather than playing a shortened
 * version. The guard lives in `globals.css`, not on a `motion-safe:` prefix:
 * that variant is not emitted in this Tailwind setup, so the class matched no
 * rule at all and the animation silently never ran.
 */
export function RevealOnScroll({
  children,
  className,
  as: Tag = 'div',
  ...rest
}: {
  children: React.ReactNode
  className?: string
  as?: 'div' | 'section'
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    /*
     * `rootMargin` pulls the trigger line up from the bottom edge, so a
     * section starts moving as it enters rather than after it has already
     * arrived. Without it the animation plays behind the fold and the reader
     * scrolls onto a section that has finished moving.
     */
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setSeen(true)
        observer.disconnect()
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement & HTMLElement>}
      data-revealed={seen ? '' : undefined}
      className={cn(seen && 'animate-rise', className)}
      {...rest}
    >
      {children}
    </Tag>
  )
}
