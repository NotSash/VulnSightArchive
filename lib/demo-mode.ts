/**
 * Demo mode: the deployment can show the product but cannot run it.
 *
 * VulnSight's scanning half needs nmap, nuclei, ZAP and a real Chromium, plus
 * minutes of CPU per job. A serverless host has none of that. Without a switch
 * the endpoint still *works* there, in the worst possible way: it returns the
 * handful of checks that need only `fetch`, marks nothing as confirmed, and
 * produces a thin report that looks like the finished product.
 *
 * That is the failure this module exists to prevent. Someone shown a demo link
 * would try the box, get four header findings, and conclude that is what
 * VulnSight does. A tool whose entire promise is "we only call it a problem
 * when more than one scanner agrees" must not quietly ship a build where only
 * one scanner exists.
 *
 * So demo mode refuses the scan outright and points at the seeded sample
 * report, which is a genuine result from a real run. Showing real output from
 * a real scan is honest. Showing degraded output as though it were normal is
 * not.
 *
 * Enable with `NEXT_PUBLIC_DEMO_MODE=1`. It is `NEXT_PUBLIC_` because the
 * browser needs it too: the form must be visibly replaced before anyone clicks
 * it, not merely rejected afterwards.
 */

/**
 * Parses the flag. Exported separately so tests can exercise the parsing
 * without touching the real environment.
 */
export function parseDemoFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * True when this deployment can display the product but not perform scans.
 *
 * `process.env.NEXT_PUBLIC_DEMO_MODE` is written out in full, deliberately.
 * Next.js inlines these variables into the client bundle by *textual
 * substitution*, so it only replaces a literal static member expression.
 * Reading it through an indirection, as in `env.NEXT_PUBLIC_DEMO_MODE` where
 * `env` is a parameter, defeats that: the server saw the value and the browser
 * saw `undefined`, so the server rendered the scan form and the client
 * rendered the sample link, and React threw a hydration mismatch. That is a
 * bug no type checker or unit test can catch, and it only appears in a real
 * browser.
 */
export function isDemoMode(): boolean {
  return parseDemoFlag(process.env.NEXT_PUBLIC_DEMO_MODE)
}

/**
 * Why the scan endpoint refused, in the user's words.
 *
 * Names the missing capability rather than hiding behind "unavailable", and
 * sends the reader somewhere useful in the same breath.
 */
export const DEMO_SCAN_MESSAGE =
  'This is a preview deployment, so live scanning is switched off. The scanners VulnSight drives (nmap, nuclei, ZAP and a real browser) need a server that can run them for several minutes. Open the sample report to see exactly what a finished scan produces.'

/** Machine-readable counterpart, for clients that branch on the reason. */
export const DEMO_SCAN_CODE = 'demo_mode' as const

/** Shown on the form itself, before anyone presses anything. */
export const DEMO_BANNER_TITLE = 'Preview deployment'
export const DEMO_BANNER_BODY =
  'Live scanning is off here. Everything else is real: the sample report below comes from an actual scan of scanme.nmap.org.'
