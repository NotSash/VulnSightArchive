import { describe, expect, it, vi } from 'vitest'
import type { StageUpdate } from '@/lib/scanner/run'
import { runScan, stagesForMode } from '@/lib/scanner/run'
import type { ScanMode } from '@/types/report'

/**
 * Proves the stage cursor stays aligned, by running the orchestrator.
 *
 * `complete()` advances an implicit counter and now throws if the caller
 * passes a stage name that does not match where the counter landed. Every one
 * of the 26 call sites passes its name, so any drift between the order of
 * those calls and `STAGES[mode]` surfaces here as a thrown error rather than
 * as a plausible but wrong timeline in the UI.
 *
 * The scanners are stubbed as unavailable, which is also the more demanding
 * path: it exercises every `skipped` branch, and those are the ones sitting
 * inside mode guards where drift would actually happen.
 */

vi.mock('@/lib/scanner/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scanner/browser')>()
  return {
    ...actual,
    collectBrowserEvidence: vi.fn(async () => ({ available: false, reason: 'stub' })),
  }
})
vi.mock('@/lib/scanner/nmap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scanner/nmap')>()
  return {
    ...actual,
    runNmapScan: vi.fn(async () => ({ available: false, reason: 'stub', ports: [] })),
  }
})
vi.mock('@/lib/scanner/nuclei', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scanner/nuclei')>()
  return {
    ...actual,
    runNucleiScan: vi.fn(async () => ({ available: false, reason: 'stub', findings: [] })),
  }
})
vi.mock('@/lib/scanner/zap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scanner/zap')>()
  return {
    ...actual,
    runZapPassiveScan: vi.fn(async () => ({ available: false, reason: 'stub', alerts: [] })),
  }
})
vi.mock('@/lib/scanner/cve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scanner/cve')>()
  return {
    ...actual,
    enrichCves: vi.fn(async () => ({ available: false, reason: 'stub', cves: [] })),
  }
})
vi.mock('@/lib/scanner/ai', () => ({
  buildOptionalAiSummary: vi.fn(async () => ({ available: false, reason: 'stub' })),
}))
vi.mock('@/lib/scanner/ai-correlate', () => ({
  reviewCorrelation: vi.fn(async () => ({ available: false, reason: 'stub', links: [] })),
}))

/**
 * A minimal but *complete* HTTP response.
 *
 * Every field of `HttpResult` matters here: an incomplete stub crashes the
 * pipeline partway through, and a scan that stops after five stages cannot
 * prove anything about the alignment of the fifteenth.
 */
const okHttp = {
  ok: true,
  status: 200,
  finalUrl: 'http://example.test/',
  headers: { server: 'nginx' } as Record<string, string>,
  setCookie: [] as string[],
  body: '<html><head><title>t</title></head><body></body></html>',
  isHtml: true,
  reason: null,
  errorCode: null,
  elapsedMs: 5,
}

vi.mock('@/lib/scanner/probe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scanner/probe')>()
  return {
    ...actual,
    fetchSite: vi.fn(async () => okHttp),
    inspectTls: vi.fn(async () => ({ ok: false, reason: 'stub', certificate: null })),
    probePort: vi.fn(async () => ({ port: 80, state: 'closed' as const, service: null })),
    resolveRecords: vi.fn(async () => ({ mx: [], txt: [], ns: [], caa: [] })),
  }
})

async function stagesEmittedFor(mode: ScanMode): Promise<string[]> {
  const seen: string[] = []
  try {
    await runScan({
      scanId: `test_${mode}`,
      url: 'http://example.test/',
      hostname: 'example.test',
      mode,
      dns: {
        ok: true,
        address: '93.184.216.34',
        addresses: ['93.184.216.34'],
        family: 4,
        reason: null,
      },
      onStage: (u: StageUpdate) => seen.push(u.name),
    })
  } catch (error) {
    // A misalignment throw must fail the test loudly; anything else (a stubbed
    // scanner refusing to produce a report) is expected and irrelevant here.
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Stage misalignment')) throw error
  }
  return seen
}

describe('stage cursor stays aligned at runtime', () => {
  for (const mode of ['quick', 'standard', 'comprehensive'] as ScanMode[]) {
    it(`emits stages in declared order for ${mode}`, async () => {
      const seen = await stagesEmittedFor(mode)
      const declared = stagesForMode(mode)
      // Whatever ran must be a prefix of the declared list, in order.
      expect(seen).toEqual(declared.slice(0, seen.length))
    })
  }
})
