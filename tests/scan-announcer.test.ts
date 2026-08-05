import { describe, expect, it } from 'vitest'
import { announcementFor } from '@/components/scan/use-scan-announcer'

/**
 * A deep scan runs for about four minutes and used to say nothing at all to a
 * screen reader: no live region, no progressbar, nothing. These tests pin the
 * two rules the spoken version has to obey.
 */
const base = {
  status: 'running' as string | undefined,
  stage: 'Enumerating ports (Nmap)',
  done: 10,
  total: 15,
  findingCount: 0,
  typical: null as string | null,
}

describe('scan announcements', () => {
  it('names the step and its position, counting from one', () => {
    // 10 settled means the 11th is in flight. Off by one here would tell a
    // user the scan is a step further along than it is.
    expect(announcementFor(base)).toBe('Step 11 of 15: Enumerating ports (Nmap).')
  })

  it('never invents a percentage', () => {
    const text = announcementFor({ ...base, findingCount: 3, typical: 'about 40 seconds' })
    expect(text).not.toMatch(/%|percent/i)
  })

  it('mentions a typical duration when there is an honest one', () => {
    expect(announcementFor({ ...base, typical: 'about 90 seconds' })).toContain(
      'usually about 90 seconds',
    )
  })

  it('says nothing about duration when the duration is unknown', () => {
    expect(announcementFor(base)).not.toContain('usually')
  })

  it('reports findings so far, and stays silent at zero', () => {
    expect(announcementFor({ ...base, findingCount: 0 })).not.toContain('finding')
    expect(announcementFor({ ...base, findingCount: 1 })).toContain('1 finding so far')
    expect(announcementFor({ ...base, findingCount: 4 })).toContain('4 findings so far')
  })

  it('does not run the step counter past the total', () => {
    // The last stage completing can briefly report done === total.
    expect(announcementFor({ ...base, done: 15 })).toContain('Step 15 of 15')
  })

  it('announces completion, with the count and what happens next', () => {
    const text = announcementFor({ ...base, status: 'completed', findingCount: 15 })
    expect(text).toContain('Scan complete')
    expect(text).toContain('15 findings')
    expect(text).toContain('Opening the report')
  })

  it('announces a clean completion without saying zero findings awkwardly', () => {
    expect(announcementFor({ ...base, status: 'completed', findingCount: 0 })).toContain(
      'No findings found',
    )
  })

  it('announces failure without pretending to know why', () => {
    const text = announcementFor({ ...base, status: 'failed' })
    expect(text).toContain('stopped before it finished')
  })

  it('has something to say before the first stage arrives', () => {
    expect(announcementFor({ ...base, stage: undefined })).toBe('Starting the scan.')
  })

  it('uses no dashes, per the house copy rule', () => {
    const samples = [
      announcementFor(base),
      announcementFor({ ...base, status: 'completed', findingCount: 2 }),
      announcementFor({ ...base, status: 'failed' }),
    ]
    for (const text of samples) {
      expect(text).not.toContain('\u2014')
      expect(text).not.toContain('\u2013')
    }
  })
})
