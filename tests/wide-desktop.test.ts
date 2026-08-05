import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Wide desktop, from Part 3 session 3A.
 *
 * Rendered at 1440, 1920 and 2560: zero horizontal overflow everywhere, no
 * console errors, and the hero scene survives ultrawide with the moon, the
 * Bat-Signal and the skyline all in place. Two composition defects were found
 * and are pinned below.
 */
const root = join(__dirname, '..')
const bar = readFileSync(join(root, 'components/scan/stage-bar.tsx'), 'utf8')
const barCss = readFileSync(join(root, 'app/globals.css'), 'utf8')
const chrome = [
  'components/site-header.tsx',
  'components/hero/hero-screen.tsx',
  'components/scan/scan-header.tsx',
  'components/results/report-header.tsx',
  'components/site-footer.tsx',
].map((f) => [f, readFileSync(join(root, f), 'utf8')] as const)

describe('the wall needs no breakpoint grid', () => {
  it('is one flex row, so it fits any width without a column count', () => {
    /*
     * Replaces the lamp grid, which needed grid-cols-2 / md:3 / lg:5 and had
     * to avoid 8 across because 15 lamps laid out 8 + 7 left a hole. Blocks
     * are `flex-1` and simply get narrower, so there is no breakpoint to get
     * wrong and no arrangement that can leave a gap.
     */
    // Cells are `flex: 1 1 0` in `.stage-cell`, so they simply get narrower.
    expect(barCss).toContain('flex: 1 1 0')
    expect(bar).not.toContain('grid-cols-')
  })

  it('scales to any stage count, not just fifteen', () => {
    // quick = 7 stages, standard = 11, comprehensive = 15.
    expect(bar).toContain('timeline.map(')
  })
})

describe('chrome spans the window, reading columns do not', () => {
  it('widens every bar past the 2xl breakpoint', () => {
    /*
     * Every container was capped at 1180px, so at 2560 the logo sat 690px in
     * from the edge with nothing beside it and the bar read as marooned. A
     * header is chrome, not prose: it has no measure to protect. Gutters are
     * now 480px at 2560, and 1440 is unchanged.
     */
    for (const [file, src] of chrome) {
      expect(src, file).toContain('2xl:max-w-[1600px]')
      expect(src, file).toContain('2xl:px-10')
    }
  })

  it('still bounds the chrome rather than going full width', () => {
    // On a 3440px ultrawide, a logo and its actions at opposite edges stop
    // reading as one object.
    for (const [file, src] of chrome) {
      expect(src, file).not.toContain('2xl:max-w-full')
    }
  })

  it('leaves the body measure alone', () => {
    // Long prose lines are genuinely harder to read, so the reading columns
    // keep their cap. Only the bars grew.
    const page = readFileSync(join(root, 'app/page.tsx'), 'utf8')
    expect(page).toContain('max-w-[1180px]')
    expect(page).not.toContain('2xl:max-w-[1600px]')
  })
})
