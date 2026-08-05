import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Part 2.5's exit criteria, pinned.
 *
 * The audit script is the real proof and it is run by hand against a browser;
 * these assertions guard the specific rules that took a session each to find,
 * so a later change cannot quietly undo them. Every number below was measured
 * in Chromium against the production stylesheet.
 */
const root = join(__dirname, '..')
const css = readFileSync(join(root, 'app/globals.css'), 'utf8')
const audit = readFileSync(join(root, '_for-myself/tools/mobile-audit.mjs'), 'utf8')
const plot = readFileSync(join(root, 'components/coincidence-plot.tsx'), 'utf8')

describe('the audit describes real devices', () => {
  it('treats every listed viewport as a touch device', () => {
    /*
     * `hasTouch` was keyed off `width < 768`, which excluded the 768px tablet
     * and made Chromium report it as a mouse. `pointer: coarse` was then
     * false, the touch-only rules correctly did not apply, and the audit
     * flagged their absence as a defect: it was describing a device that does
     * not exist rather than the iPad it is named after.
     */
    expect(audit).toContain('hasTouch: true')
    expect(audit).not.toContain('hasTouch: vp.width < 768')
  })

  it('measures pseudo-element hit areas, not just element boxes', () => {
    // Otherwise it flags controls that are genuinely reachable.
    expect(audit).toContain("getComputedStyle(el, '::after')")
  })
})

describe('landscape on a phone', () => {
  it('drops the hero minimum only when the screen is genuinely short', () => {
    /*
     * A phone held sideways is ~390px tall and the hero carries a 600px
     * minimum, which pushed its only call to action below the fold: measured
     * at 844x390, the button started at y=690 on a 390px screen. Now the
     * section is exactly viewport height there.
     *
     * `orientation: landscape` alone would be wrong: a tablet in landscape is
     * 1024px tall and wants the full 600px. Verified after: 452px at 844x390,
     * 600px minimum retained at 390x844 and 1024x768.
     */
    expect(css).toContain('@media (orientation: landscape) and (max-height: 560px)')
    expect(css).toContain('min-height: 0')
  })
})

describe('the type floor reaches SVG', () => {
  it('exposes custom properties for labels that carry their own size', () => {
    // An SVG `fontSize` is a style, not a class, so no class rule can reach
    // it. The plot reads variables that the same media query redefines.
    expect(css).toContain('--plot-label: 12px')
    expect(css).toContain('--plot-label-sm: 12px')
  })

  it('is actually consumed by the plot', () => {
    expect(plot).toContain('var(--plot-label,')
    expect(plot).toContain('var(--plot-label-sm,')
  })

  it('leaves a sensible fallback for pointer devices', () => {
    // The fallback in the `var()` is the authored desktop size, so a mouse
    // user sees exactly what was designed.
    expect(plot).toContain('9px)')
    expect(plot).toContain('8.5px)')
  })
})
