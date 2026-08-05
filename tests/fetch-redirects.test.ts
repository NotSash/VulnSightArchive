import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchSite } from '@/lib/scanner/probe'

/**
 * Redirect handling in `fetchSite`.
 *
 * Exercised against a real local HTTP server so the behaviour under test is
 * the actual socket-level flow, not a mock of it.
 *
 * Note: these tests bind to 127.0.0.1, which the SSRF guard blocks by design.
 * `ALLOW_LOOPBACK_FETCH_FOR_TESTS` opens that specific door for the test
 * process only; it is never read in normal operation.
 */

let server: Server
let base = ''

beforeAll(async () => {
  process.env.ALLOW_LOOPBACK_FETCH_FOR_TESTS = '1'

  server = createServer((req, res) => {
    const url = req.url ?? '/'

    if (url === '/redirect-chain') {
      // An intermediate hop that sets its own cookie before redirecting.
      res.writeHead(302, {
        location: '/final',
        'set-cookie': 'intermediate_cookie=leaked; Path=/',
      })
      res.end()
      return
    }

    if (url === '/final') {
      res.writeHead(200, {
        'content-type': 'text/html',
        'set-cookie': 'final_cookie=kept; Path=/; Secure; HttpOnly; SameSite=Lax',
      })
      res.end('<html><head><title>Final</title></head><body>ok</body></html>')
      return
    }

    if (url === '/loop') {
      res.writeHead(302, { location: '/loop' })
      res.end()
      return
    }

    if (url === '/no-location') {
      res.writeHead(302)
      res.end()
      return
    }

    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><head><title>Root</title></head><body>root</body></html>')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  process.env.ALLOW_LOOPBACK_FETCH_FOR_TESTS = undefined
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('fetchSite redirect handling', () => {
  it('attributes cookies to the final response only', async () => {
    // An intermediate host's cookies must not be reported as the target's,
    // or the report accuses the wrong site of a missing Secure flag.
    const result = await fetchSite(`${base}/redirect-chain`)

    expect(result.ok).toBe(true)
    expect(result.setCookie.join(';')).toContain('final_cookie')
    expect(result.setCookie.join(';')).not.toContain('intermediate_cookie')
  })

  it('reports the final URL after following the chain', async () => {
    const result = await fetchSite(`${base}/redirect-chain`)
    expect(result.finalUrl).toBe(`${base}/final`)
    expect(result.status).toBe(200)
  })

  it('stops on a redirect loop instead of hanging', async () => {
    const result = await fetchSite(`${base}/loop`, 10_000)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('redirect')
  })

  it('fails clearly when a redirect omits its Location header', async () => {
    const result = await fetchSite(`${base}/no-location`)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Location')
  })

  it('captures the body and content type of a direct response', async () => {
    const result = await fetchSite(`${base}/`)
    expect(result.ok).toBe(true)
    expect(result.isHtml).toBe(true)
    expect(result.body).toContain('<title>Root</title>')
  })
})
