import { expect, test } from '@playwright/test'

/**
 * The three pages a visitor can reach, rendered in a real browser.
 *
 * Deliberately thin. This spec exists to prove the harness works end to end
 * (server boots, browser launches, routes render, console is clean) so that
 * the heavier audits ported in 1B have something trustworthy to stand on.
 *
 * Every assertion here is one a source-text test cannot make: that the page
 * actually painted, that the copy reached the DOM, that nothing errored at
 * runtime.
 */

/** Fail a test on any console error or failed request, not just a bad assert. */
function watchForErrors(page: import('@playwright/test').Page): string[] {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    /*
     * Next's dev hot-reload socket cannot attach on a 404 route, so it logs a
     * failed WebSocket handshake and a 404 for its own endpoint. That is the
     * dev server's plumbing, not the page under test, and it does not exist
     * in a production build.
     */
    if (text.includes('webpack-hmr') || text.includes('WebSocket')) return
    if (text.includes('Failed to load resource') && text.includes('404')) return
    problems.push(`console: ${text.slice(0, 160)}`)
  })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 160)}`))
  page.on('requestfailed', (request) => {
    // Next's dev-only hot-reload socket 404s in some sandboxes. Not the app.
    if (request.url().includes('hmr-client')) return
    problems.push(`request failed: ${request.url().slice(-70)}`)
  })
  return problems
}

test.describe('home', () => {
  test('renders the promise and the scan form', async ({ page }) => {
    const problems = watchForErrors(page)
    await page.goto('/')

    /*
     * `.first()` because the page legitimately has two h1s: the hero wordmark
     * and the heading of the working page below it. That is a deliberate
     * two-screen layout, not a markup bug, so the test matches the design
     * rather than asking the design to match the test.
     */
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('VulnSight')
    await expect(page.locator('body')).toContainText('more than one')

    // The form is the only action on the page; if it is missing, nothing works.
    await expect(page.getByPlaceholder(/yoursite\.com/i).first()).toBeVisible()

    expect(problems).toEqual([])
  })

  test('the hero canvas is present and inert', async ({ page }) => {
    await page.goto('/')
    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeAttached()

    /*
     * Decorative artwork must not be focusable. `tabIndex={-1}` was not
     * enough: it only removes an element from the tab order, so a click could
     * still focus it and Chrome then reported "aria-hidden on an element whose
     * descendant retained focus". `inert` is what actually closes it.
     */
    await expect(canvas).toHaveAttribute('inert', '')
  })
})

test.describe('report', () => {
  test('the sample report renders its findings', async ({ page }) => {
    const problems = watchForErrors(page)
    await page.goto('/results/sample')

    /*
     * The report is assembled in the browser from `/api/report/:id`, so the
     * first paint is a skeleton reading "Loading security report". Waiting for
     * the heading is waiting for the real thing; asserting immediately just
     * races the fetch.
     */
    await expect(page.getByRole('heading', { name: /scanme\.nmap\.org/i }).first()).toBeVisible()
    await expect(page.locator('body')).toContainText('scanme.nmap.org')
    // The score is derived, not decorative: if it is missing the page is broken.
    await expect(page.locator('body')).toContainText('Risk score')

    expect(problems).toEqual([])
  })

  test('never claims agreement it does not have', async ({ page }) => {
    /*
     * The hard product rule, checked against rendered output rather than
     * source. A finding seen once must never read as confirmed.
     */
    await page.goto('/results/sample')
    await expect(page.getByRole('heading', { name: /scanme\.nmap\.org/i }).first()).toBeVisible()
    const body = await page.locator('body').innerText()

    const seenOnce = (body.match(/seen once/gi) ?? []).length
    expect(seenOnce).toBeGreaterThan(0)
    expect(body).not.toMatch(/seen once[^\n]*confirmed/i)
  })
})

test.describe('not found', () => {
  test('returns a real 404 with a way back', async ({ page }) => {
    const problems = watchForErrors(page)
    const response = await page.goto('/this-route-does-not-exist')

    // A soft 404 is a real bug: crawlers and monitoring both believe the status.
    expect(response?.status()).toBe(404)
    await expect(page.locator('body')).toContainText('Nothing at this address')

    // A dead end with no exit is the thing this page exists to prevent.
    await expect(page.getByRole('link', { name: /scan a site/i })).toBeVisible()

    expect(problems).toEqual([])
  })
})
