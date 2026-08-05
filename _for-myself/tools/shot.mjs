/**
 * Screenshot the running site from a real browser.
 *
 * This exists because "I cannot see the page" was the single biggest gap in
 * this project: every visual decision was reasoned rather than observed, and
 * several bugs shipped that no type checker or unit test could catch (a veil
 * greying out the whole hero, a low-power gate freezing the animation, a
 * drop-shadow turning a pixel font muddy).
 *
 * Chromium would not start here because seven system libraries were missing
 * and there is no root access. The fix is to unpack the Debian packages into
 * a local prefix and point the loader at it, no install required:
 *
 *   see _for-myself/tools/setup-browser.sh
 *
 * Usage, with the dev server already running:
 *
 *   LD_LIBRARY_PATH=$HOME/.localroot/root/usr/lib/x86_64-linux-gnu \
 *     node _for-myself/tools/shot.mjs [url] [outfile] [--full] [--wait=ms]
 *       [--w=1440] [--h=810] [--scroll=px] [--reduced] [--probe]
 */
/*
 * Resolved from a directory outside the project on purpose.
 *
 * The app uses pnpm's symlinked node_modules; running `npm install` inside it
 * corrupts that layout, and pnpm wipes the package on the next install anyway.
 * Keeping the tool's own dependency in ~/pwtool means neither can break the
 * other. See setup-browser.sh, which creates it.
 */
const pw = await import(`${process.env.HOME}/pwtool/node_modules/playwright-core/index.js`)
const chromium = pw.chromium ?? pw.default?.chromium

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : dflt
}
const has = (name) => args.includes(`--${name}`)
const positional = args.filter((a) => !a.startsWith('--'))

const url = positional[0] ?? 'http://localhost:3111/'
const out = positional[1] ?? '/home/user/shot.png'
const width = Number(flag('w', 1440))
const height = Number(flag('h', 810))
const wait = Number(flag('wait', 4000))
const scroll = Number(flag('scroll', 0))

const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell`

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})

const page = await browser.newPage({
  viewport: { width, height },
  // Emulating reduced motion is the only way to check the still frame that
  // those users actually get, which is otherwise completely invisible.
  reducedMotion: has('reduced') ? 'reduce' : 'no-preference',
})

const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`CONSOLE: ${m.text()}`)
})
page.on('pageerror', (e) => problems.push(`PAGEERROR: ${e.message}`))
page.on('requestfailed', (r) => problems.push(`REQFAIL: ${r.url().slice(0, 80)}`))

await page.goto(url, { waitUntil: 'networkidle' })
if (scroll) await page.evaluate((y) => window.scrollTo(0, y), scroll)
await page.waitForTimeout(wait)

if (has('probe')) {
  const probe = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')].map((c) => {
      const s = getComputedStyle(c)
      const b = c.getBoundingClientRect()
      return {
        state: c.dataset.scene ?? c.dataset.field ?? null,
        position: s.position,
        top: Math.round(b.top),
        height: Math.round(b.height),
      }
    })
    // Anything translucent stretched across the viewport is the usual suspect
    // when the page looks unexpectedly washed out.
    const veils = [...document.querySelectorAll('[data-decorative]')]
      .map((e) => {
        const s = getComputedStyle(e)
        const b = e.getBoundingClientRect()
        return { position: s.position, top: Math.round(b.top), h: Math.round(b.height) }
      })
      .filter((v) => v.h > 400)
    return { canvases, veils, scrollY: window.scrollY }
  })
  console.log(JSON.stringify(probe, null, 1))
}

await page.screenshot({ path: out, fullPage: has('full') })
await browser.close()

console.log(`wrote ${out}`)
if (problems.length) console.log('problems:', problems.slice(0, 8))
else console.log('no console errors, no failed requests')
