import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The scan page on a phone.
 *
 * Measured at 390px before this session: the page was **1854px tall**, so the
 * one stage actually running was usually off screen on a list that exists to
 * be glanceable. `Stop scan` was 100x35, and every meta chip was 10.5px.
 *
 * Source-level assertions, because these are layout and typography concerns
 * that jsdom cannot evaluate: it has no layout engine and computes no styles
 * from Tailwind classes. The measurements come from Chromium.
 */
const root = join(__dirname, '..')
const bar = readFileSync(join(root, 'components/scan/stage-bar.tsx'), 'utf8')
const barCss = readFileSync(join(root, 'app/globals.css'), 'utf8')
const header = readFileSync(join(root, 'components/scan/scan-header.tsx'), 'utf8')
const progress = readFileSync(join(root, 'components/scan/scan-progress.tsx'), 'utf8')

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

describe('scan page text sizes on a phone', () => {
  it('keeps the wall legible without a phone-specific size', () => {
    /*
     * The lamp street needed three separate 10.5px -> lg:9.5px bumps because
     * its labels were full stage names. The wall shows a two-digit number per
     * block and names the stage on hover instead, so one size works
     * everywhere and there is no breakpoint to keep in sync.
     */
    // Cells are `flex: 1 1 0` in `.stage-cell`, so they simply get narrower.
    expect(barCss).toContain('flex: 1 1 0')
    expect(bar).not.toContain('grid-cols-')
  })

  it('lifts the meta chips and keeps the desktop size from sm', () => {
    expect(progress).toContain('text-[11.5px]')
    expect(progress).toContain('sm:text-[10.5px]')
  })
})

describe('scan page touch targets', () => {
  it('gives Stop scan a 44px target', () => {
    // Was 100x35. This is a destructive, irreversible action, so it is the
    // last control on the site that should be easy to hit by accident and
    // hard to hit on purpose.
    expect(header).toContain('min-h-11')
  })

  it('gives both confirmation choices a 44px target too', () => {
    // "Yes, stop" and "Keep going" are where the real decision is made.
    // Four in the file: the brand link, Stop scan, and the two choices.
    const targets = header.match(/min-h-11/g) ?? []
    expect(targets.length).toBe(4)
  })

  it('gives the brand link a 44px target without moving the mark', () => {
    // Same treatment as the site header and the report header: the negative
    // margin cancels the padding, so the hit area grows outward.
    expect(header).toContain('-m-2 flex min-h-11 shrink-0')
  })
})
