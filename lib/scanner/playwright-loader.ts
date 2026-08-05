/**
 * Runtime loader for Playwright.
 *
 * Playwright cannot be imported normally here. It is listed in
 * `serverExternalPackages`, so the bundler does not inline it and instead emits
 * a reference into its own external-module map. That map is built from module
 * tracing at build time, and tracing does not follow the symlinks pnpm uses for
 * its dependency tree — so in a pnpm-built standalone output the entry is
 * broken and loading fails with:
 *
 *   Failed to load external module playwright-<hash>
 *
 * Copying the real package into `node_modules` afterwards does not help,
 * because the failure is in the bundler's map rather than on disk.
 *
 * `createRequire` sidesteps the whole mechanism: it performs a plain Node
 * resolution from the application root at runtime, exactly as `node -e
 * "require('playwright')"` does, which works regardless of how the bundle was
 * produced or which package manager laid out `node_modules`.
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

type PlaywrightModule = typeof import('playwright')

export type PlaywrightLoadResult =
  | { ok: true; playwright: PlaywrightModule }
  | { ok: false; reason: string }

/** Resolved module, cached after the first successful load. */
let cached: PlaywrightModule | null = null

/**
 * Candidate roots to resolve from, in order of preference.
 *
 * `process.cwd()` is the standalone server's own directory in the container
 * (`/app`), which is where the runtime image installs Playwright.
 */
function resolutionRoots(): string[] {
  const roots = [process.cwd(), '/app']
  return [...new Set(roots)].map((root) => join(root, 'noop.js'))
}

/**
 * Load Playwright, or explain why it is unavailable.
 *
 * Never throws: a missing browser automation library degrades the scan into a
 * coverage note rather than failing the whole report.
 */
export function loadPlaywright(): PlaywrightLoadResult {
  if (cached) return { ok: true, playwright: cached }

  const attempts: string[] = []

  for (const from of resolutionRoots()) {
    try {
      const nodeRequire = createRequire(from)
      const playwright = nodeRequire('playwright') as PlaywrightModule
      // Guard against a partially-installed package resolving to something
      // without the API surface the scanner actually uses.
      if (typeof playwright?.chromium?.launch !== 'function') {
        attempts.push(`${from}: resolved, but chromium.launch is missing`)
        continue
      }
      cached = playwright
      return { ok: true, playwright }
    } catch (error) {
      attempts.push(`${from}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    ok: false,
    reason: `The playwright package could not be resolved at runtime. Attempts: ${attempts.join(' | ')}`,
  }
}

/**
 * Path to the Chromium binary, when one is configured.
 *
 * The container installs Chromium from the distribution's package repository
 * rather than letting Playwright download its own, because Playwright does not
 * publish arm64 browser builds and the deployment target is arm64. When unset,
 * Playwright falls back to its managed download.
 */
export function chromiumExecutablePath(): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim()
  return configured || undefined
}

/**
 * Launch flags shared by the scanner and the health check.
 *
 * Chromium's setuid sandbox cannot initialise inside an unprivileged
 * container, and the default 64MB of shared memory is too small for real
 * pages. The container is itself the isolation boundary, and the browser only
 * ever loads the scan target.
 */
export const CHROMIUM_LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage']
