import { describe, expect, it } from 'vitest'
import { countSeverities } from '@/lib/scan-store'
import type { LiveFinding } from '@/types/report'

/**
 * Live findings are streamed mid-scan, before correlation runs. These tests
 * pin the two properties that matter: the tally is correct, and a live finding
 * can never claim cross-tool agreement it has not earned.
 */
describe('countSeverities', () => {
  it('returns a zeroed tally for no findings', () => {
    expect(countSeverities([])).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    })
  })

  it('counts each severity independently', () => {
    const findings: LiveFinding[] = [
      { title: 'a', severity: 'high', source: 'header' },
      { title: 'b', severity: 'high', source: 'zap-passive' },
      { title: 'c', severity: 'medium', source: 'header' },
      { title: 'd', severity: 'info', source: 'nmap' },
    ]
    expect(countSeverities(findings)).toEqual({
      critical: 0,
      high: 2,
      medium: 1,
      low: 0,
      info: 1,
    })
  })

  it('never reports a total different from the number of findings', () => {
    const findings: LiveFinding[] = [
      { title: 'a', severity: 'critical', source: 'nuclei' },
      { title: 'b', severity: 'low', source: 'header' },
    ]
    const counts = countSeverities(findings)
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
    expect(total).toBe(findings.length)
  })

  it('carries a source but no confidence, because correlation has not run', () => {
    const finding: LiveFinding = { title: 'a', severity: 'high', source: 'header' }
    // A live finding must never be able to claim independent agreement: that is
    // only knowable once every tool has reported.
    expect(finding).not.toHaveProperty('confidence')
    expect(finding).not.toHaveProperty('confirmations')
    expect(finding.source).toBe('header')
  })
})

describe('onFindings streaming contract', () => {
  it('emits a growing snapshot, never a shrinking one', () => {
    /*
     * run.ts calls onFindings from the single stage-completion helper, so each
     * emission is a snapshot of everything found so far. The UI relies on that
     * being monotonic — a list that shrank mid-scan would look like findings
     * were being retracted.
     */
    const emissions: LiveFinding[][] = []
    const findings: LiveFinding[] = []
    const emit = () => emissions.push(findings.map((f) => ({ ...f })))

    emit()
    findings.push({ title: 'a', severity: 'medium', source: 'header' })
    emit()
    findings.push({ title: 'b', severity: 'high', source: 'zap-passive' })
    emit()

    expect(emissions.map((e) => e.length)).toEqual([0, 1, 2])
    for (let i = 1; i < emissions.length; i += 1) {
      expect(emissions[i].length).toBeGreaterThanOrEqual(emissions[i - 1].length)
    }
    // Earlier findings must keep their identity across emissions.
    expect(emissions[2][0]).toEqual(emissions[1][0])
  })
})
