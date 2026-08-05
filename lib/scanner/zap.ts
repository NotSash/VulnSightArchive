import type { Severity, ZapAlertEvidence, ZapEvidence } from '@/types/report'

const DEFAULT_ZAP_API_URL = 'http://127.0.0.1:8080'

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function zapUrl(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const base = normalizeBaseUrl(process.env.ZAP_API_URL?.trim() || DEFAULT_ZAP_API_URL)
  const url = new URL(path, `${base}/`)
  const apiKey = process.env.ZAP_API_KEY?.trim()
  if (apiKey) url.searchParams.set('apikey', apiKey)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function zapJson<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(zapUrl(path, params), {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`ZAP API returned HTTP ${response.status}`)
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Map a ZAP risk label onto the VulnSight severity scale.
 *
 * ZAP reports risk as free text ("High (Medium)"), so matching is done by
 * substring against the most severe label present.
 */
export function severityFromZap(risk: unknown): Severity {
  const normalized = String(risk ?? '').toLowerCase()
  if (normalized.includes('high')) return 'high'
  if (normalized.includes('medium')) return 'medium'
  if (normalized.includes('low')) return 'low'
  return 'info'
}

/** Split ZAP's whitespace-delimited reference blob into absolute URLs. */
export function splitReferences(value: unknown): string[] {
  return String(value ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))
}

/** Normalize a ZAP `cweid` (numeric or prefixed) into `CWE-nnn` form. */
export function normalizeCwe(value: unknown): string | null {
  const numeric = Number(value)
  if (Number.isInteger(numeric) && numeric > 0) return `CWE-${numeric}`
  const match = String(value ?? '')
    .toUpperCase()
    .match(/CWE-\d+/)
  return match?.[0] ?? null
}

export async function runZapPassiveScan(url: string): Promise<ZapEvidence> {
  const scannedAt = new Date().toISOString()
  const apiUrl = normalizeBaseUrl(process.env.ZAP_API_URL?.trim() || DEFAULT_ZAP_API_URL)
  const unavailable = (reason: string): ZapEvidence => ({
    available: false,
    reason,
    api_url: apiUrl,
    alerts: [],
    scanned_at: scannedAt,
  })

  /*
   * Wait briefly for the daemon rather than giving up on the first refusal.
   *
   * ZAP is started as a sidecar that the app no longer blocks on, because an
   * optional scanner must never prevent the product from booting. The trade is
   * that an early scan can arrive while the JVM is still starting. A cold ZAP
   * takes ~30-60s to answer, so a single attempt would report it "unavailable"
   * purely because the user was quick.
   *
   * This polls for up to 60s and only then records a coverage note. A scan
   * already takes minutes, so waiting a little for a real result is far better
   * than a fast, wrong "not reachable".
   */
  const readyDeadline = Date.now() + 60_000
  let lastError: unknown = null
  let ready = false
  while (Date.now() < readyDeadline) {
    try {
      await zapJson<{ version: string }>('/JSON/core/view/version/', {}, 5_000)
      ready = true
      break
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 3_000))
    }
  }

  if (!ready) {
    return unavailable(
      `OWASP ZAP daemon did not become reachable at ${apiUrl} within 60s. Start ZAP in daemon mode and set ZAP_API_URL/ZAP_API_KEY if needed.${
        lastError instanceof Error && lastError.message ? ` Details: ${lastError.message}` : ''
      }`,
    )
  }

  try {
    // accessUrl makes ZAP fetch the page once so passive scanners can inspect the response.
    // It does not start spidering or active scanning.
    await zapJson('/JSON/core/action/accessUrl/', { url, followRedirects: true }, 20_000)

    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const status = await zapJson<{ recordsToScan: string }>(
        '/JSON/pscan/view/recordsToScan/',
        {},
        5_000,
      )
      if (Number(status.recordsToScan) <= 0) break
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }

    const alertsResponse = await zapJson<{ alerts: Record<string, unknown>[] }>(
      '/JSON/core/view/alerts/',
      { baseurl: url, start: 0, count: 999 },
      10_000,
    )

    const dedupe = new Map<string, ZapAlertEvidence>()
    for (const alert of alertsResponse.alerts ?? []) {
      const item: ZapAlertEvidence = {
        plugin_id: String(alert.pluginId ?? alert.id ?? ''),
        alert: String(alert.alert ?? 'ZAP passive alert'),
        risk: severityFromZap(alert.risk ?? alert.riskdesc),
        confidence: alert.confidence ? String(alert.confidence) : null,
        url: alert.url ? String(alert.url) : null,
        parameter: alert.param ? String(alert.param) : null,
        evidence: alert.evidence ? String(alert.evidence).slice(0, 1000) : null,
        cwe_id: normalizeCwe(alert.cweid),
        references: splitReferences(alert.reference),
      }
      const key = `${item.plugin_id}|${item.alert}|${item.url}|${item.parameter}|${item.evidence}`
      if (!dedupe.has(key)) dedupe.set(key, item)
    }

    return {
      available: true,
      reason: null,
      api_url: apiUrl,
      alerts: [...dedupe.values()],
      scanned_at: scannedAt,
    }
  } catch (error) {
    return unavailable(
      `ZAP passive scan failed${
        error instanceof Error && error.message ? `: ${error.message}` : '.'
      }`,
    )
  }
}
