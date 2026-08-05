import { expect, test } from '@playwright/test'

/**
 * Mobile layout rules, enforced in CI.
 *
 * Ported from `_for-myself/tools/mobile-audit.mjs`, which stays as the CLI for
 * fast local iteration and for the richer diagnostic output. This spec is the
 * gate: the CLI is only useful if somebody remembers to run it, and nobody
 * remembers forever.
 *
 * The thresholds are not opinions:
 *
 * - **44px** is the minimum comfortable touch target in both Apple's and
 *   Google's guidance.
 * - **12px** is the floor where body text stops being readable on a phone.
 *   `globals.css` lifts the smallest authored step to exactly 12px on coarse
 *   pointers, so this number and that floor are one decision stated twice.
 *   Change both together.
 * - **16px** on inputs, because iOS Safari zooms the page in when a smaller
 *   field receives focus and never zooms back out. It is the single most
 *   common reason a mobile form feels broken.
 *
 * Viewports are emulated by size rather than by `devices[...]`: the full
 * Chromium build that device presets require cannot start in this sandbox.
 * Width is what every rule here actually depends on.
 */

const VIEWPORTS = [
  { name: '360x640 small Android (floor)', width: 360, height: 640 },
  { name: '390x844 iPhone 14/15 (primary)', width: 390, height: 844 },
  { name: '430x932 large phone', width: 430, height: 932 },
  { name: '768x1024 tablet', width: 768, height: 1024 },
] as const

interface AuditPage {
  name: string
  path: string
  /** Stub `/api/status/**` so the scan page renders its real running layout. */
  stubStatus?: boolean
}

const PAGES: AuditPage[] = [
  { name: 'home', path: '/' },
  { name: 'report', path: '/results/sample' },
  { name: 'scan', path: '/scan/vs_e2e', stubStatus: true },
]

const MIN_TAP = 44
const MIN_FONT = 12
const MIN_INPUT_FONT = 16

/** A running scan, so the scan page renders its real layout rather than a spinner. */
const STAGE_NAMES = [
  'Resolving DNS',
  'Fetching site over HTTP',
  'Analyzing security headers',
  'Inspecting TLS certificate',
  'Fingerprinting technologies',
  'Analyzing cookies and transport',
  'Checking port reachability',
  'Collecting DNS records',
  'Probing for exposed files',
  'Rendering page (Playwright)',
  'Enumerating ports (Nmap)',
  'Template scanning (Nuclei)',
  'Passive analysis (OWASP ZAP)',
  'CVE enrichment (NVD)',
  'Scoring and assembling report',
]

function runningScan() {
  return {
    scan_id: 'vs_e2e',
    hostname: 'scanme.nmap.org',
    status: 'running',
    progress: 70,
    stage: 'Template scanning (Nuclei)',
    timeline: STAGE_NAMES.map((event, i) => ({
      time: `16:24:${String(8 + i).padStart(2, '0')}`,
      event,
      detail: i === 10 ? '4 open ports found' : undefined,
      status: i === 3 ? 'skipped' : i < 11 ? 'completed' : i === 11 ? 'running' : 'pending',
    })),
    findings_so_far: [
      { title: 'Site is served over plaintext HTTP', severity: 'high', source: 'transport' },
      { title: 'Content-Security-Policy header not set', severity: 'medium', source: 'header' },
    ],
    severity_counts: { critical: 0, high: 1, medium: 1, low: 0, info: 0 },
  }
}

/**
 * Measurements taken in the page.
 *
 * One `evaluate` rather than several: each round trip costs a few milliseconds
 * and this runs 12 times.
 */
function collect(limits: { minTap: number; minFont: number; minInputFont: number }) {
  const doc = document.documentElement

  const visible = (el: Element) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  const describe = (el: Element) =>
    `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).slice(0, 40)}`

  /* ---- horizontal overflow ---- */
  const overflow = doc.scrollWidth - doc.clientWidth
  const culprits: string[] = []
  if (overflow > 1) {
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.right > doc.clientWidth + 1 || r.left < -1) {
        /*
         * Report the outermost element in each chain. A child is usually only
         * too wide because its parent is, and listing every descendant buries
         * the one line that matters.
         */
        if (el.parentElement && el.parentElement !== document.body) {
          const pr = el.parentElement.getBoundingClientRect()
          if (pr.right > doc.clientWidth + 1 || pr.left < -1) continue
        }
        culprits.push(`${describe(el)} right=${Math.round(r.right)}`)
      }
      if (culprits.length >= 6) break
    }
  }

  /* ---- touch targets ---- */
  const small: string[] = []
  for (const el of document.querySelectorAll('a[href], button, input, select, [role="button"]')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    /*
     * A pseudo-element can extend the real hit area well beyond the drawn box,
     * and `.touch-target` in `globals.css` does exactly that: a centred
     * `::after` with `min-width/min-height: 44px`. The pipeline segments on
     * the home page are deliberately 3px to 10px wide, because their widths
     * ARE the data (each is proportional to how long that tool took), so
     * widening them would be inventing a timing.
     *
     * Reading `top` and doubling it does not work here: the offset is `50%`
     * with a transform, so the arithmetic gives zero. Take the resolved
     * `min-width`/`min-height` instead, which is the size the browser will
     * actually hit-test.
     */
    const after = getComputedStyle(el, '::after')
    const hasAfter = after.content !== 'none' && after.position === 'absolute'
    const afterW = hasAfter ? Number.parseFloat(after.minWidth) || 0 : 0
    const afterH = hasAfter ? Number.parseFloat(after.minHeight) || 0 : 0
    const w = Math.max(r.width, afterW)
    const h = Math.max(r.height, afterH)
    if (w < limits.minTap || h < limits.minTap) {
      small.push(`${describe(el)} ${Math.round(w)}x${Math.round(h)}`)
    }
    if (small.length >= 8) break
  }

  /* ---- text too small to read ---- */
  const tiny: string[] = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const ownsText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1,
    )
    if (!ownsText) continue
    const size = Number.parseFloat(getComputedStyle(el).fontSize)
    if (size < limits.minFont) {
      tiny.push(`${describe(el)} ${size}px "${(el.textContent ?? '').trim().slice(0, 24)}"`)
    }
    if (tiny.length >= 8) break
  }

  /* ---- inputs that would trigger an iOS zoom ---- */
  const zoomy: string[] = []
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (!visible(el)) continue
    const size = Number.parseFloat(getComputedStyle(el).fontSize)
    if (size < limits.minInputFont) zoomy.push(`${describe(el)} ${size}px`)
  }

  return { overflow, culprits, small, tiny, zoomy }
}

for (const page of PAGES) {
  for (const vp of VIEWPORTS) {
    /*
     * A touch device, not a narrow desktop window.
     *
     * `globals.css` gates the mobile type floor and the `.touch-target` hit
     * areas behind `pointer: coarse`. Without `hasTouch` Chromium reports a
     * mouse, those rules never apply, and the spec then measures a page the
     * product never actually serves to a phone: a 128x20 link fails here that
     * is 44px tall on a real device.
     *
     * `hasTouch` is true for every entry including the 768px tablet, which is
     * an iPad. `isMobile` stays width-based, because it also switches the user
     * agent and meta-viewport handling, which a tablet does not want.
     */
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: vp.width < 768 })

    test(`${page.name} at ${vp.name}`, async ({ page: browserPage }) => {
      const consoleErrors: string[] = []
      browserPage.on('console', (m) => {
        if (m.type() !== 'error') return
        const text = m.text()
        // Dev-server plumbing, absent from a production build.
        if (text.includes('webpack-hmr') || text.includes('WebSocket')) return
        consoleErrors.push(text.slice(0, 140))
      })

      if (page.stubStatus) {
        await browserPage.route('**/api/status/**', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(runningScan()),
          }),
        )
      }

      await browserPage.goto(page.path)

      // The report assembles itself in the browser; measuring the skeleton
      // would measure the wrong page.
      if (page.name === 'report') {
        await expect(
          browserPage.getByRole('heading', { name: /scanme\.nmap\.org/i }).first(),
        ).toBeVisible()
      }
      await browserPage.waitForTimeout(600)

      const result = await browserPage.evaluate(collect, {
        minTap: MIN_TAP,
        minFont: MIN_FONT,
        minInputFont: MIN_INPUT_FONT,
      })

      expect(result.culprits, `${result.overflow}px of horizontal overflow`).toEqual([])
      expect(result.overflow).toBeLessThanOrEqual(1)
      expect(result.small, `touch targets under ${MIN_TAP}px`).toEqual([])
      expect(result.tiny, `text under ${MIN_FONT}px`).toEqual([])
      expect(result.zoomy, `inputs under ${MIN_INPUT_FONT}px would zoom iOS Safari`).toEqual([])
      expect(consoleErrors).toEqual([])
    })
  }
}
