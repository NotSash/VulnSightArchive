/**
 * Re-run every state established in Part 3, in one pass.
 *
 * Part 3 checked six scan states, four report states, reduced motion and
 * scripts-off, each by hand over four sessions. Part 4 then changed motion
 * tokens, section rhythm, pressed states and colour tokens underneath all of
 * them. This re-runs the lot so a regression cannot hide in a state that is
 * hard to reach by clicking.
 *
 * Each state is measured for four things:
 *
 *   - horizontal overflow (the mobile audit's rule, applied at desktop too)
 *   - console errors and failed requests
 *   - WCAG contrast on every piece of text, at its real size and weight
 *   - the specific sentence Part 3 fixed, so the copy cannot silently revert
 *
 * Usage, with the dev server already running:
 *
 *   LD_LIBRARY_PATH=$HOME/.localroot/root/usr/lib/x86_64-linux-gnu \
 *     node _for-myself/tools/state-audit.mjs
 */
const pw = await import(`${process.env.HOME}/pwtool/node_modules/playwright-core/index.js`)
const chromium = pw.chromium ?? pw.default?.chromium
const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell`
const BASE = 'http://localhost:3111'

const STAGES = [
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

/** A timeline of 15 stages with `n` settled, the next one running. */
function timeline(n, tailStatus = 'running') {
  return STAGES.map((event, i) => ({
    time: `09:5${i % 10}:0${i % 10}`,
    event,
    status: i < n ? 'completed' : i === n ? tailStatus : 'pending',
  }))
}

const EMPTY_COUNTS = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 }

const SCAN_STATES = {
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

/* ---- contrast, the measurement from session 4E, now colour-space safe ----
 *
 * The first version of this parsed `rgb(...)` with a number regex. Tailwind
 * emits `oklab(0.72 -0.018 -0.028 / 0.7)` for any colour carrying an opacity
 * modifier, and the regex happily read `0.72, 0.018, 0.028` as an RGB triple,
 * which is near-black. That produced 47 fake failures reading exactly 1.07:1.
 *
 * Painting the string onto a canvas makes the browser do the conversion, and
 * painting the resolved background first means alpha is composited rather than
 * ignored. What comes back is the sRGB the eye actually receives.
 */
const CONTRAST = () => {
  const cv = document.createElement('canvas')
  cv.width = 1
  cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })

  /** Paint `over` on top of `under` and read back the composited sRGB. */
  const flatten = (under, over) => {
    ctx.clearRect(0, 0, 1, 1)
    for (const c of [...under, over]) {
      ctx.fillStyle = c
      ctx.fillRect(0, 0, 1, 1)
    }
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }

  const channel = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const lum = (c) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])

  /** Every background painted between the page ground and this element. */
  const stack = (el) => {
    const layers = []
    let o = el
    while (o) {
      const bg = getComputedStyle(o).backgroundColor
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') layers.unshift(bg)
      o = o.parentElement
    }
    return ['#070C12', ...layers]
  }

  const out = []
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('nextjs-portal')) continue
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
    if (!hasText) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.9) continue
    if (!el.getBoundingClientRect().height) continue

    const layers = stack(el)
    const bg = flatten(layers, layers[layers.length - 1])
    const fg = flatten(layers, cs.color)
    const [l1, l2] = [lum(fg), lum(bg)]
    const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const size = Number.parseFloat(cs.fontSize)
    const need = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5
    if (cr < need - 0.01) {
      out.push({ cr: +cr.toFixed(2), need, size, txt: el.textContent.trim().slice(0, 34) })
    }
  }
  return out
}

const OVERFLOW = () => {
  const w = document.documentElement.clientWidth
  const bad = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('nextjs-portal')) continue
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.right > w + 1 || r.left < -1)) {
      bad.push(`${el.tagName}.${String(el.className).slice(0, 30)} right=${Math.round(r.right)}`)
    }
  }
  return bad.slice(0, 4)
}

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})

const rows = []
let failures = 0

async function check(label, run, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: opts.width ?? 1440, height: 900 },
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
    javaScriptEnabled: opts.noJs ? false : true,
  })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // The expired state IS a 404; the browser logs every one of them.
    if (opts.expect404 && m.text().includes('404')) return
    errors.push(m.text().slice(0, 80))
  })
  page.on('requestfailed', (r) => {
    // The dev server's own hot-reload socket 404s with scripts disabled.
    // That is Next's plumbing, not the page under test.
    if (r.url().includes('hmr-client')) return
    errors.push(`request failed ${r.url().slice(-40)}`)
  })

  const problems = await run(page)

  const overflow = await page.evaluate(OVERFLOW)
  const contrast = opts.noJs ? [] : await page.evaluate(CONTRAST)
  const bad = [
    ...problems,
    ...overflow.map((o) => `overflow: ${o}`),
    ...contrast.map((c) => `contrast ${c.cr} < ${c.need} at ${c.size}px: "${c.txt}"`),
    ...errors.map((e) => `console: ${e}`),
  ]
  rows.push({ label, overflow: overflow.length, contrast: contrast.length, bad })
  if (bad.length) failures += bad.length
  await context.close()
}

/** Assert the copy Part 3 fixed is present, and what it replaced is gone. */
async function copyCheck(page, state) {
  const text = await page.evaluate(() => document.body.innerText)
  const bad = []
  for (const s of state.expect ?? []) if (!text.includes(s)) bad.push(`missing copy: "${s}"`)
  for (const s of state.forbid ?? []) if (text.includes(s)) bad.push(`stale copy present: "${s}"`)
  return bad
}

for (const [name, state] of Object.entries(SCAN_STATES)) {
  await check(`scan / ${name}`, async (page) => {
    await page.route('**/api/status/**', (route) =>
      route.fulfill({
        status: state.httpStatus ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(state.body ?? { scan_id: 'vs_state', hostname: 'scanme.nmap.org', ...state }),
      }),
    )
    // The completed state redirects to the report after a beat; stub the
    // destination so the measurement lands on the frame under test.
    await page.route('**/api/report/**', (route) => route.fulfill({ status: 404, body: '{}' }))
    await page.goto(`${BASE}/scan/vs_state`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1400)
    return copyCheck(page, state)
  }, { expect404: state.httpStatus === 404 })
}

/* ---- report states ---- */
const sample = await (await fetch(`${BASE}/api/report/sample`)).json()

const REPORTS = {
  full: { report: sample, expect: ['Start with these'] },
  empty: {
    report: {
      ...sample,
      vulnerabilities: [],
      cves: [],
      severity_distribution: { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 },
      risk: { score: 100, category: 'Low', penalties: [] },
    },
    expect: ['No findings', 'Every tool ran'],
    forbid: ['passive assessment', 'security best practices'],
  },
  bare: {
    report: { ...sample, cves: [], notes: [] },
    expect: ['Vulnerabilities'],
  },
}

for (const [name, state] of Object.entries(REPORTS)) {
  await check(`report / ${name}`, async (page) => {
    await page.route('**/api/report/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.report),
      }),
    )
    await page.goto(`${BASE}/results/vs_state`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1600)
    return copyCheck(page, state)
  })
}

/* ---- reduced motion: nothing may loop forever ---- */
for (const path of ['/', '/results/sample', '/scan/vs_state']) {
  await check(
    `reduced motion ${path}`,
    async (page) => {
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
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1600)
      return page.evaluate(() => {
        const bad = []
        for (const el of document.querySelectorAll('body *')) {
          if (el.closest('nextjs-portal')) continue
          const cs = getComputedStyle(el)
          if (cs.animationIterationCount.split(',').some((v) => v.trim() === 'infinite')) {
            bad.push(`infinite animation: ${cs.animationName} on ${el.tagName}`)
          }
          if (Number(cs.opacity) < 0.99 && el.className && String(el.className).includes('rise')) {
            bad.push(`entrance stuck faded: ${String(el.className).slice(0, 40)}`)
          }
        }
        return bad.slice(0, 4)
      })
    },
    { reduced: true },
  )
}

/* ---- scripts off: every page must still say something ---- */
for (const [path, min] of [
  ['/', 3000],
  ['/results/sample', 250],
  ['/scan/vs_state', 40],
]) {
  await check(
    `no script ${path}`,
    async (page) => {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
      const text = await page.evaluate(() => document.body.innerText.trim())
      const bad = []
      if (text.length < min) bad.push(`only ${text.length} characters, expected at least ${min}`)
      if (path === '/scan/vs_state' && text.includes('Step 1 of 1')) {
        bad.push('fabricated "Step 1 of 1" is back')
      }
      const busy = await page.evaluate(
        () => document.querySelectorAll('[aria-busy="true"]:not(.js-only)').length,
      )
      if (busy) bad.push(`${busy} element(s) left aria-busy with no script to finish loading`)
      return bad
    },
    { noJs: true },
  )
}

await browser.close()

const pad = (s, n) => String(s).padEnd(n)
console.log('='.repeat(78))
console.log(`${pad('state', 30)}${pad('overflow', 10)}${pad('contrast', 10)}issues`)
for (const r of rows) {
  console.log(`${pad(r.label, 30)}${pad(r.overflow, 10)}${pad(r.contrast, 10)}${r.bad.length}`)
  for (const b of r.bad) console.log(`    ${b}`)
}
console.log('='.repeat(78))
console.log(`${failures} problems across ${rows.length} states`)
process.exit(failures ? 1 : 0)
