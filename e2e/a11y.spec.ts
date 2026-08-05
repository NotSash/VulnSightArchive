import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Accessibility, enforced in CI.
 *
 * Two halves, because they catch different things:
 *
 * 1. **axe** on every state. Automated rules find roughly a third of real
 *    accessibility problems, but they find that third reliably and never get
 *    bored. Running it on the states nobody can reach by clicking is the whole
 *    point: a failed scan and an expired scan are exactly where a heading
 *    level or a missing label rots unnoticed.
 * 2. **A keyboard journey.** The half axe cannot see. Tab order, focus
 *    visibility, and whether a keyboard user can actually complete the one
 *    task the product exists for.
 *
 * Both were clean when written. That is the point: this locks it in.
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

type StageStatus = 'completed' | 'running' | 'pending' | 'skipped'

function timeline(settled: number, tail: StageStatus = 'running') {
  return STAGE_NAMES.map((event, i) => ({
    time: `09:5${i % 10}:0${i % 10}`,
    event,
    status: i < settled ? 'completed' : i === settled ? tail : 'pending',
  }))
}

const EMPTY_COUNTS = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }

/**
 * WCAG 2.1 A and AA.
 *
 * Deliberately not `best-practice`: those rules encode opinions rather than
 * conformance, and a gate that fails on an opinion gets disabled.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function expectNoViolations(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const summary = results.violations.map(
    (v) => `[${v.impact}] ${v.id} x${v.nodes.length}: ${v.help}\n    ${v.nodes[0]?.html?.slice(0, 120)}`,
  )
  expect(summary, `${label} has accessibility violations`).toEqual([])
}

/* ------------------------------------------------------------- scan states */

const SCAN_STATES: Record<string, { status?: number; body: unknown }> = {
  queued: {
    body: {
      scan_id: 'vs_a11y',
      hostname: 'scanme.nmap.org',
      status: 'queued',
      progress: 0,
      stage: 'Queued',
      timeline: timeline(0, 'pending'),
      findings_so_far: [],
      severity_counts: EMPTY_COUNTS,
    },
  },
  running: {
    body: {
      scan_id: 'vs_a11y',
      hostname: 'scanme.nmap.org',
      status: 'running',
      progress: 60,
      stage: 'Template scanning',
      timeline: timeline(11),
      findings_so_far: [
        { title: 'Site is served over plaintext HTTP', severity: 'high', source: 'transport' },
        { title: 'Content-Security-Policy header not set', severity: 'medium', source: 'header' },
      ],
      severity_counts: { ...EMPTY_COUNTS, high: 1, medium: 1 },
    },
  },
  skipped: {
    body: {
      scan_id: 'vs_a11y',
      hostname: 'scanme.nmap.org',
      status: 'running',
      progress: 70,
      stage: 'Passive analysis',
      timeline: timeline(12).map((t, i) => (i === 11 ? { ...t, status: 'skipped' } : t)),
      findings_so_far: [],
      severity_counts: EMPTY_COUNTS,
    },
  },
  completed: {
    body: {
      scan_id: 'vs_a11y',
      hostname: 'scanme.nmap.org',
      status: 'completed',
      progress: 100,
      stage: 'Scoring and assembling report',
      timeline: timeline(15, 'completed'),
      findings_so_far: [],
      severity_counts: EMPTY_COUNTS,
    },
  },
  failed: {
    body: {
      scan_id: 'vs_a11y',
      hostname: 'scanme.nmap.org',
      status: 'failed',
      progress: 40,
      stage: 'Enumerating ports',
      timeline: timeline(8, 'pending'),
      findings_so_far: [],
      severity_counts: EMPTY_COUNTS,
      error: 'The host stopped answering after 8 stages.',
    },
  },
  expired: { status: 404, body: { error: 'Scan not found.' } },
}

for (const [name, state] of Object.entries(SCAN_STATES)) {
  test(`axe: scan / ${name}`, async ({ page }) => {
    await page.route('**/api/status/**', (route) =>
      route.fulfill({
        status: state.status ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(state.body),
      }),
    )
    await page.goto('/scan/vs_a11y')
    await page.waitForTimeout(1300)
    await expectNoViolations(page, `scan / ${name}`)
  })
}

/* ----------------------------------------------------------- report states */

test('axe: report / full', async ({ page }) => {
  await page.goto('/results/sample')
  // Client-rendered: measuring the skeleton measures the wrong page.
  await expect(page.getByRole('heading', { name: /scanme\.nmap\.org/i }).first()).toBeVisible()
  await expectNoViolations(page, 'report / full')
})

test('axe: report / empty and bare', async ({ page, request }) => {
  const sample = await (await request.get('/api/report/sample')).json()

  const variants: Record<string, unknown> = {
    empty: {
      ...sample,
      vulnerabilities: [],
      cves: [],
      severity_distribution: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      risk: { score: 100, category: 'Low', penalties: [] },
    },
    bare: { ...sample, cves: [], notes: [] },
  }

  for (const [name, report] of Object.entries(variants)) {
    await test.step(name, async () => {
      await page.route('**/api/report/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) }),
      )
      await page.goto('/results/vs_a11y')
      await page.waitForTimeout(1600)
      await expectNoViolations(page, `report / ${name}`)
      await page.unroute('**/api/report/**')
    })
  }
})

/* --------------------------------------------------------------- home, 404 */

test('axe: home', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(1200)
  await expectNoViolations(page, 'home')
})

test('axe: not found', async ({ page }) => {
  await page.goto('/this-route-does-not-exist')
  await page.waitForTimeout(900)
  await expectNoViolations(page, '404')
})

/* ------------------------------------------------------- keyboard journey */

test.describe('keyboard only', () => {
  test('every stop on home is reachable and visibly focused', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1200)

    const stops: { label: string; ring: boolean; tag: string }[] = []

    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        // Next's dev overlay is not part of the product.
        if (el.tagName === 'NEXTJS-PORTAL') return { skip: true, label: '', ring: true, tag: '' }
        const cs = getComputedStyle(el)
        /*
         * A ring can be drawn as an outline or as a box-shadow. Both are
         * legitimate; what matters is that something changed.
         */
        const ring =
          (cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0) ||
          cs.boxShadow !== 'none'
        return {
          skip: false,
          tag: el.tagName,
          label: (
            el.innerText ||
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            ''
          )
            .trim()
            .slice(0, 30),
          ring,
        }
      })

      if (stop === null) break
      if (!stop.skip) stops.push(stop)
    }

    // If the tab order collapses, this is the assertion that notices.
    expect(stops.length, 'too few keyboard stops on home').toBeGreaterThanOrEqual(18)

    /*
     * The scan input is the one deliberate exception: it sets `outline-none`
     * because `.scan-field:focus-within` lights the whole field instead, which
     * is a larger and clearer indicator than a ring on the input alone.
     */
    const unfocusable = stops.filter((s) => !s.ring && s.tag !== 'INPUT')
    expect(unfocusable, 'focusable elements with no visible focus indicator').toEqual([])
  })

  test('a keyboard user can start a scan without a mouse', async ({ page }) => {
    /*
     * The journey that matters. Everything else on this page is navigation;
     * this is the one task the product exists to perform, and it must be
     * completable from the keyboard alone.
     */
    let submitted: string | null = null
    await page.route('**/api/scan', async (route) => {
      submitted = route.request().postData()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ scan_id: 'vs_kbd', status: 'queued' }),
      })
    })
    // Stop the scan page from polling a scan that does not exist.
    await page.route('**/api/status/**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' }),
    )

    await page.goto('/')
    await page.waitForTimeout(1200)

    /*
     * There are TWO scan forms on this page: the one in the docked header bar
     * and the real one in the working section below the hero. They share
     * state, but only the second contains the authorisation checkbox, so
     * `.first()` silently drove the wrong form and the submit was correctly
     * refused for want of consent. Target the form that owns the checkbox.
     */
    const form = page.locator('form').filter({ has: page.locator('input[type="checkbox"]') })
    const input = form.getByPlaceholder(/yoursite\.com/i)
    const consent = form.locator('input[type="checkbox"]')

    await input.focus()
    await page.keyboard.type('example.com')

    // Required before a scan can start, and it must be operable with Space
    // like any native checkbox.
    await consent.focus()
    await page.keyboard.press('Space')
    await expect(consent).toBeChecked()

    await input.focus()
    await page.keyboard.press('Enter')

    await expect
      .poll(() => submitted, { timeout: 10_000, message: 'no scan was submitted from the keyboard' })
      .not.toBeNull()
    expect(submitted).toContain('example.com')
  })
})
