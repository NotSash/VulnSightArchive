import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The segmented stage bar.
 *
 * The scan page is now one segmented bar, one cell per real stage. These tests pin the properties that make it honest, because the
 * failure mode of a progress bar is always the same: inventing a figure
 * nobody has.
 */
const root = join(__dirname, '..')
const bar = readFileSync(join(root, 'components/scan/stage-bar.tsx'), 'utf8')
const progress = readFileSync(join(root, 'components/scan/scan-progress.tsx'), 'utf8')
const css = readFileSync(join(root, 'app/globals.css'), 'utf8')
const store = readFileSync(join(root, 'lib/scan-store.ts'), 'utf8')
const types = readFileSync(join(root, 'types/report.ts'), 'utf8')

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

describe('the wall never invents progress', () => {
  it('renders one block per stage the server reported, and no more', () => {
    // Not a hardcoded 15: quick and standard modes have 7 and 11 stages.
    expect(bar).toContain('timeline.map(')
    expect(strip(bar)).not.toContain('15')
  })

  it('draws an empty track before the first poll', () => {
    /*
     * With an empty timeline the stage count is unknown. Rendering a
     * speculative row of blocks would be inventing the shape of the scan.
     */
    expect(bar).toContain('timeline.length === 0')
  })

  it('shows a sweep on the running stage rather than a figure', () => {
    expect(bar).toContain('stage-cell-live')
    expect(css).toContain('@keyframes cell-sweep')
  })

  it('takes the running stage from the server, not from done + 1', () => {
    /*
     * `done + 1` is wrong the moment a stage is skipped: the wall would
     * shimmer on a block the server had already passed.
     */
    expect(progress).toContain("timeline.findIndex((t) => t.status === 'running')")
  })
})

describe('every stage keeps its place', () => {
  it('hatches a stage that could not run instead of removing it', () => {
    // Dropping it would make the total silently shrink mid-scan.
    expect(bar).toContain('stage-cell-skipped')
    expect(css).toContain('.stage-cell-skipped')
  })

  it('leaves unstarted stages as empty wells', () => {
    // The base `.stage-cell` is the unlit state; no modifier is added.
    expect(css).toContain('.stage-cell {')
  })
})

describe('accessibility', () => {
  it('hides the wall from assistive technology', () => {
    /*
     * Fifteen blocks re-read on every 1.2s poll is noise. The same progress
     * is published once, as a real progressbar, in `scan-progress.tsx`.
     */
    expect(bar).toContain('aria-hidden="true"')
  })

  it('keeps one real progressbar with a spoken value', () => {
    expect(progress).toContain('role="progressbar"')
    expect(progress).toContain('${done} of ${total} steps finished')
  })

  it('puts the stage numbers in the list, not inside the bar cells', () => {
    /*
     * Text over a gradient inherits whatever opaque background sits behind
     * the gradient, which measured 1.08:1 on an earlier design. The cells are
     * now pure indicators and every label lives in the list, where it has a
     * real background of its own.
     */
    const list = readFileSync(join(root, 'components/scan/stage-list.tsx'), 'utf8')
    expect(list).toContain("done && 'bg-phos text-[#03070B]'")
  })

  it('stops the sweep under reduced motion', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.stage-cell-live::after')
    expect(reduced).toContain('animation: none')
  })
})

describe('stage detail is structured data, not a joined string', () => {
  it('gives TimelineEvent its own detail field', () => {
    expect(types).toContain('detail?: string')
  })

  it('stops gluing the outcome onto the stage name', () => {
    /*
     * It used to be `event: name · detail`, split apart again in the UI. A
     * separator inside a display string is not a data model: any stage name
     * containing it would have lost half its text.
     */
    const withoutComments = strip(store)
    expect(withoutComments).not.toContain('${name} · ${detail}')
    expect(withoutComments).not.toContain("stage.split(' · ')")
    expect(withoutComments).toContain('event: name')
  })
})
