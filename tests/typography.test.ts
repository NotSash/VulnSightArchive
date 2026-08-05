import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Typography rhythm, from Part 4 session 4B.
 *
 * Before: seven prose measures including 52em, six ways of writing a 1.6-ish
 * leading, and five home sections with three different vertical paddings, two
 * of which had been tuned by eye against whatever happened to precede them.
 *
 * Verified against the production stylesheet: prose measures **64 characters
 * per line** at 15.5px, leading resolves to 1.65, every section pads to 88px,
 * and a continued section pads to 0 on top.
 */
const root = join(__dirname, '..')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const css = strip(readFileSync(join(root, 'app/globals.css'), 'utf8'))
const home = ['triage', 'pipeline', 'evidence', 'methodology', 'closing'].map(
  (f) => [f, readFileSync(join(root, `components/home/${f}.tsx`), 'utf8')] as const,
)

describe('4B-3: the prose measure', () => {
  it('is one token, not seven ad-hoc widths', () => {
    expect(css).toContain('--measure: 36em')
    expect(css).toContain('--measure-tight: 28em')
  })

  it('lands inside the readable range', () => {
    /*
     * 36em, not the 44em first tried. `em` is relative to font size, not to
     * character width: Inter at 15.5px averages 7.8px per character, so 44em
     * measured 87 characters per line in the browser, well past the 75
     * ceiling. 36em measures 64. The lesson is that an `em` measure has to be
     * checked in a browser, because the conversion depends on the typeface.
     */
    const m = css.match(/--measure:\s*([\d.]+)em/)
    expect(m).not.toBeNull()
    expect(Number(m?.[1])).toBeLessThanOrEqual(38)
  })

  it('leaves no oversized measure behind', () => {
    for (const [name, src] of home) {
      expect(strip(src), name).not.toContain('max-w-[52em]')
      expect(strip(src), name).not.toContain('max-w-[46em]')
    }
  })
})

describe('4B-4: leading', () => {
  it('is one token for prose', () => {
    // Six near-identical values were in use: 1.6, 1.62, 1.65, 1.68, 1.7 and
    // `leading-relaxed`, differing by amounts no reader can perceive.
    expect(css).toContain('--leading-prose: 1.65')
    expect(css).toContain('line-height: var(--leading-prose)')
  })
})

describe('4B-2: section rhythm', () => {
  it('is a single token applied to every home section', () => {
    /*
     * They used py-20, py-24, pb-20, py-20 and pb-24/pt-2. Applying the gap to
     * the section itself means reordering the page cannot break its rhythm,
     * which the old per-section tuning could not survive.
     */
    expect(css).toContain('--section-y:')
    for (const [name, src] of home) {
      expect(src, name).toContain('section-y')
    }
  })

  it('has an explicit modifier for a continuing section', () => {
    /*
     * Evidence follows Pipeline and Closing follows Methodology, so a full gap
     * on both sides would read as four topics instead of two. A modifier
     * class, not a Tailwind `pt-0`: both are single-class utilities and the
     * cascade order between them is not something to rely on. The first
     * attempt used `pt-0` and it lost, measured at 88px when it should have
     * been 0.
     */
    expect(css).toContain('.section-y-continued')
    const continued = home.filter(([, s]) => s.includes('section-y-continued'))
    expect(continued.length).toBe(2)
  })
})
