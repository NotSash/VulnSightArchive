/**
 * Scanner availability reporting.
 *
 * Each integration degrades gracefully when its dependency is missing, which
 * is the right behaviour during a scan but makes misconfiguration easy to
 * overlook — a container with no Nmap still serves pages and still returns
 * reports, just quieter ones.
 *
 * This module answers "which scanners can actually run right now?" so the
 * answer is visible in a health check and in the UI, rather than only appearing
 * as a coverage note after someone has waited for a scan to finish.
 */

import { existsSync } from 'node:fs'
import { logger } from '@/lib/logger'
import {
  CHROMIUM_LAUNCH_ARGS,
  chromiumExecutablePath,
  loadPlaywright,
} from '@/lib/scanner/playwright-loader'
import { findBinary, runCommand } from '@/lib/scanner/tools'

export interface ToolStatus {
  /** Stable identifier used by the UI. */
  id: 'nmap' | 'nuclei' | 'zap' | 'chromium' | 'nvd' | 'ai'
  /** Human-readable name. */
  name: string
  /** Whether the dependency is present and usable. */
  available: boolean
  /** Version string when the tool reports one. */
  version: string | null
  /** Why the tool is unavailable, or extra context when it is. */
  detail: string | null
  /**
   * True when the scanner cannot work at all without this. Optional tools
   * being absent is a degraded state, not a failure.
   */
  required: boolean
}

export interface HealthReport {
  status: 'ok' | 'degraded'
  /** Tools that are ready to run. */
  ready: number
  /** Total number of integrations checked. */
  total: number
  tools: ToolStatus[]
  checked_at: string
}

/** Extract the first version-looking token from a tool's banner output. */
function extractVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+(?:\.\d+)?)\b/)
  return match?.[1] ?? null
}

async function checkNmap(): Promise<ToolStatus> {
  const base: ToolStatus = {
    id: 'nmap',
    name: 'Nmap',
    available: false,
    version: null,
    detail: null,
    required: false,
  }

  const tool = await findBinary('nmap', 'NMAP_PATH')
  if (!tool.available || !tool.binary) {
    return { ...base, detail: tool.reason ?? 'Binary not found on PATH.' }
  }

  const result = await runCommand(tool.binary, ['--version'], { timeoutMs: 5_000 })
  if (!result.ok) {
    return { ...base, detail: 'Binary found but did not execute successfully.' }
  }

  return {
    ...base,
    available: true,
    version: extractVersion(result.stdout),
    detail: tool.binary,
  }
}

async function checkNuclei(): Promise<ToolStatus> {
  const base: ToolStatus = {
    id: 'nuclei',
    name: 'Nuclei',
    available: false,
    version: null,
    detail: null,
    required: false,
  }

  const tool = await findBinary('nuclei', 'NUCLEI_PATH')
  if (!tool.available || !tool.binary) {
    return { ...base, detail: tool.reason ?? 'Binary not found on PATH.' }
  }

  const templates = process.env.NUCLEI_TEMPLATES?.trim()
  const hasTemplates = templates ? existsSync(templates) : false

  // Nuclei writes its banner to stderr, so both streams are inspected.
  const result = await runCommand(tool.binary, ['-version'], { timeoutMs: 10_000 })
  const banner = `${result.stdout} ${result.stderr}`

  if (!hasTemplates) {
    return {
      ...base,
      available: false,
      version: extractVersion(banner),
      detail: templates
        ? `Binary found, but the template directory "${templates}" does not exist.`
        : 'Binary found, but NUCLEI_TEMPLATES is not configured.',
    }
  }

  return {
    ...base,
    available: true,
    version: extractVersion(banner),
    detail: `Templates: ${templates}`,
  }
}

async function checkZap(): Promise<ToolStatus> {
  const base: ToolStatus = {
    id: 'zap',
    name: 'OWASP ZAP',
    available: false,
    version: null,
    detail: null,
    required: false,
  }

  const apiUrl = (process.env.ZAP_API_URL?.trim() || 'http://127.0.0.1:8080').replace(/\/+$/, '')

  try {
    const url = new URL('/JSON/core/view/version/', `${apiUrl}/`)
    const apiKey = process.env.ZAP_API_KEY?.trim()
    if (apiKey) url.searchParams.set('apikey', apiKey)

    const response = await fetch(url, { signal: AbortSignal.timeout(4_000), cache: 'no-store' })
    if (!response.ok) {
      return { ...base, detail: `Daemon responded with HTTP ${response.status}.` }
    }

    const data = (await response.json()) as { version?: string }
    return {
      ...base,
      available: true,
      version: data.version ?? null,
      detail: apiUrl,
    }
  } catch {
    return { ...base, detail: `No ZAP daemon reachable at ${apiUrl}.` }
  }
}

async function checkChromium(): Promise<ToolStatus> {
  const base: ToolStatus = {
    id: 'chromium',
    name: 'Chromium (Playwright)',
    available: false,
    version: null,
    detail: null,
    required: false,
  }

  try {
    const loaded = loadPlaywright()
    if (!loaded.ok) return { ...base, detail: loaded.reason.slice(0, 200) }

    /*
     * Actually launching is the only reliable check. A present binary can still
     * fail to start when a shared library is missing, which is the most common
     * container misconfiguration for headless browsers.
     */
    const executablePath = chromiumExecutablePath()
    const browser = await loaded.playwright.chromium.launch({
      headless: true,
      timeout: 15_000,
      ...(executablePath ? { executablePath } : {}),
      // Matches the launch flags used by the scanner itself, so this check
      // exercises the same code path rather than a more permissive one.
      args: CHROMIUM_LAUNCH_ARGS,
    })
    const version = browser.version()
    await browser.close()

    return { ...base, available: true, version, detail: executablePath ?? 'bundled' }
  } catch (error) {
    return {
      ...base,
      detail: error instanceof Error ? error.message.slice(0, 200) : 'Chromium failed to launch.',
    }
  }
}

/** NVD works without a key; a key only raises the rate limit. */
function checkNvd(): ToolStatus {
  const hasKey = Boolean(process.env.NVD_API_KEY?.trim())
  return {
    id: 'nvd',
    name: 'NVD CVE database',
    available: true,
    version: null,
    detail: hasKey
      ? 'API key configured (higher rate limit).'
      : 'No API key: usable, but rate limited to roughly 5 requests per 30 seconds.',
    required: false,
  }
}

/** AI rewriting is optional; the deterministic engine covers its absence. */
function checkAi(): ToolStatus {
  const gemini = Boolean(process.env.GEMINI_API_KEY?.trim())
  const openai = Boolean(process.env.OPENAI_API_KEY?.trim())
  const provider = gemini ? 'Gemini' : openai ? 'OpenAI' : null

  return {
    id: 'ai',
    name: 'AI summary rewriting',
    available: provider !== null,
    version: null,
    detail: provider
      ? `${provider} configured. Summaries only, never detection or scoring.`
      : 'No API key. Deterministic rule-engine summaries are used instead.',
    required: false,
  }
}

/**
 * Probe every integration.
 *
 * Checks run concurrently because the Chromium launch dominates the total
 * time and there is no ordering dependency between them.
 */
export async function checkScannerHealth(): Promise<HealthReport> {
  const [nmap, nuclei, zap, chromium] = await Promise.all([
    checkNmap(),
    checkNuclei(),
    checkZap(),
    checkChromium(),
  ])

  const tools = [nmap, nuclei, zap, chromium, checkNvd(), checkAi()]
  const ready = tools.filter((tool) => tool.available).length

  const unavailableRequired = tools.filter((tool) => tool.required && !tool.available)
  if (unavailableRequired.length > 0) {
    logger.warn('required scanner dependencies unavailable', {
      tools: unavailableRequired.map((tool) => tool.id),
    })
  }

  return {
    // Optional tools missing is degraded, not broken: the app still scans.
    status: unavailableRequired.length === 0 ? 'ok' : 'degraded',
    ready,
    total: tools.length,
    tools,
    checked_at: new Date().toISOString(),
  }
}
