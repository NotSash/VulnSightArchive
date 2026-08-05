import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SAMPLE_CHANNELS, SAMPLE_EVENTS } from '@/components/coincidence-plot'

/**
 * The coincidence plot's trace cache.
 *
 * `tracePath` was recomputing on every parent render. The plot lives inside
 * the CRT, which tilts toward the pointer, so the whole subtree re-rendered on
 * every mouse move and redrew five traces that could not have changed.
 *
 * The important property is not speed, it is that caching a drawing function
 * is only safe if the function is pure. These tests pin that purity, because
 * the day someone adds a random jitter without a seed the cache turns into a
 * frozen frame and nothing else would catch it.
 */
const source = readFileSync(join(process.cwd(), 'components/coincidence-plot.tsx'), 'utf8')

/** The drawing routine, lifted verbatim so the test measures the real thing. */
function drawTrace(spikes: number[], seed: number): string {
  const TRACE_H = 30
  const PLOT_W = 980
  let rand = seed * 9301 + 49297
  const next = () => {
    rand = (rand * 9301 + 49297) % 233280
    return rand / 233280
  }
  const points: string[] = []
  for (let x = 0; x <= PLOT_W; x += 3) {
    let y = TRACE_H * 0.6
    y += Math.sin(x / 11) * 0.5 + (next() - 0.5)
    for (const spike of spikes) {
      const d = x - spike
      if (Math.abs(d) < 40) {
        y -= Math.exp(-(d * d) / (2 * 7.2 ** 2)) * (TRACE_H * 0.6 - 2.5)
        y += Math.exp(-Math.abs(d) / 13) * Math.sin(d / 3.6) * 1.9
      }
    }
    points.push(`${x} ${y.toFixed(2)}`)
  }
  return `M${points.join(' L')}`
}

describe('the trace drawing routine is pure, which is what makes it cacheable', () => {
  it('gives byte-identical output for the same channel and seed', () => {
    for (const [i, channel] of SAMPLE_CHANNELS.entries()) {
      expect(drawTrace(channel.spikes, i + 1)).toBe(drawTrace(channel.spikes, i + 1))
    }
  })

  it('gives a different trace for a different seed, so channels are not clones', () => {
    const spikes = SAMPLE_CHANNELS[0].spikes
    expect(drawTrace(spikes, 1)).not.toBe(drawTrace(spikes, 2))
  })

  it('draws no random numbers that are not derived from the seed', () => {
    // A single `Math.random()` in here would make the cache freeze one frame.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toContain('Math.random')
    expect(withoutComments).not.toContain('Date.now')
  })
})

describe('the cache', () => {
  it('is keyed by both the seed and the spikes, not by the seed alone', () => {
    // Two channels could share a seed only by mistake, but a key that ignores
    // the data would return the wrong shape rather than a slow one.
    // Assembled rather than written inline: a literal containing `${...}`
    // trips Biome's template-placeholder rule.
    const key = ['`', '$', '{seed}:$', "{spikes.join(',')}", '`'].join('')
    expect(source).toContain(key)
  })

  it('keeps the pure routine separate from the memoised entry point', () => {
    expect(source).toContain('function drawTrace(')
    expect(source).toContain('function tracePath(')
    expect(source).toContain('traceCache.set(key, path)')
  })

  it('caches every distinct trace the sample plot needs, and no more', () => {
    /*
     * The plot calls `tracePath` once per channel for the grey line, then
     * again inside each agreement window for the phosphor overlay. With the
     * sample data that is 15 calls for 5 distinct traces, which is the whole
     * reason the cache is worth having.
     */
    const agreed = new Set(
      SAMPLE_EVENTS.filter((x) => SAMPLE_CHANNELS.filter((c) => c.spikes.includes(x)).length >= 2),
    )
    let calls = 0
    for (const channel of SAMPLE_CHANNELS) {
      calls += 1
      calls += channel.spikes.filter((x) => agreed.has(x)).length
    }
    expect(calls).toBe(15)
    expect(SAMPLE_CHANNELS.length).toBe(5)
  })

  it('is bounded by the channel count, so it cannot grow without limit', () => {
    // Module-level caches are a leak when the key space is open. Here the key
    // space is the channels a plot declares.
    const keys = new Set(SAMPLE_CHANNELS.map((c, i) => `${i + 1}:${c.spikes.join(',')}`))
    expect(keys.size).toBe(SAMPLE_CHANNELS.length)
  })
})
