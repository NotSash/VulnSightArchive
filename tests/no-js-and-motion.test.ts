import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Reduced motion and no-JS, from Part 3 session 3E.
 *
 * Reduced motion measured clean on all three pages in Chromium: zero infinite
 * animations running, no section below full opacity, no overflow. No-JS on
 * home was already good: 5,540 characters of readable text and all six nav
 * links. Three defects were found and are pinned below.
 */
const root = join(__dirname, '..')
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const css = readFileSync(join(root, 'app/globals.css'), 'utf8')
const resultsPage = readFileSync(join(root, 'app/results/[scanId]/page.tsx'), 'utf8')
const skeleton = readFileSync(join(root, 'components/results/report-skeleton.tsx'), 'utf8')
const progress = readFileSync(join(root, 'components/scan/scan-progress.tsx'), 'utf8')
const home = ['triage', 'evidence', 'methodology'].map(
  (f) => [f, strip(readFileSync(join(root, `components/home/${f}.tsx`), 'utf8'))] as const,
)

describe('3E-1: the results page was empty without JavaScript', () => {
  it('explains the situation instead of spinning forever', () => {
    // It rendered 24 characters: "Loading security report…", permanently,
    // with aria-busy left on so a screen reader kept waiting for nothing.
    expect(resultsPage).toContain('<noscript>')
    expect(resultsPage).toContain('This report needs JavaScript')
  })

  it('offers the raw data, which needs no JavaScript at all', () => {
    // A report is a document. This is the one page someone might reasonably
    // save, print, or open in a stripped-down browser.
    expect(resultsPage).toContain('/api/report/${scanId}')
  })

  it('hides the loading skeleton when scripts are off', () => {
    /*
     * Otherwise the skeleton sits at `aria-busy="true"` underneath the
     * explanation, telling assistive tech to keep waiting.
     *
     * Proven against the production stylesheet: with scripts off the skeleton
     * computes to `display: none` and the fallback to `block`; with scripts on
     * both are visible.
     */
    expect(skeleton).toContain('js-only')
    expect(css).toContain('html:not(.js) .js-only')
  })

  it('hides unless js, never the inversion', () => {
    /*
     * "Hide by default and reveal with JavaScript" is what made the
     * coincidence plot permanently invisible in Part 1. The failure is silent,
     * so the rule is written the safe way round.
     */
    // Anchored: `html:not(.js) .js-only` also ends in `.js-only`, so the
    // check has to be that no rule hides it *unconditionally*.
    expect(css).not.toMatch(/(^|\n)\s*\.js-only\s*\{\s*display:\s*none/)
    expect(css).toMatch(/html:not\(\.js\)\s+\.js-only\s*\{\s*display:\s*none/)
  })
})

describe('3E-2: the scan page invented progress without JavaScript', () => {
  it('shows the step counter only once the server has reported a timeline', () => {
    /*
     * Before the first poll the timeline is empty and `total` falls back to 1,
     * which rendered "Step 1 of 1": a scan that appears to have one step and
     * be stuck on it. With scripts off that fabricated state is permanent.
     */
    expect(progress).toContain('{timeline.length > 0 && (')
  })
})

describe('3E-3: .reveal was a dead class', () => {
  it('is gone from the three sections that carried it', () => {
    /*
     * No CSS rule anywhere defined it. Harmless in itself, but a class that
     * *looks* like it hides content until scrolled into view is exactly the
     * trap Part 1 spent a session fixing: the next person to define `.reveal`
     * would silently hide three sections without JavaScript.
     */
    for (const [name, src] of home) {
      expect(src, name).not.toContain('"reveal ')
    }
  })

  it('is not defined in the stylesheet either', () => {
    expect(css).not.toContain('.reveal')
  })
})
