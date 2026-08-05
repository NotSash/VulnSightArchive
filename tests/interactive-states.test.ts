import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Interactive states, from Part 3 session 3D.
 *
 * Tab order was walked start to finish in Chromium: 22 stops on home, 2 on
 * scan, 31 on results, every one with a visible focus ring. Hover, active and
 * disabled were probed by reading computed styles before and after hovering.
 * Two controls turned out to have no perceptible hover state at all.
 */
const root = join(__dirname, '..')
/*
 * Comments stripped before matching.
 *
 * The comments above each fix quote the old classes verbatim to explain what
 * was wrong with them, so a naive `not.toContain` matches the explanation
 * rather than the output. Assert against the code that actually renders.
 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const form = strip(readFileSync(join(root, 'components/scan/scan-form.tsx'), 'utf8'))
const vulns = strip(
  readFileSync(join(root, 'components/results/vulnerabilities-section.tsx'), 'utf8'),
)

describe('3D-1: the depth picker was inert under the cursor', () => {
  it('no longer relies on a border change that is invisible', () => {
    /*
     * It was `hover:border-input`, which looks like a hover state and is not
     * one: `--input` and `--border` resolve close enough that nothing
     * perceptibly changes. Measured on all three options, selected or not:
     * no change to border, background or colour.
     */
    expect(form).not.toContain('hover:border-input')
  })

  it('gives the unselected options a visible lift', () => {
    expect(form).toContain('hover:border-phos/50')
    expect(form).toContain('hover:bg-phos/[0.06]')
  })

  it('gives the selected option its own hover, distinct from selecting', () => {
    // It brightens its own fill rather than changing hue, so hovering the
    // current choice cannot be mistaken for choosing a different one.
    expect(form).toContain('bg-phos/10 hover:bg-phos/20')
  })
})

describe('3D-2: finding rows were indistinguishable from static text', () => {
  it('lifts the row background on hover', () => {
    /*
     * Every row is a button that expands to reveal the evidence behind a
     * finding, and it is the primary interaction on the whole report. It had
     * a focus ring and nothing for the pointer.
     */
    expect(vulns).toContain('hover:bg-foreground/[0.04]')
    expect(vulns).toContain('transition-colors')
  })

  it('spends no chroma on pointer feedback', () => {
    /*
     * Colour on this page means severity or scanner agreement. A hover tint
     * in the accent would be a third meaning, so the lift is a neutral
     * brightening of the surface instead.
     */
    const row = vulns.slice(vulns.indexOf('group flex w-full items-center'))
    const cls = row.slice(0, row.indexOf('"', 10))
    expect(cls).not.toContain('hover:bg-phos')
    expect(cls).not.toContain('hover:text-')
  })

  it('keeps the focus ring it already had', () => {
    expect(vulns).toContain('focus-visible:ring-2 focus-visible:ring-phos')
  })
})
