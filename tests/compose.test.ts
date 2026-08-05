import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * docker-compose guardrails.
 *
 * Regression: `docker compose up` aborted with "dependency zap failed to
 * start". ZAP itself was fine — it was still installing add-ons and had not
 * yet answered the API endpoint the healthcheck probed. Because `app` was
 * gated on `service_healthy`, one slow optional scanner stopped the entire
 * product from booting.
 *
 * These assertions are deliberately coarse: they pin the decisions, not the
 * formatting, so the file can be reorganised without breaking them.
 */
const compose = readFileSync('docker-compose.yml', 'utf8')

describe('docker-compose', () => {
  it('does not let an optional scanner block the app from starting', () => {
    // ZAP is optional: lib/scanner/zap.ts degrades to a coverage note when it
    // is unreachable, so the app must come up regardless of ZAP's health.
    expect(compose).toContain('condition: service_started')
    expect(compose).not.toContain('condition: service_healthy')
  })

  it('probes ZAP on the root path, as the official image does', () => {
    // The /JSON/core/view/version/ endpoint starts answering later than the
    // port opens, so probing it reports a healthy container as unhealthy.
    expect(compose).toMatch(/curl[^\n]*127\.0\.0\.1:8080\/\s/)
    expect(compose).not.toMatch(/curl[^\n]*JSON\/core\/view\/version/)
  })

  it('stops ZAP calling home on start-up', () => {
    // The add-on update check delayed the API becoming responsive and is a
    // hang risk on a network-restricted host.
    expect(compose).toContain('-silent')
    expect(compose).toContain('start.checkForUpdates=false')
    expect(compose).toContain('start.checkAddonUpdates=false')
  })

  it('allows a cold JVM enough time before declaring ZAP unhealthy', () => {
    const startPeriod = compose.match(/start_period:\s*(\d+)s/g) ?? []
    // The ZAP entry is the longer of the two; a cold start plus database
    // migration routinely exceeds a minute on a laptop.
    const seconds = startPeriod.map((s) => Number(s.match(/(\d+)/)?.[1] ?? 0))
    expect(Math.max(...seconds)).toBeGreaterThanOrEqual(120)
  })

  it('keeps ZAP off the host network', () => {
    // api.disablekey is only safe because the port is never published.
    expect(compose).toContain('expose')
    expect(compose).not.toMatch(/ports:[\s\S]{0,80}8080:8080/)
  })
})
