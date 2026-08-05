import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The report header collapsed on a phone.
 *
 * Measured at 390px before the fix: the hostname was rendered **13 pixels
 * wide and 17 tall**, wrapping to one character per line and reading as a
 * vertical "s.", with the scan metadata stacked beside it in single letters
 * and the logo pushed into its own column.
 *
 * The cause was not the wrapping. It was that the logo, the domain block and
 * the three export actions all shared one `flex-wrap` row, and the domain
 * block was `flex-1`, which means `flex-basis: 0`: it declared no intrinsic
 * width and simply absorbed whatever the buttons left over. The buttons need
 * roughly 270px of the 358px available at 390px, so the domain was handed 13.
 * Nothing ever overflowed, so `flex-wrap` never triggered; the line always
 * "fit", by crushing the one element with no floor.
 *
 * Source-level assertions, because the bug was pure CSS layout and jsdom has
 * no layout engine: a rendered test would have passed while the real page was
 * broken. The measurements above and after come from a real browser.
 */
const root = join(__dirname, '..')
const header = readFileSync(join(root, 'components/results/report-header.tsx'), 'utf8')
const exportMenu = readFileSync(join(root, 'components/results/export-menu.tsx'), 'utf8')

describe('report header on a phone', () => {
  it('stacks into two rows, and only joins into one at sm', () => {
    // The whole fix: stop asking three things to share one row on a phone.
    expect(header).toContain('flex flex-col gap-3 sm:flex-row')
  })

  it('never lets the domain be squeezed to nothing again', () => {
    // A domain has no spaces, so a narrow column cannot break it on a word
    // boundary and would rather overflow than wrap.
    expect(header).toContain('truncate break-all')
  })

  it('gives the brand link a 44px target without moving the logo', () => {
    // Negative margin cancels the padding, so the hit area grows outward
    // rather than pushing the mark off its optical alignment.
    expect(header).toContain('-m-2 flex size-11 shrink-0')
  })

  it('gives the New scan action a 44px minimum height', () => {
    expect(header).toContain('min-h-11')
  })

  it('gives the export actions a 44px minimum height', () => {
    // These were 35px: fine for a mouse, a genuine miss-target on a phone.
    expect(exportMenu).toContain('min-h-11')
  })

  it('lets the actions share the width on a phone and stop growing at sm', () => {
    for (const src of [header, exportMenu]) {
      expect(src).toContain('flex-1')
      expect(src).toContain('sm:flex-none')
    }
  })

  it('keeps the metadata readable on a phone and compact on desktop', () => {
    // 9.5px is legible on a monitor at arm's length, not on a phone.
    expect(header).toContain('text-[11px]')
    expect(header).toContain('sm:text-[9.5px]')
  })
})
