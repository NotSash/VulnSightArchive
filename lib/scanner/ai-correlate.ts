/**
 * Optional AI-assisted correlation review.
 *
 * The deterministic engine in `correlate.ts` groups findings using explicit
 * rules, which means it only catches overlaps it already knows about. Tools
 * occasionally describe the same weakness in wording no rule anticipated.
 *
 * This module asks a language model to *propose* additional links between
 * findings the deterministic pass left separate. It is strictly advisory:
 *
 * - It cannot merge anything. It returns suggestions, and the caller decides.
 * - It cannot change severity, CVSS, or the risk score. Those stay
 *   deterministic and reproducible, by design.
 * - It cannot invent findings. It only ever references ids it was given.
 * - Every suggestion carries the model's stated reason, so a human can audit
 *   it in the report rather than trusting it blindly.
 *
 * When no API key is configured, or the call fails, or the response is
 * malformed, the deterministic result stands unchanged and a coverage note
 * records why. Nothing downstream depends on this succeeding.
 */

import { logger } from '@/lib/logger'
import type { ScanNote, Vulnerability } from '@/types/report'

type Finding = Omit<Vulnerability, 'id'>

/** A model-proposed relationship between two findings. */
export interface CorrelationSuggestion {
  /** Index into the findings array supplied to the reviewer. */
  a: number
  /** Index of the finding the model believes describes the same issue. */
  b: number
  /** The model's stated justification, surfaced for human review. */
  reason: string
}

export interface AiCorrelationResult {
  /** Suggestions that passed validation. Never applied automatically. */
  suggestions: CorrelationSuggestion[]
  /** Present when the review did not run or did not complete. */
  note?: ScanNote
}

const EMPTY: AiCorrelationResult = { suggestions: [] }

function prompt(findings: Finding[]): string {
  const catalogue = findings.map((finding, index) => ({
    index,
    title: finding.title,
    source: finding.source,
    cwe_id: finding.cwe_id,
    cve_id: finding.cve_id,
    location: finding.location ?? null,
  }))

  return `You are reviewing the output of several independent web security scanners.

Some scanners describe the SAME underlying weakness using different wording. Your only task is to identify pairs of findings that describe the same underlying issue.

Strict rules:
- Only reference the numeric "index" values listed below. Never invent findings.
- Two findings match ONLY if they describe the same weakness at the same location.
- Different security headers are DIFFERENT issues (CSP is not HSTS).
- Different cookie attributes are DIFFERENT issues (Secure is not HttpOnly).
- The same weakness at different URLs is a DIFFERENT issue.
- If you are not confident, do not suggest the pair. Omission is always safe.
- Do NOT comment on severity, risk, or remediation.

Return ONLY valid JSON of this exact shape:
{"pairs": [{"a": <index>, "b": <index>, "reason": "<short explanation>"}]}

If nothing matches, return {"pairs": []}.

Findings:
${JSON.stringify(catalogue, null, 2)}`
}

/**
 * Validate a raw model response into trustworthy suggestions.
 *
 * Anything ambiguous is discarded rather than repaired: a malformed suggestion
 * is worthless, and silently "fixing" one risks fabricating a link the model
 * never actually proposed.
 */
export function parseSuggestions(raw: string, findingCount: number): CorrelationSuggestion[] {
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return []
  }

  const pairs = (parsed as { pairs?: unknown })?.pairs
  if (!Array.isArray(pairs)) return []

  const seen = new Set<string>()
  const suggestions: CorrelationSuggestion[] = []

  for (const entry of pairs) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>

    const a = Number(record.a)
    const b = Number(record.b)

    // Indices must be real, in range, and refer to two different findings.
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue
    if (a < 0 || b < 0 || a >= findingCount || b >= findingCount) continue
    if (a === b) continue

    // Normalize ordering so (3,1) and (1,3) are recognised as one suggestion.
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (seen.has(key)) continue
    seen.add(key)

    const reason = String(record.reason ?? '')
      .trim()
      .slice(0, 300)
    if (!reason) continue

    suggestions.push({ a: Math.min(a, b), b: Math.max(a, b), reason })
  }

  // Cap the volume: a model proposing dozens of links is not being careful.
  return suggestions.slice(0, 10)
}

async function callGemini(text: string, apiKey: string): Promise<string> {
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-1.5-flash'
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}`)

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? ''
}

async function callOpenAi(text: string, apiKey: string): Promise<string> {
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You identify duplicate security findings. You never invent findings and never comment on severity.',
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`)

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return data.choices?.[0]?.message?.content ?? ''
}

/**
 * Ask an optional LLM to review findings the deterministic pass left separate.
 *
 * Returns suggestions only. The caller applies them (or not); this function
 * never mutates a finding.
 */
export async function reviewCorrelation(findings: Finding[]): Promise<AiCorrelationResult> {
  // Nothing to relate, or too few findings for review to be meaningful.
  if (findings.length < 2) return EMPTY

  /*
   * Reviewing a very large finding set would produce an unwieldy prompt and
   * invite sloppy pattern-matching. The deterministic pass already handles the
   * common overlaps, so skip the optional review rather than degrade it.
   */
  if (findings.length > 60) {
    return {
      suggestions: [],
      note: {
        stage: 'AI correlation review',
        status: 'skipped',
        detail: `${findings.length} findings exceeded the review limit. Deterministic correlation was applied in full; the optional AI review was skipped.`,
      },
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim()
  const openAiKey = process.env.OPENAI_API_KEY?.trim()

  if (!geminiKey && !openAiKey) {
    return {
      suggestions: [],
      note: {
        stage: 'AI correlation review',
        status: 'skipped',
        detail:
          'No GEMINI_API_KEY or OPENAI_API_KEY is configured. Deterministic correlation was applied; the optional AI review did not run.',
      },
    }
  }

  try {
    const text = prompt(findings)
    const raw = geminiKey
      ? await callGemini(text, geminiKey)
      : await callOpenAi(text, openAiKey as string)

    return { suggestions: parseSuggestions(raw, findings.length) }
  } catch (error) {
    logger.warn('AI correlation review failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      suggestions: [],
      note: {
        stage: 'AI correlation review',
        status: 'failed',
        detail: `The optional AI correlation review did not complete${
          error instanceof Error && error.message ? `: ${error.message}` : '.'
        } Deterministic correlation is unaffected.`,
      },
    }
  }
}
