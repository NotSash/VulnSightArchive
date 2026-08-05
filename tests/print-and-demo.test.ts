import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Print and demo mode, from Part 3 session 3F.
 *
 * Print was emulated on results and home and real A4 PDFs generated. The bones
 * were already right: colours invert to a white ground, the canvas and every
 * decorative surface disappear, the section bar and sidebar are hidden,
 * containers go full width, sections avoid breaking, and the hero collapses
 * instead of printing a blank first sheet.
 *
 * Three contrast defects were found by measuring with the WCAG formula against
 * the production stylesheet, and are pinned below.
 */
const root = join(__dirname, '..')
const css = readFileSync(join(root, 'app/globals.css'), 'utf8')
const print = css.slice(css.indexOf('@media print'))

describe('3F-1: body copy printed at 2.42:1', () => {
  it('overrides the dim greys for paper', () => {
    /*
     * `--dim` and `--dim-2` are tuned for a near-black ground and were not
     * reset in the print block, so body copy printed as `rgb(147,170,185)` on
     * white: 2.42:1 against a 4.5 minimum, close to unreadable at 300dpi.
     *
     * Measured after, against the production stylesheet: body copy 8.88:1,
     * secondary 5.78:1.
     */
    expect(print).toContain('--dim: #414b56')
    expect(print).toContain('--dim-2: #5b6773')
  })
})

describe('3F-2: panel headers printed as dark bars', () => {
  it('flattens the header ground and darkens its text', () => {
    /*
     * `PanelHeader` carries `bg-[#03070B]/55`, which none of the existing
     * resets matched, so "HOW THE SCORE WAS REACHED" printed as a solid grey
     * band with pale text: unreadable, and a strip of toner on every panel.
     * On paper a rule under the header is enough. Measured after: 17.76:1.
     */
    expect(print).toContain("[data-slot='panel-header']")
    expect(print).toContain("[class*='bg-[#03070B]']")
    expect(print).toContain('border-bottom: 1px solid #d8dce1 !important')
  })
})

describe('3F-3: phosphor green printed on white', () => {
  it('darkens the accent rather than dropping it', () => {
    /*
     * `rgb(103,232,176)` glows on black and all but vanishes on paper, and it
     * is load-bearing here: it marks scanner agreement on "4 TOOLS" and "MORE
     * THAN ONE TOOL AGREED", so losing it loses information rather than
     * decoration. Measured after: 5.35:1.
     */
    expect(print).toContain('--phos: #0f7a52')
    expect(print).toContain('--amber: #8a5a00')
  })

  it('keeps accent-filled surfaces legible too', () => {
    // A dark green fill with near-black text on it is worse than either.
    expect(print).toContain('.bg-phos')
    expect(print).toContain('background: #e8f5ef !important')
  })
})

describe('print structure that was already correct', () => {
  it('drops the canvas and decorative surfaces', () => {
    expect(print).toContain("[data-decorative='true']")
    expect(print).toContain('canvas')
  })

  it('hides the section nav and collapses the hero', () => {
    expect(print).toContain("nav[aria-label='Report sections']")
    expect(css).toContain('[data-hero-screen] {\n    height: auto !important;')
  })

  it('avoids breaking sections and orphaning headings', () => {
    expect(print).toContain('break-inside: avoid')
    expect(print).toContain('break-after: avoid')
  })
})
