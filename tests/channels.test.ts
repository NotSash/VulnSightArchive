import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHANNELS,
  channelForSource,
  channelForStage,
  channelsForSources,
  independentChannelCount,
  KNOWN_SOURCES,
  KNOWN_STAGES,
} from '@/lib/scanner/channels'
import { stagesForMode } from '@/lib/scanner/run'

/**
 * The interface shows six channels; the scanner emits thirteen source names.
 * These tests exist so that gap can never widen silently. An analyzer added
 * without a mapping, or a stage renamed, fails here rather than producing a
 * finding attributed to a lamp that does not exist.
 */

describe('source to channel', () => {
  it('maps every known source to a real channel', () => {
    for (const source of KNOWN_SOURCES) {
      expect(CHANNELS).toContain(channelForSource(source))
    }
  })

  /**
   * The safety net. A finding must never disappear from the interface because
   * somebody forgot a mapping, so unknown sources land in OTHER rather than
   * throwing or returning null.
   */
  it('falls back to OTHER instead of losing a finding', () => {
    expect(channelForSource('something-new')).toBe('OTHER')
    expect(channelForSource('')).toBe('OTHER')
  })

  it('is case and whitespace insensitive', () => {
    expect(channelForSource('  NMAP ')).toBe('NMAP')
    expect(channelForSource('Zap-Passive')).toBe('ZAP')
  })

  /**
   * The guard. Every `source: '...'` literal anywhere in the scanner must have
   * a mapping. This is the test that makes the fallback above a net rather
   * than a hiding place.
   */
  it('covers every source literal used in lib/scanner', () => {
    const dir = join(process.cwd(), 'lib', 'scanner')
    const found = new Set<string>()
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue
      const text = readFileSync(join(dir, file), 'utf8')
      for (const match of text.matchAll(/source:\s*'([a-z][a-z-]*)'/g)) {
        const value = match[1]
        if (value) found.add(value)
      }
    }
    // Sanity: if this ever reads zero, the regex has drifted and the test is
    // passing for the wrong reason.
    expect(found.size).toBeGreaterThan(5)

    const unmapped = [...found].filter((source) => channelForSource(source) === 'OTHER')
    expect(unmapped, `unmapped scanner sources: ${unmapped.join(', ')}`).toEqual([])
  })
})

describe('independent channel counting', () => {
  /**
   * The number the product is built on. Two sources inside one channel is
   * VulnSight agreeing with itself, not two independent tools, and counting it
   * as two would inflate every confirmation on the results page.
   */
  it('counts one channel once, however many sources hit it', () => {
    expect(independentChannelCount(['header', 'cookie', 'transport'])).toBe(1)
    expect(independentChannelCount(['browser', 'browser-dom'])).toBe(1)
  })

  it('counts genuinely independent tools separately', () => {
    expect(independentChannelCount(['header', 'nmap', 'zap-passive', 'nvd'])).toBe(4)
    expect(independentChannelCount(['header', 'zap-passive'])).toBe(2)
  })

  it('returns channels in display order, not call order', () => {
    expect(channelsForSources(['nvd', 'header', 'nmap'])).toEqual(['HEADERS', 'NMAP', 'NVD'])
  })

  it('handles an empty list without throwing', () => {
    expect(independentChannelCount([])).toBe(0)
    expect(channelsForSources([])).toEqual([])
  })

  /**
   * The threshold the whole results grouping depends on: a finding is
   * confirmed when two or more *independent* channels saw it.
   */
  it('treats a single-channel finding as unconfirmed', () => {
    expect(independentChannelCount(['header', 'cookie']) >= 2).toBe(false)
    expect(independentChannelCount(['header', 'nmap']) >= 2).toBe(true)
  })
})

describe('stage to channel', () => {
  it('maps every stage the pipeline can run', () => {
    const all = new Set([
      ...stagesForMode('quick'),
      ...stagesForMode('standard'),
      ...stagesForMode('comprehensive'),
    ])
    for (const stage of all) {
      expect(KNOWN_STAGES, `stage "${stage}" has no channel`).toContain(stage)
      expect(CHANNELS).toContain(channelForStage(stage))
    }
  })

  it('does not map stages that no longer exist', () => {
    const all = new Set([
      ...stagesForMode('quick'),
      ...stagesForMode('standard'),
      ...stagesForMode('comprehensive'),
    ])
    const stale = KNOWN_STAGES.filter((stage) => !all.has(stage))
    expect(stale, `stale stage mappings: ${stale.join(', ')}`).toEqual([])
  })

  it('falls back to OTHER for an unknown stage', () => {
    expect(channelForStage('Reticulating splines')).toBe('OTHER')
  })
})
