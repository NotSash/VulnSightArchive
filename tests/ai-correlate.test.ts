import { describe, expect, it, vi } from 'vitest'
import { parseSuggestions, reviewCorrelation } from '@/lib/scanner/ai-correlate'
import type { Vulnerability } from '@/types/report'

type Finding = Omit<Vulnerability, 'id'>

/**
 * The optional AI correlation review.
 *
 * The value of this feature is entirely dependent on it being untrusted by
 * default. These tests exist to prove the guardrails hold: a model response
 * cannot invent findings, cannot reference out-of-range indices, and cannot
 * influence severity or scoring. When anything is off, the deterministic
 * result must stand unchanged.
 */

function finding(title: string, source: string): Finding {
  return {
    title,
    source,
    severity: 'medium',
    description: 'description',
    impact: 'impact',
    recommendation: 'recommendation',
    references: [],
    cvss_score: null,
    cwe_id: null,
    cve_id: null,
    owasp_category: null,
  }
}

describe('parseSuggestions', () => {
  it('accepts a well-formed response', () => {
    const raw = '{"pairs":[{"a":0,"b":1,"reason":"Both describe a missing CSP header"}]}'
    expect(parseSuggestions(raw, 3)).toEqual([
      { a: 0, b: 1, reason: 'Both describe a missing CSP header' },
    ])
  })

  it('extracts JSON embedded in surrounding prose', () => {
    // Models frequently wrap JSON in commentary or code fences.
    const raw = 'Here is my analysis:\n```json\n{"pairs":[{"a":0,"b":1,"reason":"same"}]}\n```'
    expect(parseSuggestions(raw, 2)).toHaveLength(1)
  })

  it('rejects indices outside the supplied range', () => {
    // A hallucinated index is the clearest sign the model invented a finding.
    expect(parseSuggestions('{"pairs":[{"a":0,"b":99,"reason":"x"}]}', 3)).toEqual([])
    expect(parseSuggestions('{"pairs":[{"a":-1,"b":0,"reason":"x"}]}', 3)).toEqual([])
  })

  it('rejects a pair that references the same finding twice', () => {
    expect(parseSuggestions('{"pairs":[{"a":1,"b":1,"reason":"x"}]}', 3)).toEqual([])
  })

  it('rejects non-integer indices', () => {
    expect(parseSuggestions('{"pairs":[{"a":"zero","b":1,"reason":"x"}]}', 3)).toEqual([])
    expect(parseSuggestions('{"pairs":[{"a":0.5,"b":1,"reason":"x"}]}', 3)).toEqual([])
  })

  it('requires a stated reason so every suggestion is auditable', () => {
    expect(parseSuggestions('{"pairs":[{"a":0,"b":1}]}', 3)).toEqual([])
    expect(parseSuggestions('{"pairs":[{"a":0,"b":1,"reason":"  "}]}', 3)).toEqual([])
  })

  it('treats (a,b) and (b,a) as one suggestion', () => {
    const raw = '{"pairs":[{"a":0,"b":1,"reason":"x"},{"a":1,"b":0,"reason":"y"}]}'
    expect(parseSuggestions(raw, 3)).toHaveLength(1)
  })

  it('normalises pair ordering', () => {
    expect(parseSuggestions('{"pairs":[{"a":2,"b":1,"reason":"x"}]}', 3)[0]).toMatchObject({
      a: 1,
      b: 2,
    })
  })

  it('caps the number of accepted suggestions', () => {
    // A model proposing dozens of links is pattern-matching, not reasoning.
    const pairs = Array.from({ length: 40 }, (_, i) => ({ a: 0, b: i + 1, reason: 'x' }))
    expect(parseSuggestions(JSON.stringify({ pairs }), 100).length).toBeLessThanOrEqual(10)
  })

  it('returns nothing for malformed or unexpected output', () => {
    expect(parseSuggestions('not json at all', 3)).toEqual([])
    expect(parseSuggestions('', 3)).toEqual([])
    expect(parseSuggestions('{"pairs":"not-an-array"}', 3)).toEqual([])
    expect(parseSuggestions('{"other":[]}', 3)).toEqual([])
  })

  it('handles an explicit empty result', () => {
    expect(parseSuggestions('{"pairs":[]}', 3)).toEqual([])
  })

  it('truncates an over-long reason rather than rejecting it', () => {
    const raw = JSON.stringify({ pairs: [{ a: 0, b: 1, reason: 'x'.repeat(1000) }] })
    expect(parseSuggestions(raw, 2)[0].reason.length).toBeLessThanOrEqual(300)
  })
})

describe('reviewCorrelation', () => {
  it('does nothing when there is nothing to relate', async () => {
    expect(await reviewCorrelation([])).toEqual({ suggestions: [] })
    expect(await reviewCorrelation([finding('One', 'header')])).toEqual({ suggestions: [] })
  })

  it('records a coverage note when no API key is configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    try {
      const result = await reviewCorrelation([finding('A', 'header'), finding('B', 'zap-passive')])
      expect(result.suggestions).toEqual([])
      expect(result.note?.stage).toBe('AI correlation review')
      expect(result.note?.status).toBe('skipped')
      expect(result.note?.detail).toContain('Deterministic correlation was applied')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('skips review for very large finding sets and says so', async () => {
    const many = Array.from({ length: 61 }, (_, i) => finding(`Finding ${i}`, 'nuclei'))
    const result = await reviewCorrelation(many)
    expect(result.suggestions).toEqual([])
    expect(result.note?.status).toBe('skipped')
    expect(result.note?.detail).toContain('exceeded the review limit')
  })

  it('degrades to a coverage note when the provider call fails', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network unreachable'))
    try {
      const result = await reviewCorrelation([finding('A', 'header'), finding('B', 'zap-passive')])
      expect(result.suggestions).toEqual([])
      expect(result.note?.status).toBe('failed')
      expect(result.note?.detail).toContain('Deterministic correlation is unaffected')
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('returns validated suggestions from a well-behaved provider', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"pairs":[{"a":0,"b":1,"reason":"Both describe missing CSP"}]}' }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    try {
      const result = await reviewCorrelation([
        finding('Content-Security-Policy header not set', 'header'),
        finding('CSP not enforced', 'zap-passive'),
      ])
      expect(result.suggestions).toEqual([{ a: 0, b: 1, reason: 'Both describe missing CSP' }])
      expect(result.note).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('discards hallucinated indices even from a successful call', async () => {
    // The critical safety property: a confident-sounding response referencing
    // a finding that does not exist must produce nothing.
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"pairs":[{"a":0,"b":57,"reason":"definitely the same"}]}' }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    try {
      const result = await reviewCorrelation([finding('A', 'header'), finding('B', 'zap-passive')])
      expect(result.suggestions).toEqual([])
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('never returns severity or scoring information', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"pairs":[{"a":0,"b":1,"reason":"same","severity":"critical","score":10}]}',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    try {
      const result = await reviewCorrelation([finding('A', 'header'), finding('B', 'zap-passive')])
      // Extra fields are dropped: the suggestion shape is fixed.
      expect(Object.keys(result.suggestions[0]).sort()).toEqual(['a', 'b', 'reason'])
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })
})
