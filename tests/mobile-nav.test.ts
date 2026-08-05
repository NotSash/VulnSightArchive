import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A phone had no navigation at all.
 *
 * The audit measured **0 of 6 nav links visible at 390px**: the header menu is
 * `hidden lg:flex` and the docked scan form is `hidden ... lg:flex`, so on a
 * phone there was no way to reach "Why trust it", "How it works" or "What it
 * won't do", and no way to start a scan once the hero had scrolled away.
 *
 * Source-level assertions, because these are CSS positioning and stacking
 * concerns that jsdom cannot model: it has no layout engine, so a rendered
 * test would pass while the sheet was invisible in a real browser. That is not
 * hypothetical here, it is exactly what happened: the first version rendered
 * correctly in the tree and was clipped to nothing on screen. Behaviour was
 * verified in Chromium instead.
 */
const root = join(__dirname, '..')
const nav = readFileSync(join(root, 'components/mobile-nav.tsx'), 'utf8')
const header = readFileSync(join(root, 'components/site-header.tsx'), 'utf8')
const hero = readFileSync(join(root, 'components/hero/hero-screen.tsx'), 'utf8')
const ctx = readFileSync(join(root, 'components/scan/scan-bar-context.tsx'), 'utf8')

describe('mobile navigation', () => {
  it('exists on both bars, since each owns a different part of the page', () => {
    // The hero's bar is what a phone visitor meets first, and the real header
    // is deliberately parked off screen until the artwork scrolls away.
    expect(header).toContain('<MobileNav')
    expect(hero).toContain('<MobileNav')
  })

  it('is hidden exactly where the real nav appears', () => {
    expect(nav).toContain("cn('lg:hidden', className)")
  })

  it('portals to the body', () => {
    /*
     * Not cosmetic. The hero is `relative isolate ... overflow-hidden` and the
     * header is `backdrop-blur`; both create containing blocks, and
     * `position: fixed` resolves against the nearest one rather than the
     * viewport. Rendered in place, the sheet was clipped by the hero and
     * painted inside its stacking context, so the artwork showed through the
     * panel and the scrim covered nothing.
     */
    expect(nav).toContain('createPortal')
    expect(nav).toContain('document.body')
  })

  it('guards the portal behind a mounted flag', () => {
    // `createPortal` cannot run during SSR, and rendering the panel on the
    // server but not on the client is a hydration mismatch.
    expect(nav).toContain('const [mounted, setMounted] = useState(false)')
  })

  it('gives the trigger a 44px target', () => {
    expect(nav).toContain('size-11')
  })

  it('gives each row a native list-row height', () => {
    expect(nav).toContain('min-h-14')
  })

  it('closes on Escape and hands focus back to the trigger', () => {
    // Without the focus return, dismissing the sheet strands a keyboard user
    // at the top of the document.
    expect(nav).toContain("e.key !== 'Escape'")
    expect(nav).toContain('buttonRef.current?.focus()')
  })

  it('closes when the viewport grows past the breakpoint', () => {
    // Rotating a phone can cross `lg`. Leaving the sheet open over a header
    // that now has its own visible menu is two navigations at once.
    expect(nav).toContain("matchMedia('(min-width: 1024px)')")
  })

  it('locks page scroll while open, and restores the previous value', () => {
    expect(nav).toContain('const previous = document.body.style.overflow')
    expect(nav).toContain('document.body.style.overflow = previous')
  })

  it('is inert while closed, not merely transparent', () => {
    // An invisible but tabbable sheet still takes keyboard focus and is still
    // announced by a screen reader.
    expect(nav).toContain('inert={!open}')
  })

  it('hands its footer a close callback', () => {
    // Whatever sits there navigates or scrolls, so a sheet left open over the
    // destination is the most obvious possible bug.
    expect(nav).toContain('children?: (close: () => void) => React.ReactNode')
    expect(nav).toContain('children(() => setOpen(false))')
  })

  it('carries a scan control, not just links', () => {
    // Navigation is secondary here. "Let me scan something" is the one thing
    // the site is for, and it was unreachable after scrolling.
    expect(header).toContain('Scan a site')
    expect(hero).toContain('Scan a site')
  })
})

describe('focusing the hero form', () => {
  it('waits for the smooth scroll to settle before focusing', () => {
    /*
     * Focusing an off-screen input makes the browser jump to it, which fights
     * the smooth scroll already in flight: some engines cancel the scroll,
     * others drop the focus. Measured on a phone before the fix, the input
     * arrived on screen but was not focused, so the keyboard never opened.
     * Measured after: focused by 500ms and it holds.
     */
    expect(ctx).toContain('setTimeout(() => input.focus({ preventScroll: true })')
  })
})
