import { detectTechnologies } from '@/lib/scanner/analyze'
import {
  CHROMIUM_LAUNCH_ARGS,
  chromiumExecutablePath,
  loadPlaywright,
} from '@/lib/scanner/playwright-loader'
import type { BrowserEvidence, TechnologyEntry } from '@/types/report'

const MAX_RENDERED_DOM = 256 * 1024
const BROWSER_TIMEOUT_MS = 25_000

function truncate(value: string, max = MAX_RENDERED_DOM): string {
  return value.length > max ? `${value.slice(0, max)}\n<!-- truncated -->` : value
}

function dedupeTechnologies(items: TechnologyEntry[]): TechnologyEntry[] {
  const seen = new Map<string, TechnologyEntry>()
  for (const item of items) {
    const key = item.name.toLowerCase()
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, item)
      continue
    }
    if (!existing.version && item.version) existing.version = item.version
    existing.evidence = existing.evidence ?? item.evidence ?? null
    existing.source = existing.source ?? item.source
    existing.confidence = existing.confidence ?? item.confidence
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function detectBrowserTechnologies(renderedDom: string): TechnologyEntry[] {
  const detected: TechnologyEntry[] = detectTechnologies({}, renderedDom).map((technology) => ({
    ...technology,
    source: technology.source ?? 'browser-dom',
    confidence: technology.version ? 'high' : 'medium',
  }))

  const add = (name: string, category: string, evidence: string, version: string | null = null) => {
    detected.push({
      name,
      category,
      version,
      source: 'browser-dom',
      evidence,
      confidence: version ? 'high' : 'medium',
    })
  }

  if (/__NEXT_DATA__|\/_next\/static/.test(renderedDom)) {
    add('Next.js', 'Web Framework', '__NEXT_DATA__ or /_next/static found')
  }
  if (/__NUXT__|\/_nuxt\//.test(renderedDom)) {
    add('Nuxt', 'Web Framework', '__NUXT__ or /_nuxt/ found')
  }
  if (/wp-content|wp-includes|wp-json/i.test(renderedDom)) {
    add('WordPress', 'CMS', 'WordPress path found in rendered DOM')
  }
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(renderedDom)) {
    add('Shopify', 'E-commerce', 'Shopify script or theme object found')
  }

  return dedupeTechnologies(detected)
}

export async function collectBrowserEvidence(url: string): Promise<BrowserEvidence> {
  const collectedAt = new Date().toISOString()
  const unavailable = (reason: string): BrowserEvidence => ({
    available: false,
    reason,
    final_url: null,
    title: null,
    screenshot: null,
    rendered_dom: null,
    technologies: [],
    collected_at: collectedAt,
  })

  const loaded = loadPlaywright()
  if (!loaded.ok) return unavailable(loaded.reason)

  const { chromium } = loaded.playwright
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

  try {
    browser = await chromium.launch({
      headless: true,
      timeout: BROWSER_TIMEOUT_MS,
      ...(chromiumExecutablePath() ? { executablePath: chromiumExecutablePath() } : {}),
      args: CHROMIUM_LAUNCH_ARGS,
    })
  } catch (error) {
    return unavailable(
      `Chromium could not be launched. Run "pnpm exec playwright install chromium" and make sure the host has the required browser dependencies.${
        error instanceof Error && error.message ? ` Details: ${error.message}` : ''
      }`,
    )
  }

  try {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 768 },
      userAgent:
        'Mozilla/5.0 (compatible; VulnSight/1.0; +https://vulnsight.local/about) BrowserProbe',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS)
    page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS)

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS })
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)

    const title = await page.title().catch(() => null)
    const finalUrl = page.url()
    const renderedDom = await page.content()
    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 88,
      fullPage: true,
      timeout: BROWSER_TIMEOUT_MS,
    })

    await context.close()

    return {
      available: true,
      reason: null,
      final_url: finalUrl,
      title: title || null,
      screenshot: `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`,
      rendered_dom: truncate(renderedDom),
      technologies: detectBrowserTechnologies(renderedDom),
      collected_at: collectedAt,
    }
  } catch (error) {
    return unavailable(
      `Browser rendering failed${
        error instanceof Error && error.message ? `: ${error.message}` : '.'
      }`,
    )
  } finally {
    await browser.close().catch(() => undefined)
  }
}
