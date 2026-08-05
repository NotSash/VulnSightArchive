import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The results page on a phone.
 *
 * The report is roughly 7,800px tall at 390px and the section sidebar is
 * `hidden lg:block`, so reaching the CVE list meant scrolling past everything
 * above it. There was no way to jump between sections at all.
 *
 * Source-level assertions: these are sticky-positioning and grid-sizing
 * concerns, and jsdom has no layout engine, so a rendered test would pass
 * while the bar was unstuck and the page 432px too wide. Both of those
 * actually happened during this session and were caught in Chromium.
 */
const root = join(__dirname, '..')
const nav = readFileSync(join(root, 'components/results/report-nav.tsx'), 'utf8')
const view = readFileSync(join(root, 'components/results/results-view.tsx'), 'utf8')
const vulns = readFileSync(join(root, 'components/results/vulnerabilities-section.tsx'), 'utf8')
const header = readFileSync(join(root, 'components/results/report-header.tsx'), 'utf8')

describe('mobile section bar', () => {
  it('renders as one of two explicit variants', () => {
    /*
     * They cannot come from one call site. The sidebar must live in the
     * `aside` and the bar must live in `main`, for the sticky reason below,
     * so a single component rendering both put two copies in the document.
     */
    expect(nav).toContain("variant: 'sidebar' | 'bar'")
    expect(view).toContain('variant="sidebar"')
    expect(view).toContain('variant="bar"')
  })

  it('puts the phone bar inside main, not the aside', () => {
    /*
     * A sticky element can never outlive its containing block. The `aside` is
     * only as tall as its own content, 61px on a phone, so the bar stuck for
     * 61 pixels and then scrolled away with its parent. `main` spans the whole
     * report, which is the distance the bar needs to stay pinned for.
     * Measured after the move: pinned at top=124 at scrollY 300 and 900.
     */
    const mainStart = view.indexOf('<main')
    const asideStart = view.indexOf('<aside')
    const barCall = view.indexOf('variant="bar"')
    expect(barCall).toBeGreaterThan(mainStart)
    expect(mainStart).toBeGreaterThan(asideStart)
  })

  it('parks under the report header at both header heights', () => {
    // 124px on a phone, where the export actions wrap to a second row; 69px
    // from sm up, where they sit beside the domain.
    expect(nav).toContain('top-[124px]')
    expect(nav).toContain('sm:top-[69px]')
  })

  it('scrolls horizontally rather than widening the page', () => {
    /*
     * `min-w-0` is load-bearing. A grid item defaults to `min-width: auto`,
     * meaning "at least as wide as my content", and a row of non-wrapping
     * chips is very wide content: the column grew to fit them and dragged the
     * whole page 432px sideways instead of scrolling inside the bar.
     */
    expect(nav).toContain('overflow-x-auto')
    expect(nav).toContain('min-w-0')
  })

  it('gives every chip a 44px target', () => {
    expect(nav).toContain('min-h-11')
  })

  it('marks the current section for assistive tech, not just colour', () => {
    expect(nav).toContain("aria-current={active === section.id ? 'location' : undefined}")
  })

  it('is hidden from print and from desktop', () => {
    expect(nav).toContain('lg:hidden print:hidden')
  })
})

describe('anchor offsets', () => {
  it('clears the phone header, which is taller than the desktop one', () => {
    /*
     * `scroll-mt-24` is 96px and the phone header is 124px, so jumping to a
     * section put its heading 28px behind the header. Measured before:
     * section top 96, header bottom 124, heading hidden.
     */
    expect(view).toContain('scroll-mt-[132px]')
    expect(view).toContain('sm:scroll-mt-24')
  })
})

describe('results page touch targets', () => {
  it('gives Show more a 44px target', () => {
    // Was 358x39: full width and still 5px short.
    expect(vulns).toContain('min-h-11')
  })

  it('gives the inline URL link a real box', () => {
    // An inline element's box is only as tall as its text, so at 12px this
    // was an 18px target on a tablet.
    expect(header).toContain('min-h-11 items-center truncate')
    expect(header).toContain('sm:inline-flex')
  })
})
