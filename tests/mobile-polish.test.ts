import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Touch, type and polish on a phone.
 *
 * Source-level assertions: these are computed-style and media-query concerns,
 * and jsdom resolves neither. Every claim below was measured in Chromium
 * against the real production stylesheet.
 */
const root = join(__dirname, '..')
const css = readFileSync(join(root, 'app/globals.css'), 'utf8')
const form = readFileSync(join(root, 'components/scan/scan-form.tsx'), 'utf8')
const header = readFileSync(join(root, 'components/site-header.tsx'), 'utf8')
const pipeline = readFileSync(join(root, 'components/home/pipeline.tsx'), 'utf8')
const crt = readFileSync(join(root, 'components/crt-console.tsx'), 'utf8')

describe('iOS Safari focus zoom', () => {
  /*
   * Safari zooms the whole page in when a field smaller than 16px takes focus,
   * and does not zoom back out. The scan input was 15px: one pixel short, on
   * the primary control of the product, so every iPhone visitor began their
   * first scan by fighting the zoom.
   */
  it('gives the scan input at least 16px on touch devices', () => {
    expect(form).toContain('text-[16px]')
    expect(form).toContain('lg:text-[15px]')
  })

  it('gives the docked header input the same floor', () => {
    expect(header).toContain('text-[16px]')
    expect(header).toContain('lg:text-[12.5px]')
  })
})

describe('touch targets released at lg, not sm', () => {
  /*
   * The first pass released the mobile sizing at `sm` (640px), which meant a
   * 768px tablet fell back to desktop targets: the audit went clean on phones
   * and still failed on tablet. A tablet is a touch device.
   */
  it('holds the example chips at 44px through tablet width', () => {
    expect(form).toContain('min-h-11')
    expect(form).toContain('lg:min-h-0')
    expect(form).not.toContain('sm:min-h-0')
  })

  it('holds the sample-report link at 44px through tablet width', () => {
    expect(crt).toContain('min-h-11')
    expect(crt).toContain('lg:min-h-0')
  })

  it('holds the pipeline bar at 44px tall through tablet width', () => {
    expect(pipeline).toContain('h-11')
    expect(pipeline).toContain('lg:h-8')
  })
})

describe('touch target on an element whose size is data', () => {
  /*
   * The pipeline segments are proportional to how long each tool actually
   * took, so a 2 second stage against a 223 second scan is genuinely 4 pixels
   * wide. Widening it would invent a timing on a chart whose whole purpose is
   * to be truthful. The drawn width stays; an overlaid `::after` supplies the
   * hit area. Proven against the production stylesheet: a 4px segment
   * measures 4x44 drawn and 44x44 hittable.
   */
  it('defines the helper', () => {
    expect(css).toContain('.touch-target::after')
    expect(css).toContain('min-width: 44px')
    expect(css).toContain('min-height: 44px')
  })

  it('applies it only to coarse pointers', () => {
    // On a desktop the expanded areas of adjacent segments would overlap and
    // steal each other's hover.
    expect(css).toContain('@media (hover: none) and (pointer: coarse)')
  })

  it('is used by the pipeline segments', () => {
    expect(pipeline).toContain('touch-target')
  })
})

describe('the mobile type floor', () => {
  /*
   * 106 call sites across five sizes below 12px. Patching each would be the
   * wrong shape of fix: this is one decision about the smallest readable size
   * on a touch device. Measured after: on a phone 9.5 -> 12, 10 -> 12.5,
   * 10.5 -> 13, 11 -> 13.5; on desktop every size is unchanged.
   *
   * An earlier pass put the smallest step at 11.5px, which was still under the
   * 12px threshold and merely moved the problem half a pixel. 12px is the
   * floor, so the smallest step lands exactly on it.
   */
  it('lifts every small step clear of the 12px floor', () => {
    const block = css.slice(css.indexOf('The mobile type floor'))
    expect(block).toContain('@media (pointer: coarse)')
    for (const size of ['12px', '12.5px', '13px', '13.5px']) {
      expect(block).toContain(`font-size: ${size}`)
    }
    // Nothing in the block may land below the floor.
    const sizes = [...block.matchAll(/font-size: ([\d.]+)px/g)].map((m) => Number(m[1]))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12)
  })

  it('reaches SVG labels, which carry their size as a style not a class', () => {
    // No class rule can touch an SVG `fontSize`, so the plot reads a custom
    // property that the same media query redefines.
    expect(css).toContain('--plot-label: 12px')
  })

  it('keys off pointer type, not viewport width', () => {
    /*
     * This is about how far the screen is from the eye and how precise the
     * input is, not how many pixels wide it is. A 768px tablet needs it; a
     * 768px browser window on a desktop does not.
     */
    const block = css.slice(
      css.indexOf('The mobile type floor'),
      css.indexOf('A comfortable touch target'),
    )
    expect(block).not.toMatch(/min-width:\s*\d+px/)
  })

  it('preserves hierarchy rather than flattening every size to one', () => {
    // A 9.5px eyebrow above an 11px label must stay smaller than it. Lifting
    // both to 12px would erase the distinction the sizes were chosen to make.
    const block = css.slice(css.indexOf('The mobile type floor'))
    const sizes = [...block.matchAll(/font-size: ([\d.]+)px/g)].slice(0, 4).map((m) => Number(m[1]))
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
    expect(new Set(sizes).size).toBeGreaterThan(1)
  })
})

describe('viewport height', () => {
  it('uses dvh with a vh fallback for older iOS', () => {
    // `100vh` does not account for the address bar. `dvh` does, but iOS Safari
    // before 15.4 does not know it and would collapse the section to `auto`.
    expect(css).toContain('height: 100vh')
    expect(css).toContain('@supports (height: 100dvh)')
  })
})
