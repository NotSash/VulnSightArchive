import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateReportPdf } from '@/lib/report/pdf'
import type { ScanReport, Severity, Vulnerability } from '@/types/report'

/**
 * PDF generation.
 *
 * The report is the deliverable a client keeps, so the tests here guard the
 * failure modes that actually made previous versions look unprofessional:
 *
 * - Runaway pagination. Header/footer painting once auto-paginated, turning a
 *   15-page report into 54 pages, most of them blank.
 * - Crashing on sparse data. A quick scan produces a report with no CVEs, no
 *   ports, no screenshot and no AI narrative; the generator must still emit a
 *   complete document rather than throw.
 */

function vuln(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: 'v1',
    title: 'Content-Security-Policy header not set',
    severity: 'medium' as Severity,
    description: 'The response does not include a Content-Security-Policy header.',
    impact: 'Injected script executes without restriction.',
    recommendation: 'Define a Content-Security-Policy.',
    references: ['https://developer.mozilla.org/docs/Web/HTTP/CSP'],
    cvss_score: null,
    cwe_id: 'CWE-693',
    cve_id: null,
    owasp_category: 'A05:2021 — Security Misconfiguration',
    source: 'header',
    evidence: 'Content-Security-Policy header absent',
    location: null,
    ...overrides,
  }
}

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    scan_id: 'vs_test0001',
    status: 'completed',
    metadata: {
      url: 'https://example.com',
      scan_mode: 'standard',
      timestamp: '2026-01-15T10:30:00.000Z',
      duration_seconds: 92,
    },
    website: {
      title: 'Example',
      domain: 'example.com',
      ip_address: '93.184.216.34',
      server: 'nginx',
      favicon: null,
      screenshot: null,
    },
    technologies: [],
    security_headers: [],
    ssl: {
      valid: true,
      issuer: 'Example CA',
      subject: 'example.com',
      expires: '2027-01-01',
      days_remaining: 351,
      tls_version: 'TLSv1.3',
      grade: 'A',
      available: true,
    },
    open_ports: [],
    timeline: [],
    vulnerabilities: [vuln()],
    severity_distribution: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
    cves: [],
    owasp_mapping: [],
    risk: { score: 90, category: 'Safe', penalties: [{ label: 'Medium (1)', points: 10 }] },
    ai: {
      executive_summary: 'One hardening gap was identified.',
      technical_summary: 'Missing CSP.',
      key_risks: ['Missing CSP'],
      recommendations: ['Add a CSP'],
      remediation: { immediate: [], short_term: ['Add a CSP'], long_term: [] },
      generated_by: 'VulnSight rule engine',
      available: false,
    },
    ...overrides,
  }
}

/** Page count, read straight from the PDF page tree. */
function pageCount(pdf: Buffer): number {
  const match = pdf.toString('latin1').match(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/)
  return match ? Number(match[1]) : 0
}

describe('generateReportPdf', () => {
  it('produces a valid PDF', async () => {
    const pdf = await generateReportPdf(report())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(10_000)
  })

  it('stays within a sane page count for a small report', async () => {
    /*
     * Regression: painting the running header and footer through PDFKit's
     * flow-aware `text()` auto-paginated once per call, appending a blank page
     * for every real one. A one-finding report must not exceed single digits.
     */
    const pages = pageCount(await generateReportPdf(report()))
    expect(pages).toBeGreaterThan(3)
    expect(pages).toBeLessThan(10)
  })

  it('grows roughly linearly with the number of findings', async () => {
    const many = report({
      vulnerabilities: Array.from({ length: 12 }, (_, i) =>
        vuln({ id: `v${i}`, title: `Finding number ${i}` }),
      ),
      severity_distribution: { critical: 0, high: 0, medium: 12, low: 0, info: 0 },
    })
    const pages = pageCount(await generateReportPdf(many))
    expect(pages).toBeGreaterThan(pageCount(await generateReportPdf(report())))
    expect(pages).toBeLessThan(30)
  })

  it('handles a report with no findings at all', async () => {
    const empty = report({
      vulnerabilities: [],
      severity_distribution: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      risk: { score: 100, category: 'Safe', penalties: [] },
    })
    const pdf = await generateReportPdf(empty)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('handles missing optional evidence without throwing', async () => {
    const sparse = report({
      ssl: {
        valid: false,
        issuer: '',
        subject: '',
        expires: '',
        days_remaining: 0,
        tls_version: '',
        grade: 'Unrated',
        available: false,
      },
      ai: {
        executive_summary: '',
        technical_summary: '',
        key_risks: [],
        recommendations: [],
        remediation: { immediate: [], short_term: [], long_term: [] },
        generated_by: 'VulnSight rule engine',
        available: false,
      },
    })
    await expect(generateReportPdf(sparse)).resolves.toBeInstanceOf(Buffer)
  })

  it('records the target in the document metadata', async () => {
    const pdf = await generateReportPdf(report())
    // PDFKit may write the title as UTF-16BE, so check both encodings.
    const text = pdf.toString('latin1')
    expect(text.includes('example.com') || text.includes('e\u0000x\u0000a\u0000m')).toBe(true)
  })

  it('embeds an invalid screenshot without aborting the document', async () => {
    // A corrupt data URL must degrade to a note in the appendix, not an error.
    const withBadImage = report({
      website: { ...report().website, screenshot: 'data:image/png;base64,not-real-image-data' },
    })
    await expect(generateReportPdf(withBadImage)).resolves.toBeInstanceOf(Buffer)
  })

  it('writes a viewable artefact when asked to', async () => {
    // Not an assertion so much as a developer affordance: the file can be
    // opened to eyeball layout changes after editing the generator.
    const path = join(tmpdir(), 'vulnsight-test-report.pdf')
    writeFileSync(path, await generateReportPdf(report()))
    expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-')
  })
})

/**
 * Column-fit regression guard.
 *
 * Switching from Helvetica/Courier to the brand faces made every string wider,
 * and several fixed-width table columns silently began wrapping: "VS-001"
 * rendered as "VS-00 / 1", "Informational" as "Information / al". Those are
 * invisible to a type-checker and easy to miss by eye, so the widths are
 * asserted directly against the embedded fonts.
 */
describe('table columns fit the embedded fonts', () => {
  const PAD = 16 // table() pads 8pt each side

  async function widths(): Promise<(text: string, font: string, size?: number) => number> {
    const { default: PDFDocument } = await import('pdfkit/js/pdfkit.standalone.js')
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(process.cwd(), 'assets', 'fonts')
    // biome-ignore lint/suspicious/noExplicitAny: pdfkit has no ESM types here
    const doc: any = new PDFDocument()
    doc.registerFont('mono', readFileSync(join(dir, 'JetBrainsMono-Regular.ttf')))
    doc.registerFont('monoB', readFileSync(join(dir, 'JetBrainsMono-Bold.ttf')))
    doc.registerFont('sans', readFileSync(join(dir, 'Inter-Regular.ttf')))
    return (text, font, size = 8.2) => {
      doc.font(font).fontSize(size)
      return doc.widthOfString(text) as number
    }
  }

  it('fits finding references in the register Ref column', async () => {
    const w = await widths()
    expect(w('VS-001', 'monoB')).toBeLessThan(52 - PAD)
    expect(w('VS-999', 'monoB')).toBeLessThan(52 - PAD)
  })

  it('fits every severity label in the register Severity column', async () => {
    const w = await widths()
    for (const label of ['Critical', 'High', 'Medium', 'Low', 'Info']) {
      expect(w(label, 'sans')).toBeLessThan(62 - PAD)
    }
    // The long form must stay out of that column.
    expect(w('Informational', 'sans')).toBeGreaterThan(62 - PAD)
  })

  it('fits the widest realistic port string', async () => {
    const w = await widths()
    expect(w('31337/tcp', 'mono')).toBeLessThan(70 - PAD)
  })

  it('fits a full CVE identifier', async () => {
    const w = await widths()
    expect(w('CVE-2021-44224', 'mono')).toBeLessThan(92 - PAD)
  })
})

/**
 * Deployment guard.
 *
 * The PDF generator reads its typefaces from `assets/fonts` at runtime. The
 * Docker runtime stage copies only the Next standalone output, so without an
 * explicit COPY the fonts are absent and every export throws ENOENT in
 * production while working perfectly in development — the worst kind of bug.
 */
describe('font assets ship with the app', () => {
  it('has every font the generator loads', async () => {
    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(process.cwd(), 'assets', 'fonts')
    for (const file of [
      'Jersey25-Regular.ttf',
      'Inter-Regular.ttf',
      'Inter-SemiBold.ttf',
      'JetBrainsMono-Regular.ttf',
      'JetBrainsMono-Bold.ttf',
    ]) {
      expect(existsSync(join(dir, file)), `${file} is missing`).toBe(true)
    }
  })

  it('is copied into the Docker runtime image', async () => {
    const { readFileSync } = await import('node:fs')
    const dockerfile = readFileSync('Dockerfile', 'utf8')
    expect(dockerfile).toMatch(/COPY --from=builder \/app\/assets/)
  })
})
