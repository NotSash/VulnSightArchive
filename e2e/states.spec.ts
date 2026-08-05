import { expect, test } from '@playwright/test'

/**
 * Every state the product can be in, rendered and measured.
 *
 * Ported from `_for-myself/tools/state-audit.mjs`, which stays as the CLI for
 * fast local runs. This spec is the gate.
 *
 * Fifteen states: six for a scan, three for a report, reduced motion on three
 * pages, and scripts-off on three pages. Most are unreachable by clicking,
 * because they need a scan that failed, expired, or skipped a stage, so
 * without stubbing they are exactly the states nobody re-checks.
 *
 * Each state is measured for four things:
 *
 *   1. horizontal overflow
 *   2. console errors and failed requests
 *   3. WCAG contrast on every piece of text, at its real size and weight
 *   4. the specific sentences earlier sessions fixed, so the copy cannot
 *      silently revert
 */

const STAGE_NAMES = [
  'Resolving DNS',
  'Fetching site over HTTP',
  'Analysing security headers',
  'Inspecting TLS certificate',
  'Fingerprinting technologies',
  'Analysing cookies and transport',
  'Checking port reachability',
  'Collecting DNS records',
  'Probing for exposed files',
  'Rendering page',
  'Enumerating ports',
  'Template scanning',
  'Passive analysis',
  'CVE enrichment',
  'Scoring and assembling report',
]

/** Every status the API can report for a stage. `skipped` is a real one. */
type StageStatus = 'completed' | 'running' | 'pending' | 'skipped'

interface TimelineEntry {
  time: string
  event: string
  status: StageStatus
}

/** A timeline of 15 stages with `settled` finished and the next one running. */
function timeline(settled: number, tail: StageStatus = 'running'): TimelineEntry[] {
  return STAGE_NAMES.map((event, i) => ({
    time: `09:5${i % 10}:0${i % 10}`,
    event,
    status: i < settled ? 'completed' : i === settled ? tail : 'pending',
  }))
}

const EMPTY_COUNTS = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }

interface ScanState {
  httpStatus?: number
  body?: unknown
  status?: string
  progress?: number
  stage?: string
  timeline?: TimelineEntry[]
  findings_so_far?: unknown[]
  severity_counts?: typeof EMPTY_COUNTS
  error?: string
  /** Copy that must be present. */
  expect?: string[]
  /** Copy that must be absent, usually a sentence a previous session fixed. */
  forbid?: string[]
}

const SCAN_STATES: Record<string, ScanState> = {
  queued: {
    status: 'queued',
    progress: 0,
    stage: 'Queued',
    timeline: timeline(0, 'pending'),
    findings_so_far: [],
    severity_counts: EMPTY_COUNTS,
    expect: ['Scanning', 'Step 1 of 15'],
  },
  running: {
    status: 'running',
    progress: 60,
    stage: 'Template scanning',
    timeline: timeline(11),
    findings_so_far: [],
    severity_counts: EMPTY_COUNTS,
    expect: ['Scanning', 'Step 12 of 15'],
  },
  skipped: {
    status: 'running',
    progress: 70,
    stage: 'Passive analysis',
    timeline: timeline(12).map((t, i) => (i === 11 ? { ...t, status: 'skipped' } : t)),
    findings_so_far: [],
    severity_counts: EMPTY_COUNTS,
    expect: ['Scanning'],
  },
  completed: {
    status: 'completed',
    progress: 100,
    stage: 'Scoring and assembling report',
    timeline: timeline(15, 'completed'),
    findings_so_far: [],
    severity_counts: EMPTY_COUNTS,
    expect: ['Scanned', 'Took'],
    // A finished scan must not describe itself as running, nor offer to stop.
    forbid: ['Scanning ', 'Stop scan', 'This step usually takes'],
  },
  failed: {
    status: 'failed',
    progress: 40,
    stage: 'Enumerating ports',
    timeline: timeline(8, 'pending'),
    findings_so_far: [],
    severity_counts: EMPTY_COUNTS,
    error: 'The host stopped answering after 8 stages.',
    expect: ['The scan stopped', 'The host stopped answering after 8 stages.'],
    forbid: ['Stop scan'],
  },
  expired: {
    httpStatus: 404,
    body: { error: 'Scan not found.' },
    expect: ['That scan has gone', 'kept in memory for an hour'],
    forbid: ['Stop scan'],
  },
}

/* -------------------------------------------------------------- measurement */

/**
 * WCAG contrast for every piece of text, measured in the page.
 *
 * Two mistakes are baked out of this and must stay that way:
 *
 * 1. `getComputedStyle().color` is often `oklab(...)`, not `rgb(...)`. Parsing
 *    it with a number regex reads it as near-black and produced 47 fake
 *    failures reading exactly 1.07:1. Painting onto a canvas makes the browser
 *    do the conversion.
 * 2. Translucent panels stack. Painting the whole ancestor background stack
 *    before the text is what makes alpha composite correctly, rather than
 *    measuring against a colour nothing actually shows.
 */
function measureContrast() {
  const cv = document.createElement('canvas')
  cv.width = 1
  cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []

  const flatten = (layers: string[], over: string) => {
    ctx.clearRect(0, 0, 1, 1)
    for (const c of [...layers, over]) {
      ctx.fillStyle = c
      ctx.fillRect(0, 0, 1, 1)
    }
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]] as [number, number, number]
  }

  const channel = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const lum = (c: [number, number, number]) =>
    0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])

  const stack = (el: Element) => {
    const layers: string[] = []
    let node: Element | null = el
    while (node) {
      const bg = getComputedStyle(node).backgroundColor
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') layers.unshift(bg)
      node = node.parentElement
    }
    return ['#070C12', ...layers]
  }

  const out: string[] = []
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('nextjs-portal')) continue
    const ownsText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1,
    )
    if (!ownsText) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.9) continue
    if (!el.getBoundingClientRect().height) continue

    const layers = stack(el)
    const bg = flatten(layers, layers[layers.length - 1])
    const fg = flatten(layers, cs.color)
    const [l1, l2] = [lum(fg), lum(bg)]
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const size = Number.parseFloat(cs.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
    const need = large ? 3 : 4.5
    if (ratio < need - 0.01) {
      out.push(
        `${ratio.toFixed(2)} < ${need} at ${size}px: "${(el.textContent ?? '').trim().slice(0, 34)}"`,
      )
    }
  }
  return out
}

function measureOverflow() {
  const w = document.documentElement.clientWidth
  const bad: string[] = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('nextjs-portal')) continue
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.right > w + 1 || r.left < -1)) {
      bad.push(`${el.tagName}.${String(el.className).slice(0, 30)} right=${Math.round(r.right)}`)
    }
  }
  return bad.slice(0, 4)
}

/** Console errors, minus the dev server's own plumbing. */
function watch(page: import('@playwright/test').Page, allow404 = false) {
  const problems: string[] = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (text.includes('webpack-hmr') || text.includes('WebSocket')) return
    // The expired state IS a 404; the browser logs every one of them.
    if (allow404 && text.includes('404')) return
    problems.push(`console: ${text.slice(0, 140)}`)
  })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 140)}`))
  return problems
}

async function assertCopy(page: import('@playwright/test').Page, state: ScanState) {
  const text = await page.locator('body').innerText()
  for (const s of state.expect ?? []) expect(text, `missing copy: "${s}"`).toContain(s)
  for (const s of state.forbid ?? []) expect(text, `stale copy present: "${s}"`).not.toContain(s)
}

/* ------------------------------------------------------------------- scan */

for (const [name, state] of Object.entries(SCAN_STATES)) {
  /*
   * A fresh browser context per state.
   *
   * Playwright reuses one page per worker and Next keeps a client-side router
   * cache, so after an earlier spec visits `/results/sample` the completed
   * scan's `router.push` is served from that cache as a soft navigation that
   * `page.route` never intercepts. The test passed alone and failed in
   * sequence, which is leaked state, not a defect. Each state is an
   * independent scenario, so it gets an independent browser.
   */
  test(`scan / ${name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const problems = watch(page, state.httpStatus === 404)

    await page.route('**/api/status/**', (route) =>
      route.fulfill({
        status: state.httpStatus ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(
          state.body ?? { scan_id: 'vs_state', hostname: 'scanme.nmap.org', ...state },
        ),
      }),
    )
    /*
     * The completed state redirects to the report 650ms after the last stage
     * lands, so the frame under test is short-lived.
     *
     * Blocking the report route rather than 404ing it: a 404 let the redirect
     * proceed and the assertions then ran against "Report not available",
     * which is a real page but not the one being measured. Aborting the
     * navigation keeps the scan page on screen. The redirect itself is proven
     * separately by `tests/audit-fixes.test.ts` (E1).
     */
    await page.goto('/scan/vs_state')

    /*
     * The completed frame lives for 650ms before `router.push` moves to the
     * report, so this races deliberately: wait for the heading that only the
     * finished scan shows, then measure immediately.
     *
     * Blocking the redirect instead does not work, and the attempt is worth
     * recording. Aborting `/api/report/**` still let the navigation happen and
     * left the REPORT page showing its own "Report not available" error, which
     * looked like leaked router-cache state and is not. Aborting
     * every `/results/` request wholesale killed the page's own chunks and
     * produced an empty body. Waiting for the real frame is simpler and tests the thing
     * that actually ships.
     */
    if (name === 'completed') {
      /*
       * This frame lives for 650ms before `router.push` moves to the report,
       * so wait for the heading only the finished scan shows, then measure
       * immediately. Blocking the redirect instead does not work: aborting
       * `/api/report/**` still navigates and leaves the REPORT page showing
       * its own "Report not available", and aborting every `/results/`
       * request kills the page's own chunks and empties the body.
       */
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Scanned', {
        timeout: 5_000,
      })
    } else {
      await page.waitForTimeout(1200)
    }

    try {
      await assertCopy(page, state)
      expect(await page.evaluate(measureOverflow)).toEqual([])
      expect(await page.evaluate(measureContrast)).toEqual([])
      expect(problems).toEqual([])
    } finally {
      await context.close()
    }
  })
}

/* ----------------------------------------------------------------- report */

test.describe('report states', () => {
  test('full, empty and bare all render honestly', async ({ page, request }) => {
    const sample = await (await request.get('/api/report/sample')).json()

    const REPORTS: Record<string, { report: unknown; expect: string[]; forbid?: string[] }> = {
      full: { report: sample, expect: ['Start with these'] },
      empty: {
        report: {
          ...sample,
          vulnerabilities: [],
          cves: [],
          severity_distribution: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          risk: { score: 100, category: 'Low', penalties: [] },
        },
        /*
         * The empty report must not contradict the page around it. It used to
         * say "passive assessment" on a deep scan and offer generic
         * best-practice advice, directly above a table listing six missing
         * headers.
         */
        expect: ['No findings', 'Every tool ran'],
        forbid: ['passive assessment', 'security best practices'],
      },
      bare: { report: { ...sample, cves: [], notes: [] }, expect: ['Vulnerabilities'] },
    }

    for (const [name, state] of Object.entries(REPORTS)) {
      await test.step(name, async () => {
        const problems = watch(page)
        await page.route('**/api/report/**', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(state.report),
          }),
        )
        await page.goto('/results/vs_state')
        await page.waitForTimeout(1600)

        await assertCopy(page, state)
        expect(await page.evaluate(measureOverflow)).toEqual([])
        expect(await page.evaluate(measureContrast)).toEqual([])
        expect(problems).toEqual([])
        await page.unroute('**/api/report/**')
      })
    }
  })
})

/* --------------------------------------------------------- reduced motion */

test.describe('reduced motion', () => {
  /*
   * `contextOptions`, not `reducedMotion`.
   *
   * The desktop project spreads `devices['Desktop Chrome']`, which carries its
   * own context options, and that spread wins over a bare `test.use({
   * reducedMotion })`. The preference silently did not apply: `matchMedia(
   * '(prefers-reduced-motion: reduce)')` returned false and the spec then
   * measured the ordinary page and "found" four infinite animations that are
   * correct when motion is allowed. A green or red tick from a preference that
   * was never set is worthless either way, so this asserts the preference is
   * live before measuring anything.
   */
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  for (const path of ['/', '/results/sample', '/scan/vs_state']) {
    test(`nothing loops on ${path}`, async ({ page }) => {
      await page.route('**/api/status/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            scan_id: 'vs_state',
            hostname: 'scanme.nmap.org',
            ...SCAN_STATES.running,
          }),
        }),
      )
      await page.goto(path)
      await page.waitForTimeout(1600)

      // Prove the preference is actually in effect before trusting the result.
      expect(
        await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
        'reduced-motion preference did not apply, so this measurement means nothing',
      ).toBe(true)

      const bad = await page.evaluate(() => {
        const out: string[] = []
        for (const el of document.querySelectorAll('body *')) {
          if (el.closest('nextjs-portal')) continue
          const cs = getComputedStyle(el)
          if (cs.animationIterationCount.split(',').some((v) => v.trim() === 'infinite')) {
            out.push(`infinite animation: ${cs.animationName} on ${el.tagName}`)
          }
          /*
           * An entrance left mid-fade is worse than no animation: the content
           * is simply dimmer than it should be, forever.
           */
          if (Number(cs.opacity) < 0.99 && String(el.className).includes('rise')) {
            out.push(`entrance stuck faded: ${String(el.className).slice(0, 40)}`)
          }
        }
        return out.slice(0, 4)
      })

      expect(bad).toEqual([])
    })
  }
})

/* ------------------------------------------------------------- no scripts */

test.describe('scripts disabled', () => {
  test.use({ javaScriptEnabled: false })

  const MINIMUMS: [string, number][] = [
    ['/', 3000],
    ['/results/sample', 250],
    ['/scan/vs_state', 40],
  ]

  for (const [path, min] of MINIMUMS) {
    test(`${path} still says something`, async ({ page }) => {
      await page.goto(path)
      const text = (await page.locator('body').innerText()).trim()

      expect(text.length, `only ${text.length} characters of readable text`).toBeGreaterThanOrEqual(
        min,
      )

      /*
       * The scan page cannot work without scripts, which is acceptable.
       * Presenting invented progress is not: `total` fell back to 1 before the
       * first poll and rendered "Step 1 of 1", a scan that appears to have one
       * step and be stuck on it.
       */
      if (path.startsWith('/scan')) expect(text).not.toContain('Step 1 of 1')

      /*
       * A skeleton left at `aria-busy` with no script to finish loading tells
       * assistive technology to keep waiting for something that will never
       * arrive.
       */
      const busy = await page.locator('[aria-busy="true"]:not(.js-only)').count()
      expect(busy, 'element left aria-busy with no script to resolve it').toBe(0)
    })
  }
})
