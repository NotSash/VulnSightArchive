/**
 * Mobile audit.
 *
 * Measures the things that decide whether a page feels like an app or like a
 * desktop site someone shrank. Every check is a measurement, not an opinion,
 * so the same script is both the survey at the start of Part 2.5 and the
 * regression check at the end of it.
 *
 *   node _for-myself/tools/mobile-audit.mjs [baseUrl]
 *
 * Needs the dev server running and LD_LIBRARY_PATH set:
 *
 *   export LD_LIBRARY_PATH=$HOME/.localroot/root/usr/lib/x86_64-linux-gnu
 *
 * Exits non-zero if any FAIL-level problem is found, so it can gate a build
 * later without changing anything here.
 *
 * **If a result contradicts the source, suspect the dev server first.**
 * Turbopack sometimes keeps serving an old CSS chunk after `globals.css`
 * changes, which looks exactly like a rule that does not work. Confirm against
 * the production build before believing a failure:
 *
 *   bash _for-myself/tools/gate.sh build
 *   grep -o 'your-class[^}]*}' .next/static/chunks/*.css
 */

import { chromium } from '/home/user/pwtool/node_modules/playwright-core/index.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3111'

/**
 * The four shapes that matter.
 *
 * 390x844 is the primary target (iPhone 14/15). 360x640 is the floor: the
 * smallest Android still in meaningful use, and the width where anything
 * fragile breaks first. 430x932 is a large phone, which catches layouts that
 * only work because they were cramped. 768x1024 is the tablet middle ground,
 * where `md:` breakpoints start applying and desktop assumptions creep back in.
 */
const VIEWPORTS = [
  { name: '360x640', width: 360, height: 640, label: 'small Android (floor)' },
  { name: '390x844', width: 390, height: 844, label: 'iPhone 14/15 (primary)' },
  { name: '430x932', width: 430, height: 932, label: 'large phone' },
  { name: '768x1024', width: 768, height: 1024, label: 'tablet' },
]

const PAGES = [
  { path: '/', name: 'home' },
  { path: '/results/sample', name: 'results' },
  { path: '/scan/vs_audit', name: 'scan', stubStatus: true },
]

/** Apple and Google both put the minimum comfortable touch target here. */
const MIN_TAP = 44
/**
 * Below this, body text stops being comfortably readable on a phone.
 *
 * The mobile type floor in `globals.css` lifts the smallest authored step to
 * exactly 12px on coarse pointers, so this threshold and that floor are the
 * same decision stated twice. Change both together.
 */
const MIN_FONT = 12
/**
 * iOS Safari zooms the whole page in when a font-size below 16px receives
 * focus, and it does not zoom back out. It is the single most common cause of
 * a mobile web form feeling broken.
 */
const MIN_INPUT_FONT = 16

/** A running scan, stubbed, so the scan page renders its real layout. */
const STAGES = [
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

function stubBody() {
  const done = 10
  return JSON.stringify({
    scan_id: 'vs_audit',
    hostname: 'scanme.nmap.org',
    status: 'running',
    progress: Math.round((done / STAGES.length) * 100),
    stage: STAGES[done],
    timeline: STAGES.map((event, i) => ({
      time: `14:${String(i).padStart(2, '0')}:00`,
      event,
      status: i < done ? 'completed' : i === done ? 'running' : 'pending',
    })),
    findings_so_far: [
      {
        id: 'f1',
        title: 'Content-Security-Policy header not set',
        severity: 'medium',
        source: 'header',
      },
      { id: 'f2', title: 'Site is served over plaintext HTTP', severity: 'high', source: 'transport' },
    ],
    severity_counts: { critical: 0, high: 1, medium: 1, low: 0, info: 0 },
  })
}

/**
 * Everything measured inside the page.
 *
 * Runs as one evaluate call rather than several, because each round trip costs
 * a frame and the numbers should all describe the same layout.
 */
function collect({ MIN_TAP, MIN_FONT, MIN_INPUT_FONT }) {
  const problems = []
  const seen = new Set()

  const describe = (el) => {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const cls =
      typeof el.className === 'string' && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : ''
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 34)
    return `${tag}${id}${cls}${text ? ` "${text}"` : ''}`
  }

  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  /* ---------------------------------------------------- horizontal overflow */
  const doc = document.documentElement
  const overflow = doc.scrollWidth - doc.clientWidth
  if (overflow > 1) {
    // Name the widest offenders, otherwise "the page is 40px too wide" is a
    // fact with nowhere to go.
    const culprits = []
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.right > doc.clientWidth + 1 || r.left < -1) {
        const s = getComputedStyle(el)
        // Skip elements that are only wide because a parent is: report the
        // outermost one in each chain.
        if (el.parentElement && el.parentElement !== document.body) {
          const pr = el.parentElement.getBoundingClientRect()
          if (pr.right > doc.clientWidth + 1 || pr.left < -1) continue
        }
        culprits.push({
          el: describe(el),
          left: Math.round(r.left),
          right: Math.round(r.right),
          position: s.position,
        })
      }
      if (culprits.length >= 6) break
    }
    problems.push({
      level: 'FAIL',
      kind: 'overflow',
      detail: `page scrolls sideways by ${overflow}px`,
      culprits,
    })
  }

  /* --------------------------------------------------------- touch targets */
  const TAPPABLE = 'a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'
  for (const el of document.querySelectorAll(TAPPABLE)) {
    if (!visible(el)) continue
    if (el.closest('[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect()
    // Off-screen controls (a parked header, a docked bar) are not reachable,
    // so their size is not a defect yet.
    if (r.bottom < 0 || r.top > innerHeight * 4) continue
    if (r.width >= MIN_TAP && r.height >= MIN_TAP) continue
    /*
     * An element can carry a larger hit area than its own box via an overlaid
     * `::after`, which is the only honest option when the drawn width is data
     * (the pipeline bar's segments are proportional to real stage durations).
     * Measure the pseudo-element before calling it a defect.
     */
    const after = getComputedStyle(el, '::after')
    if (after.content !== 'none') {
      const w = Math.max(r.width, Number.parseFloat(after.minWidth) || 0)
      const h = Math.max(r.height, Number.parseFloat(after.minHeight) || 0)
      if (w >= MIN_TAP && h >= MIN_TAP) continue
    }
    const key = describe(el)
    if (seen.has(key)) continue
    seen.add(key)
    problems.push({
      level: 'FAIL',
      kind: 'tap-target',
      detail: `${Math.round(r.width)}x${Math.round(r.height)} (min ${MIN_TAP})`,
      culprits: [{ el: key }],
    })
  }

  /* ----------------------------------------------------------- input zoom */
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!visible(el)) continue
    const size = Number.parseFloat(getComputedStyle(el).fontSize)
    if (size >= MIN_INPUT_FONT) continue
    problems.push({
      level: 'FAIL',
      kind: 'ios-zoom',
      detail: `font-size ${size}px, iOS Safari will zoom the page on focus (min ${MIN_INPUT_FONT})`,
      culprits: [{ el: describe(el) }],
    })
  }

  /* ------------------------------------------------------------- tiny text */
  const tiny = new Map()
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    // Only elements that own their text, so a wrapper is not blamed for its
    // children.
    const owns = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!owns) continue
    const size = Number.parseFloat(getComputedStyle(el).fontSize)
    if (size >= MIN_FONT) continue
    const key = `${size}px ${describe(el)}`
    if (!tiny.has(key)) tiny.set(key, { size, el: describe(el) })
  }
  for (const t of [...tiny.values()].slice(0, 10)) {
    problems.push({
      level: 'WARN',
      kind: 'tiny-text',
      detail: `${t.size}px (min ${MIN_FONT})`,
      culprits: [{ el: t.el }],
    })
  }

  /* --------------------------------------------------------- viewport units */
  // `100vh` does not account for the mobile address bar, so the bottom of the
  // element sits below the fold and cannot be scrolled to.
  const vh = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const s = getComputedStyle(el)
    for (const prop of ['height', 'minHeight']) {
      const raw = el.style[prop]
      if (raw?.includes('vh') && !raw.includes('dvh')) vh.push(`${describe(el)} (${prop}: ${raw})`)
    }
    void s
  }
  for (const v of vh.slice(0, 5)) {
    problems.push({ level: 'WARN', kind: 'vh-unit', detail: '100vh, use dvh', culprits: [{ el: v }] })
  }

  return {
    problems,
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    docHeight: doc.scrollHeight,
  }
}

const browser = await chromium.launch()
let failures = 0
let warnings = 0
const summary = []

for (const page of PAGES) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      /*
       * Every viewport in this list is a touch device, including the tablet.
       *
       * `hasTouch` was keyed off `width < 768`, which excluded the 768px
       * tablet and made Chromium report it as a mouse: `pointer: coarse` was
       * false, so the touch-only rules (the type floor, the `.touch-target`
       * hit areas) correctly did not apply and the audit then flagged their
       * absence as a defect. The audit was describing a device that does not
       * exist rather than the iPad it is named after.
       *
       * `isMobile` stays width-based: it also sets a mobile user agent and
       * meta-viewport behaviour, which a tablet in landscape does not want.
       */
      isMobile: vp.width < 768,
      hasTouch: true,
    })
    const p = await ctx.newPage()
    const consoleErrors = []
    p.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 90))
    })

    if (page.stubStatus) {
      await p.route(
        (u) => u.pathname.startsWith('/api/status/'),
        (r) => r.fulfill({ contentType: 'application/json', body: stubBody() }),
      )
    }

    let result
    try {
      await p.goto(BASE + page.path, { waitUntil: 'networkidle', timeout: 30000 })
      await p.waitForTimeout(900)
      result = await p.evaluate(collect, { MIN_TAP, MIN_FONT, MIN_INPUT_FONT })
    } catch (err) {
      result = {
        problems: [{ level: 'FAIL', kind: 'load', detail: err.message.slice(0, 120), culprits: [] }],
        scrollWidth: 0,
        clientWidth: 0,
      }
    }

    const fails = result.problems.filter((x) => x.level === 'FAIL')
    const warns = result.problems.filter((x) => x.level === 'WARN')
    failures += fails.length
    warnings += warns.length

    const head = `${page.name.padEnd(8)} ${vp.name.padEnd(9)} ${vp.label}`
    if (fails.length === 0 && warns.length === 0 && consoleErrors.length === 0) {
      console.log(`  PASS  ${head}`)
    } else {
      console.log(`\n  ---- ${head}`)
      // Group by kind so ten undersized buttons read as one problem.
      const byKind = new Map()
      for (const prob of result.problems) {
        if (!byKind.has(prob.kind)) byKind.set(prob.kind, [])
        byKind.get(prob.kind).push(prob)
      }
      for (const [kind, list] of byKind) {
        console.log(`   ${list[0].level}  ${kind}  (${list.length})`)
        for (const prob of list.slice(0, 6)) {
          console.log(`         ${prob.detail}`)
          for (const c of prob.culprits.slice(0, 4)) {
            const extra = c.left !== undefined ? `  [${c.left}..${c.right} ${c.position}]` : ''
            console.log(`           ${c.el}${extra}`)
          }
        }
        if (list.length > 6) console.log(`         ... and ${list.length - 6} more`)
      }
      for (const e of consoleErrors.slice(0, 3)) console.log(`   WARN  console: ${e}`)
    }

    summary.push({
      page: page.name,
      vp: vp.name,
      fails: fails.length,
      warns: warns.length,
      overflow: result.scrollWidth - result.clientWidth,
    })
    await ctx.close()
  }
}

await browser.close()

console.log(`\n${'='.repeat(66)}`)
console.log('page     viewport   overflow  FAIL  WARN')
for (const s of summary) {
  console.log(
    `${s.page.padEnd(8)} ${s.vp.padEnd(10)} ${String(s.overflow).padStart(8)}  ${String(s.fails).padStart(4)}  ${String(s.warns).padStart(4)}`,
  )
}
console.log(`${'='.repeat(66)}`)
console.log(`${failures} failures, ${warnings} warnings`)
process.exit(failures > 0 ? 1 : 0)
