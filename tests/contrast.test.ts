import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the contrast fixes made in session 4E.
 *
 * The secondary grey `--dim-2` carries almost every small label on the site,
 * so when it was `#607686` (4.14:1 on the page ground) over a hundred pieces
 * of text failed WCAG AA at once. These tests keep the token, and the two
 * places that duplicated its old value, above the threshold.
 */

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

const GROUND = '#070C12'
const PANEL = '#0B1117'

function channel(value: number): number {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)]
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function token(name: string): string {
  const match = css.match(new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`token ${name} not found`)
  return match[1]
}

describe('contrast tokens', () => {
  it('the contrast helper agrees with known values', () => {
    expect(ratio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(ratio('#607686', GROUND)).toBeCloseTo(4.14, 1)
  })

  for (const name of ['--dim-2', '--severity-info', '--chart-5']) {
    it(`${name} clears 4.5:1 on the page ground and on a raised panel`, () => {
      const value = token(name)
      expect(ratio(value, GROUND)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(value, PANEL)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('--dim stays clearly brighter than --dim-2, so the hierarchy survives', () => {
    expect(luminance(token('--dim'))).toBeGreaterThan(luminance(token('--dim-2')) * 1.4)
  })

  it('the old failing grey is gone from the token block', () => {
    const tokens = css.slice(0, css.indexOf('--radius:'))
    const withoutComments = tokens.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toContain('#607686')
  })
})

describe('pipeline budget bar labels', () => {
  const pipeline = readFileSync(join(process.cwd(), 'components/home/pipeline.tsx'), 'utf8')

  it('picks label colour from the bar tone, not from the bar width', () => {
    const withoutComments = pipeline.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).toContain('LIGHT_TONE')
    expect(withoutComments).not.toContain("step.share > 50 ? 'text-[#03070B]'")
  })

  it('dark text is used on both light bars', () => {
    const match = pipeline.match(/const LIGHT_TONE = \[(.*?)\]/)
    expect(match).not.toBeNull()
    const flags = (match as RegExpMatchArray)[1].split(',').map((s) => s.trim() === 'true')
    expect(flags).toEqual([false, false, true, true, false, false])
  })

  it('the dark label on a light bar clears 4.5:1', () => {
    expect(ratio('#03070B', '#3ba883')).toBeGreaterThanOrEqual(4.5)
    expect(ratio('#123026', '#3ba883')).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * Session 4E part two: the states audit found four more places where a
 * translucent panel, a wash of the same hue, or an opacity modifier pushed
 * text below the threshold. `state-audit.mjs` proves them in a browser; these
 * keep them from being undone in the source.
 */
describe('4E part two: grounds that are not the page background', () => {
  const globals = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
  const severity = readFileSync(join(process.cwd(), 'lib/severity.ts'), 'utf8')
  const stageList = readFileSync(join(process.cwd(), 'components/scan/stage-list.tsx'), 'utf8')
  const technical = readFileSync(
    join(process.cwd(), 'components/results/technical-details-section.tsx'),
    'utf8',
  )
  const scanForm = readFileSync(join(process.cwd(), 'components/scan/scan-form.tsx'), 'utf8')

  it('the Info chip has its own ink, because grey on a grey wash fails', () => {
    expect(globals).toContain('--severity-info-ink:')
    expect(severity).toContain('text-[var(--severity-info-ink)]')
    expect(severity).not.toContain('bg-severity-info/12 text-severity-info ')
  })

  it('stage markers sit on a solid chip, not on a gradient', () => {
    /*
     * Replaces the old lamp-number rule. Text over a gradient inherits the
     * opaque background behind it, which measured 1.08:1 on an earlier
     * design. A solid phosphor chip with ink text is 13.2:1.
     */
    expect(stageList).toContain("done && 'bg-phos text-[#03070B]'")
    expect(stageList).not.toContain('text-[rgb(3_7_11/62%)]')
  })

  it('the technology category label is not dimmed on a doubled panel', () => {
    expect(technical).not.toContain('text-muted-foreground/70')
  })

  it('the depth picker duration uses the brighter grey on its phosphor wash', () => {
    const withoutComments = scanForm.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(withoutComments).toContain('tnum font-mono text-[9.5px] text-[var(--dim)]')
  })
})
