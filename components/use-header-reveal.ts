'use client'

import { useEffect, useState } from 'react'

/**
 * Whether the fixed site header should be on screen.
 *
 * The home page shows a full-viewport artwork screen first, and that screen has
 * its own top bar drawn into the scene. The working page below it has the real
 * header. Both carry the same logo and the same menu, so the moment they are
 * ever visible together the page looks broken: two identical navigation bars,
 * one of them floating in the middle of a picture.
 *
 * The rule is therefore simple and absolute: **the real header appears only
 * once the hero's own bar is gone.** Not when the hero is partly scrolled, not
 * on a scroll-direction heuristic. Gone.
 *
 * Measured against the hero element rather than a hard-coded pixel value,
 * because the hero is `min-h-[600px]` on a viewport-sized flex column and so
 * has no fixed height: it is 900px on a laptop and 600px on a short window.
 * A magic number would be correct on exactly one screen.
 *
 * On every page that has no hero, there is nothing to wait for and the header
 * is simply always visible.
 */
export function useHeaderReveal(): boolean {
  /*
   * Starts true so that a page without a hero renders its header on the very
   * first paint, with no flash of missing chrome. The effect below corrects
   * this to false immediately if a hero is present, before the browser has
   * painted, because `useLayoutEffect` semantics are not needed here: the hero
   * occupies the whole viewport at scroll 0, so the header is off screen at
   * that moment anyway and the correction is never visible.
   */
  const [revealed, setRevealed] = useState(true)

  useEffect(() => {
    const hero = document.querySelector('[data-hero-screen]')
    if (!hero) return

    /*
     * Reveal once the hero's *own* bar has left the viewport.
     *
     * The hero bar sits at the very top of the hero and is 62px tall, the same
     * height as this header. Waiting for the whole hero to leave would be too
     * late: the header would only arrive after a full screen of the working
     * page had already scrolled by with no navigation at all. Waiting for the
     * hero bar's bottom edge is exactly right, and it is the same instant the
     * hero bar stops being visible, so the handover is seamless.
     */
    const update = () => {
      const bar = hero.querySelector('[data-hero-chrome]')
      const bottom = bar ? bar.getBoundingClientRect().bottom : hero.getBoundingClientRect().bottom
      setRevealed(bottom <= 0)
    }

    update()
    // `passive` because this never calls preventDefault, which lets the
    // browser keep scrolling on the compositor instead of waiting for us.
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return revealed
}
