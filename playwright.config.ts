import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests.
 *
 * **Why these exist.** Before this, 27 of 48 test files asserted on *source
 * text*: `expect(css).toContain('--dim-2: #75919f')` proves a string is in a
 * file, not that a visitor can read the page. Every visual and behavioural
 * guarantee from the redesign held only because nobody had touched the wrong
 * line yet. These specs check the rendered result instead.
 *
 * **Offline by construction.** Outbound scanning is blocked in CI and in the
 * dev sandbox, and a test that needs the internet is a test that fails for
 * reasons unrelated to the code. Every spec stubs the scanner API with
 * `page.route()`, the pattern `_for-myself/tools/state-audit.mjs` already
 * proved, or uses the seeded sample report.
 */

/** Where the browser binary lives when the sandbox provisioned it by hand. */
const localChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim()

export default defineConfig({
  testDir: './e2e',
  /*
   * Generous, because the first request compiles the route. Turbopack cold
   * start is the slowest thing in this repo and a tight timeout here produces
   * flakes that look like product bugs.
   */
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // A stray `test.only` should fail the build rather than silently skip the
  // rest of the suite.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,

  /*
   * One worker. The suite drives a single dev server whose in-memory scan
   * store is global state, so parallel specs would see each other's scans.
   */
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    /*
     * `localhost`, not `127.0.0.1`.
     *
     * Next 16 dev mode restricts cross-origin requests and treats the two as
     * different origins. Against `127.0.0.1` the page rendered but its own
     * `fetch('/api/report/...')` was blocked, so the report sat on its
     * skeleton forever and the tests failed for a reason that had nothing to
     * do with the product. The dev server names the fix in its own log.
     * Using `localhost` avoids adding an `allowedDevOrigins` entry to
     * production config purely to satisfy a test.
     */
    baseURL: 'http://localhost:3111',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(localChromium ? { launchOptions: { executablePath: localChromium } } : {}),
  },

  /*
   * Desktop only by default.
   *
   * Playwright's device presets (`devices['iPhone 14']`) need the full
   * Chromium build, which cannot start in this sandbox: it wants a display
   * server, and only `chromium_headless_shell` is usable here. The headless
   * shell renders pages correctly but rejects the mobile emulation context.
   *
   * A phone-shaped viewport is NOT the same test and pretending otherwise
   * would be a green tick that proves nothing, so mobile is a separate opt-in
   * project rather than a silently degraded one. Run it where a full browser
   * exists (CI, or a normal dev machine):
   *
   *   PLAYWRIGHT_MOBILE=1 npx playwright test --project=mobile
   *
   * Until then `_for-myself/tools/mobile-audit.mjs` remains the real mobile
   * check: it measures overflow and touch targets at four widths using the
   * headless shell, which is exactly what it is good at.
   */
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    ...(process.env.PLAYWRIGHT_MOBILE === '1'
      ? [{ name: 'mobile', use: { ...devices['iPhone 14'] } }]
      : []),
  ],

  /*
   * `next dev`, not `next start`.
   *
   * `output: 'standalone'` means the production server needs a build step and
   * a different entry point, and it does not run in this sandbox at all. Dev
   * mode is what both CI and local development actually exercise.
   *
   * `reuseExistingServer` locally so a server already running on 3111 is not
   * killed mid-session; never in CI, where a stale server would silently test
   * the wrong build.
   */
  webServer: {
    command: 'npx next dev -p 3111',
    url: 'http://localhost:3111',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
