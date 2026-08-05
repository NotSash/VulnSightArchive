import { describe, expect, it } from 'vitest'
import { channelForStage, KNOWN_STAGES } from '@/lib/scanner/channels'
import { stagesForMode } from '@/lib/scanner/run'
import type { ScanMode } from '@/types/report'

/**
 * Stage bookkeeping.
 *
 * `runScan` reports progress through a `complete()` helper that advances an
 * implicit cursor: it trusts that the caller is on the stage the counter
 * happens to point at. There are 23 such calls across 8 mode-guarded blocks,
 * and their order must match `STAGES[mode]` exactly. Get it wrong and every
 * later stage reports under the wrong name, with nothing thrown and no type
 * error. The runtime guard in `complete()` catches drift when a call site
 * passes its expected name; these tests cover the data it relies on.
 */

const MODES: ScanMode[] = ['quick', 'standard', 'comprehensive']

describe('stage lists', () => {
  it('has no duplicate stage names within a mode', () => {
    for (const mode of MODES) {
      const stages = stagesForMode(mode)
      expect(new Set(stages).size, `duplicate stage in ${mode}`).toBe(stages.length)
    }
  })

  /**
   * The cursor is positional, so a stage that appears in a shallower mode must
   * appear at the same index in a deeper one. If `standard` reordered the
   * stages `quick` shares, the same `complete()` call would land on different
   * names depending on mode.
   */
  it('keeps shared stages in the same order across modes', () => {
    const quick = stagesForMode('quick')
    const standard = stagesForMode('standard')
    const comprehensive = stagesForMode('comprehensive')

    const positionsIn = (list: string[], subset: string[]) =>
      subset.filter((s) => list.includes(s)).map((s) => list.indexOf(s))

    const isAscending = (xs: number[]) => xs.every((v, i) => i === 0 || v > (xs[i - 1] ?? -1))

    expect(isAscending(positionsIn(standard, quick))).toBe(true)
    expect(isAscending(positionsIn(comprehensive, standard))).toBe(true)
  })

  it('always ends with the assembly stage', () => {
    for (const mode of MODES) {
      const stages = stagesForMode(mode)
      expect(stages[stages.length - 1]).toBe('Scoring and assembling report')
    }
  })

  it('always begins by resolving DNS', () => {
    for (const mode of MODES) {
      expect(stagesForMode(mode)[0]).toBe('Resolving DNS')
    }
  })

  it('grows monotonically with depth', () => {
    expect(stagesForMode('quick').length).toBeLessThan(stagesForMode('standard').length)
    expect(stagesForMode('standard').length).toBeLessThan(stagesForMode('comprehensive').length)
  })

  /**
   * Only the deepest mode runs enough independent tools to corroborate a
   * finding. The depth selector says so in the UI, so it has to stay true.
   */
  it('runs the external tools only in the modes that claim to', () => {
    const quick = stagesForMode('quick')
    const comprehensive = stagesForMode('comprehensive')
    for (const tool of ['Template scanning (Nuclei)', 'Passive analysis (OWASP ZAP)']) {
      expect(quick).not.toContain(tool)
      expect(comprehensive).toContain(tool)
    }
  })

  it('maps every stage to a display channel', () => {
    for (const mode of MODES) {
      for (const stage of stagesForMode(mode)) {
        expect(KNOWN_STAGES, `"${stage}" has no channel`).toContain(stage)
        expect(channelForStage(stage)).toBeTruthy()
      }
    }
  })
})
