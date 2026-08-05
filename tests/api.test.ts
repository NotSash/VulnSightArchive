import { type ChildProcess, spawn } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * API contract tests.
 *
 * These run against a real Next.js dev server and exercise the routes end to
 * end, including a genuine scan of example.com. They protect the HTTP contract
 * the frontend depends on: status codes, error shapes, and the guarantee that a
 * report is never served for a scan that did not complete.
 *
 * Set `SKIP_API_TESTS=1` to skip when running offline.
 */

const PORT = 3179
const BASE = `http://127.0.0.1:${PORT}`
const SKIP = process.env.SKIP_API_TESTS === '1'

let server: ChildProcess | undefined

async function waitForServer(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(3000) })
      if (res.ok || res.status < 500) return
    } catch {
      // Server not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('dev server did not become ready in time')
}

/** Start a scan and poll to completion, returning the finished report. */
async function runScanToCompletion(url: string, mode = 'quick') {
  const start = await fetch(`${BASE}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, scan_mode: mode, authorized: true }),
  })
  expect(start.status).toBe(201)
  const { scan_id } = (await start.json()) as { scan_id: string }

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/status/${scan_id}`)
    const status = (await res.json()) as { status: string }
    if (status.status === 'completed' || status.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  return { scanId: scan_id }
}

beforeAll(async () => {
  if (SKIP) return
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      /*
       * Raise the per-client quota for the suite. Every request here comes
       * from the same loopback address, so the production default of 5/hour
       * would exhaust itself partway through and fail later tests for the
       * wrong reason. The limiter itself is covered in `guard.test.ts`.
       */
      RATE_LIMIT_PER_CLIENT: '200',
      MAX_CONCURRENT_SCANS: '16',
    },
  })
  await waitForServer()
}, 120_000)

afterAll(() => {
  server?.kill('SIGTERM')
})

describe.skipIf(SKIP)(
  'POST /api/scan',
  () => {
    it('accepts a valid target and returns a scan id', async () => {
      const res = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'example.com', scan_mode: 'quick', authorized: true }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { scan_id: string; status: string }
      expect(body.scan_id).toMatch(/^vs_/)
      expect(body.status).toBe('running')
    })

    it('refuses a scan when authorisation is not affirmed', async () => {
      // The checkbox is a legal control, so the API must enforce it rather
      // than trusting the UI to have asked.
      const res = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'example.com', scan_mode: 'quick' }),
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { code?: string }
      expect(body.code).toBe('not_authorized')
    })

    it('refuses a blocklisted host', async () => {
      const res = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'agency.gov', scan_mode: 'quick', authorized: true }),
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { code?: string }
      expect(body.code).toBe('blocked_host')
    })

    it('rejects a malformed JSON body', async () => {
      const res = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBeTruthy()
    })

    it('rejects an unknown scan mode', async () => {
      const res = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'example.com', scan_mode: 'ultra' }),
      })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('scan_mode')
    })

    it('rejects localhost with an explanatory code', async () => {
      const res = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'localhost', scan_mode: 'quick', authorized: true }),
      })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('loopback')
    })

    it('rejects a private address, closing the SSRF path at the API boundary', async () => {
      const res = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'http://169.254.169.254',
          scan_mode: 'quick',
          authorized: true,
        }),
      })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('private_ip')
    })

    it('rejects a domain that does not resolve', async () => {
      const res = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'this-domain-should-never-exist-vulnsight-test.invalid',
          scan_mode: 'quick',
        }),
      })
      expect(res.status).toBe(400)
    })
  },
  60_000,
)

describe.skipIf(SKIP)(
  'GET /api/status/[scanId]',
  () => {
    it('returns 404 for an unknown scan', async () => {
      const res = await fetch(`${BASE}/api/status/vs_doesnotexist`)
      expect(res.status).toBe(404)
    })

    it('reports live progress and a timeline for a running scan', async () => {
      const start = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'example.com', scan_mode: 'quick', authorized: true }),
      })
      const { scan_id } = (await start.json()) as { scan_id: string }

      const res = await fetch(`${BASE}/api/status/${scan_id}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.scan_id).toBe(scan_id)
      expect(body.progress).toBeGreaterThanOrEqual(0)
      expect(body.progress).toBeLessThanOrEqual(100)
      expect(Array.isArray(body.timeline)).toBe(true)
      expect(body.timeline.length).toBeGreaterThan(0)
      expect(typeof body.stage).toBe('string')
    })
  },
  60_000,
)

describe.skipIf(SKIP)(
  'GET /api/report/[scanId]',
  () => {
    it('returns 404 for an unknown scan', async () => {
      const res = await fetch(`${BASE}/api/report/vs_doesnotexist`)
      expect(res.status).toBe(404)
    })

    it('returns 409 rather than a partial report while a scan is running', async () => {
      const start = await fetch(`${BASE}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'example.com', scan_mode: 'quick', authorized: true }),
      })
      const { scan_id } = (await start.json()) as { scan_id: string }

      const res = await fetch(`${BASE}/api/report/${scan_id}`)
      // Either still running (409) or already finished (200) — never a partial body.
      expect([200, 409]).toContain(res.status)
      if (res.status === 409) {
        expect((await res.json()).error).toContain('progress')
      }
    })

    it('returns a complete, well-formed report for a finished scan', async () => {
      const { scanId } = await runScanToCompletion('example.com')
      const res = await fetch(`${BASE}/api/report/${scanId}`)
      expect(res.status).toBe(200)

      const report = await res.json()
      expect(report.scan_id).toBe(scanId)
      expect(report.status).toBe('completed')

      // Contract fields the UI and PDF both depend on.
      for (const key of [
        'metadata',
        'website',
        'technologies',
        'security_headers',
        'ssl',
        'open_ports',
        'timeline',
        'vulnerabilities',
        'severity_distribution',
        'cves',
        'owasp_mapping',
        'risk',
        'ai',
      ]) {
        expect(report).toHaveProperty(key)
      }

      expect(report.risk.score).toBeGreaterThanOrEqual(0)
      expect(report.risk.score).toBeLessThanOrEqual(100)
      expect(['Safe', 'Moderate', 'High', 'Critical']).toContain(report.risk.category)

      // The published penalty breakdown must reconstruct the score.
      const total = report.risk.penalties.reduce(
        (sum: number, p: { points: number }) => sum + p.points,
        0,
      )
      expect(total).toBe(100 - report.risk.score)

      // Severity distribution must agree with the finding list.
      const counted = report.vulnerabilities.reduce(
        (acc: Record<string, number>, v: { severity: string }) => {
          acc[v.severity] = (acc[v.severity] ?? 0) + 1
          return acc
        },
        {},
      )
      for (const [severity, count] of Object.entries(counted)) {
        expect(report.severity_distribution[severity]).toBe(count)
      }

      // Every finding must carry the fields the report renders.
      for (const finding of report.vulnerabilities) {
        expect(finding.id).toBeTruthy()
        expect(finding.title).toBeTruthy()
        expect(finding.recommendation).toBeTruthy()
        expect(finding.source).toBeTruthy()
        expect(['critical', 'high', 'medium', 'low', 'info']).toContain(finding.severity)
      }

      // Findings must be ordered most-severe first.
      const order = ['critical', 'high', 'medium', 'low', 'info']
      const indices = report.vulnerabilities.map((v: { severity: string }) =>
        order.indexOf(v.severity),
      )
      expect(indices).toEqual([...indices].sort((a, b) => a - b))
    }, 150_000)

    it('records a coverage note instead of inventing data for unavailable tools', async () => {
      const { scanId } = await runScanToCompletion('example.com')
      const report = await (await fetch(`${BASE}/api/report/${scanId}`)).json()

      // Chromium is not installed in CI, so this must be declared, not faked.
      expect(Array.isArray(report.notes)).toBe(true)
      for (const note of report.notes) {
        expect(note.stage).toBeTruthy()
        expect(note.detail).toBeTruthy()
        expect(['unavailable', 'skipped', 'failed']).toContain(note.status)
      }
      if (!report.evidence?.browser?.available) {
        expect(report.website.screenshot).toBeNull()
      }
    }, 150_000)
  },
  200_000,
)

describe.skipIf(SKIP)(
  'GET /api/report/[scanId]/pdf',
  () => {
    it('returns 404 for an unknown scan', async () => {
      const res = await fetch(`${BASE}/api/report/vs_doesnotexist/pdf`)
      expect(res.status).toBe(404)
    })

    it('generates a valid PDF for a completed scan', async () => {
      const { scanId } = await runScanToCompletion('example.com')
      const res = await fetch(`${BASE}/api/report/${scanId}/pdf`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/pdf')
      expect(res.headers.get('content-disposition')).toContain('attachment')

      const buffer = Buffer.from(await res.arrayBuffer())
      // %PDF- magic bytes, and large enough to contain a real report.
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
      expect(buffer.length).toBeGreaterThan(5000)
    }, 150_000)
  },
  200_000,
)
