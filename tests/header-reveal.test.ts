import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One navigation bar on screen at a time.
 *
 * The home page stacks a full-viewport artwork screen, which draws its own top
 * bar into the scene, on top of the working page, which has the real header.
 * Both show the same logo and the same menu.
 *
 * The header used to be `sticky`. A sticky element only pins once its own
 * scroll container reaches the top of the viewport, and this one's container
 * begins below the fold, so on the way down the bar travelled with the page and
 * appeared as a second navigation bar floating in the middle of the hero
 * artwork, while the hero's own bar was still visible above it. Measured at
 * 1440x900: at scrollY=400 the hero bar was on screen and the site header was
 * drawn at y=500.
 *
 * These are source-level assertions rather than render tests because the bug
 * was entirely a matter of CSS positioning and document flow, which jsdom does
 * not model: it has no layout engine, so a rendered test would have passed
 * happily while the real page was broken.
 */
const root = join(__dirname, '..')
const header = readFileSync(join(root, 'components/site-header.tsx'), 'utf8')
const reveal = readFileSync(join(root, 'components/use-header-reveal.ts'), 'utf8')
const home = readFileSync(join(root, 'app/page.tsx'), 'utf8')

describe('site header positioning', () => {
  it('is fixed, not sticky', () => {
    // `sticky` is what let it drift into the middle of the hero artwork.
    expect(header).toContain('fixed inset-x-0 top-0')
    expect(header).not.toMatch(/className=\{?["'`][^"'`]*sticky/)
  })

  it('is hidden and inert until revealed', () => {
    // Not merely transparent: an invisible but hittable bar would still take
    // keyboard focus and still be announced to a screen reader.
    expect(header).toContain('invisible')
    expect(header).toContain('-translate-y-full')
  })

  it('does not animate for someone who asked for less motion', () => {
    expect(header).toContain('motion-reduce:transition-none')
  })
})

describe('header reveal rule', () => {
  it('waits for the hero bar, not a hard-coded scroll distance', () => {
    // The hero has no fixed height: `min-h-[600px]` inside a viewport-sized
    // flex column means 900px on a laptop and 600px on a short window. A pixel
    // threshold would be correct on exactly one screen.
    expect(reveal).toContain('[data-hero-screen]')
    expect(reveal).toContain('[data-hero-chrome]')
    expect(reveal).toContain('getBoundingClientRect')
    expect(reveal).not.toMatch(/scrollY\s*>\s*\d{3}/)
  })

  it('reveals exactly when the hero bar has left the viewport', () => {
    expect(reveal).toContain('bottom <= 0')
  })

  it('defaults to visible, so a page with no hero is never bare', () => {
    // Also the no-JS fallback: with scripts off the effect never runs, and a
    // header that defaulted to hidden would stay hidden forever. This is the
    // same trap that made the coincidence plot invisible without JavaScript.
    expect(reveal).toContain('useState(true)')
  })

  it('listens passively and cleans up both listeners', () => {
    expect(reveal).toContain('passive: true')
    expect(reveal).toContain("removeEventListener('scroll'")
    expect(reveal).toContain("removeEventListener('resize'")
  })
})

describe('home page layout', () => {
  it('reserves the height the fixed header no longer occupies', () => {
    // `fixed` is out of flow, so without a spacer the first section slides up
    // underneath the bar the moment it reveals.
    expect(home).toContain('h-[62px] shrink-0')
  })
})
