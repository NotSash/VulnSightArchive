import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * House style for user-facing copy.
 *
 * Em dashes and en dashes are banned from anything a reader sees. They are a
 * strong tell of machine-written text, and this product's credibility rests on
 * not looking generated. Sentences get rewritten instead: split in two, or
 * joined with a comma, a colon, or a conjunction.
 *
 * Code comments are exempt, since only developers read them.
 */
function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    // Not just .ts/.tsx: an SVG or the web manifest can carry visible words.
    else if (/\.(ts|tsx|json|svg|html|webmanifest|txt)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe('user-facing copy', () => {
  it('contains no em dashes or en dashes', () => {
    const offenders: string[] = []
    for (const file of [
      ...walk('app'),
      ...walk('components'),
      ...walk('lib'),
      // `types/` and `public/` were outside the sweep. Both can hold copy a
      // reader sees: a label union or enum in `types/`, and text inside an
      // SVG, a JSON string or the web manifest in `public/`. Both are clean
      // today, so this closes the hole before it is used rather than after.
      ...walk('types'),
      ...walk('public'),
    ]) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((raw, i) => {
          const text = raw.trim()
          // Comment lines are not shown to anyone.
          if (text.startsWith('*') || text.startsWith('//') || text.startsWith('/*')) return
          if (/[\u2013\u2014]|&mdash;|&ndash;/.test(text)) {
            offenders.push(`${file}:${i + 1}  ${text.slice(0, 90)}`)
          }
        })
    }
    expect(offenders, `Rewrite these without a dash:\n${offenders.join('\n')}`).toEqual([])
  })
})
