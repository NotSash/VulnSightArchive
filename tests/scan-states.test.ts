import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Scan page states, from Part 3 session 3B.
 *
 * All six were rendered at 1440 against stubbed status responses: queued,
 * running, skipped, failed, completed and 404-expired. Zero horizontal
 * overflow in every state, no console errors. The skipped state in particular
 * needed no change: dead lamps are hatched and each carries its own reason.
 *
 * Three defects were found, and these pin the fixes.
 */
const root = join(__dirname, '..')
const header = readFileSync(join(root, 'components/scan/scan-header.tsx'), 'utf8')
const progress = readFileSync(join(root, 'components/scan/scan-progress.tsx'), 'utf8')
const page = readFileSync(join(root, 'app/scan/[scanId]/page.tsx'), 'utf8')
const ctx = readFileSync(join(root, 'components/scan/scan-live-context.tsx'), 'utf8')

describe('3B-1: stopping a scan that has already stopped', () => {
  it('shares a live flag between the two sibling components', () => {
    /*
     * The header and the progress view are siblings under the page, so the
     * header could not know the scan had ended. `Stop scan` therefore appeared
     * on the failed screen directly above "The scan stopped", and on the
     * expired screen, where it offered to stop a scan that no longer exists.
     */
    expect(page).toContain('<ScanLiveProvider>')
    expect(header).toContain('const { live } = useScanLive()')
    expect(header).toContain('{!live ? null : confirming ? (')
  })

  it('reports every terminal state, not just failure', () => {
    // Completed, failed and 404 all end the scan.
    const calls = progress.match(/setLive\(false\)/g) ?? []
    expect(calls.length).toBe(3)
  })

  it('defaults to live so the first paint still offers the control', () => {
    // A scan page that opens with no way to stop the scan is worse than one
    // that briefly offers it.
    expect(ctx).toContain('useState(true)')
  })

  it('works outside a provider, so the header alone is unchanged', () => {
    expect(ctx).toContain('?? { live: true, setLive: () => {} }')
  })
})

describe('3B-2: the completed state described itself as running', () => {
  it('changes the heading once the scan is done', () => {
    // For the 650ms before the redirect the page read "Scanning ...", which
    // contradicted the 15 / 15 counter directly below it.
    expect(progress).toContain("status?.status === 'completed' ? 'Scanned' : 'Scanning'")
  })

  it('changes the elapsed label from Running to Took', () => {
    expect(progress).toContain("status?.status === 'completed' ? 'Took' : 'Running'")
  })

  it('drops the typical-duration chip once the step has finished', () => {
    // Quoting how long a finished step usually takes is noise at best.
    expect(progress).toContain("status?.status !== 'completed' && typicalFor(")
  })

  it('never renders a percentage anywhere on the page', () => {
    /*
     * The original bug: the bar showed a percentage inside a stage, which
     * nobody can know. The wall replaced it, and the guarantee is stronger
     * now. The only progress figure on the page is a count of settled stages.
     */
    const withoutComments = progress.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toContain('%`}')
    expect(withoutComments).toContain('Checks reported')
    expect(withoutComments).toContain('{done}')
  })
})

describe('3B-3: progress is measured in settled stages, never invented', () => {
  const bar = readFileSync(join(root, 'components/scan/stage-bar.tsx'), 'utf8')
  const css = readFileSync(join(root, 'app/globals.css'), 'utf8')

  it('gives the running stage a sweep instead of a figure', () => {
    // A stage has no knowable midpoint, so the working block says "work is
    // happening here" without claiming how much is left.
    expect(bar).toContain('stage-cell-live')
    expect(css).toContain('@keyframes cell-sweep')
  })

  it('reads the running stage from the server, not from done + 1', () => {
    /*
     * `done + 1` is wrong whenever a stage was skipped: the wall would
     * shimmer on a block the server had already passed. `scan-store.ts`
     * promotes the next stage to `running` itself, so that is the truth.
     */
    expect(progress).toContain("timeline.findIndex((t) => t.status === 'running')")
  })

  it('keeps a real progressbar for assistive technology', () => {
    // The wall is aria-hidden, so the spoken progress lives in one element.
    expect(bar).toContain('aria-hidden="true"')
    expect(progress).toContain('role="progressbar"')
    expect(progress).toContain('${done} of ${total} steps finished')
  })

  it('keeps every stage in the wall, including ones that could not run', () => {
    // A skipped stage stays hatched in place so the count never shrinks.
    expect(bar).toContain("'skipped'")
    expect(bar).toContain('stage-cell-skipped')
  })
})
