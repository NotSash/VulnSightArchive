import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Results states, from Part 3 session 3C.
 *
 * Four states rendered at 1440 by stubbing `/api/report/*`: a clean scan with
 * no findings, a scan where no two tools agreed, a 60-finding report, and a
 * report with no CVEs and no coverage notes. Zero horizontal overflow in every
 * state, no console errors, and the section nav adapts correctly (6 links
 * instead of 8 when Coverage and CVEs are absent).
 */
const root = join(__dirname, '..')
const vulnsRaw = readFileSync(join(root, 'components/results/vulnerabilities-section.tsx'), 'utf8')
/*
 * Comments stripped before matching.
 *
 * The comment above the fix quotes the old copy verbatim to explain what was
 * wrong with it, so a naive `not.toContain` matched the explanation rather
 * than the output. Assert against the code that actually renders.
 */
const vulns = vulnsRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const risk = readFileSync(join(root, 'lib/scanner/risk.ts'), 'utf8')

describe('3C-1: the empty findings panel contradicted the page', () => {
  it('does not call a deep scan passive', () => {
    // A deep scan runs nmap, nuclei and ZAP. None of them are passive.
    expect(vulns).not.toContain('passive assessment')
  })

  it('does not offer generic security advice', () => {
    // "Follow security best practices" is exactly the filler this product
    // exists to avoid: it is true of everything and actionable for nothing.
    expect(vulns).not.toContain('best practices')
  })

  it('distinguishes a finding from an observation', () => {
    /*
     * The panel sat directly above a Security headers table listing six
     * headers as missing, so the page claimed nothing was found while showing
     * things that were. A finding is something a tool asserted is a problem;
     * a configuration detail is not automatically one.
     */
    expect(vulns).toContain('No findings')
    expect(vulns).toContain('none of them reported a weakness')
  })

  it('points at the sections that do hold the detail', () => {
    // More useful than advice nobody asked for, and it resolves the apparent
    // contradiction by naming where those observations live.
    expect(vulns).toContain('Technical details')
    expect(vulns).toContain('Scan coverage')
  })
})

describe('the score, the category and the penalties are one derivation', () => {
  it('computes all three from the same distribution', () => {
    /*
     * Worth pinning because a hand-built stub that set `score: 0` while
     * leaving `category: 'High'` and six penalties in place rendered a gauge
     * reading 0 / HIGH above a list of deductions on a report with no
     * findings. That combination cannot occur in production, and it looked
     * exactly like a real bug for several minutes.
     */
    expect(risk).toContain('return { score, category: categoryForScore(score), penalties }')
  })

  it('cannot produce a penalty for a severity with no findings', () => {
    expect(risk).toContain('if (count === 0) continue')
  })
})
