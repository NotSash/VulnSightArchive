import { buildSummary } from '@/lib/scanner/summary'
import type {
  AiEvidence,
  AiSummary,
  RemediationRoadmap,
  RiskScore,
  ScanNote,
  SeverityDistribution,
  Vulnerability,
} from '@/types/report'

interface BuildAiOptions {
  domain: string
  dist: SeverityDistribution
  risk: RiskScore
  vulns: Vulnerability[]
  notes: ScanNote[]
}

interface AiResult {
  summary: AiSummary
  evidence: AiEvidence
  note?: ScanNote
}

function deterministic(options: BuildAiOptions, reason: string | null): AiResult {
  return {
    summary: buildSummary(options),
    evidence: {
      available: false,
      provider: 'deterministic',
      reason,
      generated_at: new Date().toISOString(),
    },
    note: reason
      ? {
          stage: 'LLM summary',
          status: 'skipped',
          detail: reason,
        }
      : undefined,
  }
}

function prompt(options: BuildAiOptions): string {
  return `You rewrite verified security scan findings. You MUST NOT invent, infer, or detect vulnerabilities. Only summarize the JSON evidence below.

Return only valid JSON with this exact shape:
{
  "executive_summary": string,
  "technical_summary": string,
  "key_risks": string[],
  "recommendations": string[],
  "remediation": { "immediate": string[], "short_term": string[], "long_term": string[] }
}

Verified scan data:
${JSON.stringify(
  {
    domain: options.domain,
    risk: options.risk,
    severity_distribution: options.dist,
    findings: options.vulns.map((v) => ({
      title: v.title,
      severity: v.severity,
      description: v.description,
      impact: v.impact,
      recommendation: v.recommendation,
      evidence: v.evidence ?? null,
      source: v.source,
      cwe_id: v.cwe_id,
      cve_id: v.cve_id,
      owasp_category: v.owasp_category,
    })),
    coverage_notes: options.notes,
  },
  null,
  2,
)}`
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => String(item))
        .filter(Boolean)
        .slice(0, 8)
    : []
}

function parseSummary(raw: string, generatedBy: string): AiSummary | null {
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const remediation = (parsed.remediation ?? {}) as Partial<RemediationRoadmap>
    return {
      executive_summary: String(parsed.executive_summary ?? ''),
      technical_summary: String(parsed.technical_summary ?? ''),
      key_risks: coerceStringArray(parsed.key_risks),
      recommendations: coerceStringArray(parsed.recommendations),
      remediation: {
        immediate: coerceStringArray(remediation.immediate),
        short_term: coerceStringArray(remediation.short_term),
        long_term: coerceStringArray(remediation.long_term),
      },
      generated_by: generatedBy,
      available: true,
    }
  } catch {
    return null
  }
}

async function gemini(options: BuildAiOptions, apiKey: string): Promise<AiSummary> {
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-1.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt(options) }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
  })
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}`)
  const data = (await response.json()) as Record<string, unknown>
  const text = String(
    (
      ((data.candidates as unknown[])?.[0] as Record<string, unknown> | undefined)?.content as
        | Record<string, unknown>
        | undefined
    )?.parts
      ? (
          (
            ((data.candidates as unknown[])[0] as Record<string, unknown>).content as Record<
              string,
              unknown
            >
          ).parts as Record<string, unknown>[]
        )
          .map((part) => part.text)
          .join('\n')
      : '',
  )
  const parsed = parseSummary(text, `Gemini (${model})`)
  if (!parsed) throw new Error('Gemini response was not valid summary JSON')
  return parsed
}

async function openai(options: BuildAiOptions, apiKey: string): Promise<AiSummary> {
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You rewrite verified security scan findings. You never invent or detect vulnerabilities.',
        },
        { role: 'user', content: prompt(options) },
      ],
    }),
  })
  if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`)
  const data = (await response.json()) as Record<string, unknown>
  const text = String(
    (
      ((data.choices as unknown[])?.[0] as Record<string, unknown> | undefined)?.message as
        | Record<string, unknown>
        | undefined
    )?.content ?? '',
  )
  const parsed = parseSummary(text, `OpenAI (${model})`)
  if (!parsed) throw new Error('OpenAI response was not valid summary JSON')
  return parsed
}

export async function buildOptionalAiSummary(options: BuildAiOptions): Promise<AiResult> {
  const geminiKey = process.env.GEMINI_API_KEY?.trim()
  const openAiKey = process.env.OPENAI_API_KEY?.trim()

  if (!geminiKey && !openAiKey) {
    return deterministic(
      options,
      'No GEMINI_API_KEY or OPENAI_API_KEY is configured. Deterministic summaries were used instead; add an API key to enable optional AI rewriting.',
    )
  }

  try {
    if (geminiKey) {
      return {
        summary: await gemini(options, geminiKey),
        evidence: {
          available: true,
          provider: 'gemini',
          reason: null,
          generated_at: new Date().toISOString(),
        },
      }
    }

    return {
      summary: await openai(options, openAiKey!),
      evidence: {
        available: true,
        provider: 'openai',
        reason: null,
        generated_at: new Date().toISOString(),
      },
    }
  } catch (error) {
    return deterministic(
      options,
      `Optional AI rewriting failed${
        error instanceof Error && error.message ? `: ${error.message}` : '.'
      } Deterministic summaries were used instead.`,
    )
  }
}
