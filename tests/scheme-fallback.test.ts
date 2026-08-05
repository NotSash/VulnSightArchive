import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isConnectionRefusal } from '@/lib/scanner/run'

/**
 * HTTPS-to-HTTP fallback.
 *
 * When a user types a bare hostname we assume `https://`. For a host that only
 * serves plaintext — which is common, and is exactly the kind of target that
 * most needs a security report — that assumption used to abort the whole scan
 * with "the site refused the connection". This was found by scanning
 * scanme.nmap.org, which listens on port 80 and nothing on 443.
 *
 * The fallback that fixes it is dangerous if it is too broad. Retrying over
 * HTTP after a *TLS* error would hide a real finding: an expired certificate
 * or a hostname mismatch is something we must report, not route around. So the
 * predicate below has to distinguish "nothing is listening on 443" from "443
 * is listening and speaking TLS badly".
 */
describe('isConnectionRefusal', () => {
  it('recognises a closed or unreachable port, which is safe to retry', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']) {
      expect(isConnectionRefusal(code)).toBe(true)
    }
  })

  it('refuses to downgrade after a TLS failure', () => {
    /*
     * The security-critical half. Each of these means port 443 IS open — the
     * peer completed a TCP connection and something about its TLS was wrong.
     * Silently retrying over HTTP would turn a reportable finding into a
     * clean scan, which is the worst possible outcome for a security tool.
     */
    for (const code of [
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'EPROTO',
    ]) {
      expect(isConnectionRefusal(code)).toBe(false)
    }
  })

  it('does not downgrade on a timeout or a DNS failure', () => {
    // A timeout may mean a firewall is dropping packets rather than the port
    // being closed, and a DNS failure affects both schemes equally. Neither is
    // fixed by changing the scheme.
    for (const code of ['ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']) {
      expect(isConnectionRefusal(code)).toBe(false)
    }
  })

  it('treats a missing code as not retryable', () => {
    // An HTTP-level failure (500, redirect loop) carries no system code. The
    // server answered, so there is nothing for a scheme change to fix.
    expect(isConnectionRefusal(null)).toBe(false)
    expect(isConnectionRefusal('')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isConnectionRefusal('econnrefused')).toBe(true)
  })
})

describe('a cold first attempt must not fail the whole scan', () => {
  /*
   * Reported from real use: the first comprehensive scan of a host failed with
   * "the scan couldn't run", and an immediate second attempt succeeded. The
   * cause was a 15s fetch deadline being missed on a cold DNS cache and a
   * first TLS negotiation. Nothing was wrong with the target.
   *
   * A scan that only works the second time is a broken scan, so the HTTP probe
   * now re-attempts the SAME url once on transient codes.
   */
  const run = readFileSync(join(__dirname, '..', 'lib/scanner/run.ts'), 'utf8')

  it('retries the same url once on a transient failure', () => {
    expect(run).toContain('TRANSIENT_FIRST_ATTEMPT_CODES')
    expect(run).toContain('first = await fetchSite(url)')
  })

  it('counts timeouts and transient DNS as worth one retry', () => {
    const block = run.slice(
      run.indexOf('const TRANSIENT_FIRST_ATTEMPT_CODES'),
      run.indexOf('async function fetchWithSchemeFallback'),
    )
    for (const code of ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'EAI_AGAIN']) {
      expect(block).toContain(code)
    }
  })

  it('retries exactly once, so a dead host still fails fast', () => {
    /*
     * A loop here would turn an outage into a multi-minute hang on the one
     * screen where the user is already waiting.
     */
    const block = run.slice(
      run.indexOf('async function fetchWithSchemeFallback'),
      run.indexOf('RETRYABLE_CONNECTION_CODES'),
    )
    expect(block).not.toContain('for (')
    expect(block).not.toContain('while (')
  })

  it('still refuses to downgrade a timeout to plaintext HTTP', () => {
    // The retry must not have weakened the TLS guarantee: a firewall dropping
    // packets on 443 must never be silently reported as a clean HTTP scan.
    expect(isConnectionRefusal('ETIMEDOUT')).toBe(false)
  })
})
