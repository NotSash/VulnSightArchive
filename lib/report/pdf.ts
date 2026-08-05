/**
 * VulnSight PDF report.
 *
 * The output of this module is the deliverable a client actually keeps, so it
 * is written to the conventions of a professional penetration-test report
 * rather than those of a dashboard export:
 *
 * - A restrained, typographic layout. Ink is spent on content, not decoration:
 *   one accent colour, one type family, generous margins, thin rules.
 * - Numbered sections and a table of contents with real page numbers, so the
 *   document can be referenced in an email or a ticket ("see section 4.3").
 * - A document-control block, an explicit scope and authorisation statement,
 *   and a methodology section naming every tool and the exact command used.
 *   These are what make a report auditable rather than merely informative.
 * - Every finding gets a stable identifier (VS-001), a metadata table, the raw
 *   evidence that supports it, remediation guidance, and a retest column that
 *   the receiving team can fill in.
 * - Coverage gaps are stated as prominently as findings. A report that hides
 *   what it failed to check is worse than no report.
 *
 * Layout approach: the document is created with real page margins and text is
 * emitted through PDFKit's flow layout, so long content paginates itself. A
 * `pageAdded` hook paints the running header; footers are painted in a final
 * pass once the total page count is known.
 *
 * Theme: the report is the printed counterpart of the console UI, so it uses
 * the same three faces (Jersey 25 for display, Inter for prose, JetBrains Mono
 * for data) and the same rule about colour — chroma means severity or
 * agreement between tools, never decoration.
 *
 * Pages are light rather than dark: a 20-page dark document is punishing to
 * read on paper and wastes toner, so the brand's phosphor and severity hues sit
 * on a warm off-white page, with the near-black console reserved for the cover
 * and for evidence blocks, which genuinely are terminal output.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import PDFDocument from 'pdfkit/js/pdfkit.standalone.js'
import { SEVERITY_ORDER } from '@/lib/severity'
import type {
  CveEntry,
  OpenPort,
  ScanReport,
  SecurityHeader,
  Severity,
  Vulnerability,
} from '@/types/report'

type PdfDoc = PDFKit.PDFDocument

/* ------------------------------------------------------------------ theme */

const PAGE = { width: 595.28, height: 841.89 }

const M = { top: 78, bottom: 64, left: 56, right: 56 }
const CONTENT_LEFT = M.left
const CONTENT_WIDTH = PAGE.width - M.left - M.right
const CONTENT_BOTTOM = PAGE.height - M.bottom

/**
 * A deliberately narrow palette. Colour in a security report should mean
 * something — severity, or nothing at all.
 */
const C = {
  /* Page + ink. A warm off-white rather than pure white: easier on the eye over
     twenty pages, and it makes the phosphor accent sit correctly. */
  page: '#FBFAF7',
  ink: '#0B1117',
  body: '#39454F',
  muted: '#697884',
  faint: '#9AA7B1',
  rule: '#E2E5E4',
  ruleStrong: '#C9CFCE',
  wash: '#F3F2EE',
  washAlt: '#EBEAE5',
  white: '#FFFFFF',

  /* The console, used where the document is quoting a machine: the cover, the
     score panel, and raw command output. */
  console: '#0B1117',
  consoleAlt: '#131C25',
  consoleRule: '#2A3742',
  consoleText: '#E6EDF2',
  consoleDim: '#8FA3B0',

  /* Phosphor. Reserved exactly as on the site: agreement between tools.
     Darkened from the screen value so it holds up as ink on paper. */
  accent: '#0F9D6E',
  accentSoft: '#E4F5EE',
  accentDark: '#0B1117',

  /* Severity. The only other licensed use of colour. */
  critical: '#B3261E',
  high: '#C2540B',
  medium: '#9A6B08',
  low: '#1F6FB2',
  info: '#697884',

  /* The same hues lifted for the dark cover, where the print-weight versions
     would be too dim to read against near-black. */
  accentOnDark: '#67E8B0',
  criticalOnDark: '#FF6154',
  highOnDark: '#FF9147',
  mediumOnDark: '#F2C14E',
  lowOnDark: '#7FB6EA',
  infoOnDark: '#9FB3C0',
}

/* The three faces, matching the interface. Registered on every document. */
const FONT = {
  display: 'vs-display',
  sans: 'vs-sans',
  sansBold: 'vs-sans-bold',
  mono: 'vs-mono',
  monoBold: 'vs-mono-bold',
} as const

const FONT_FILES: Record<string, string> = {
  [FONT.display]: 'Jersey25-Regular.ttf',
  [FONT.sans]: 'Inter-Regular.ttf',
  [FONT.sansBold]: 'Inter-SemiBold.ttf',
  [FONT.mono]: 'JetBrainsMono-Regular.ttf',
  [FONT.monoBold]: 'JetBrainsMono-Bold.ttf',
}

/**
 * Load the brand faces into the document.
 *
 * Read once per process: the files are small after subsetting (~340 KB total),
 * but re-reading them for every report would be needless disk work.
 */
let fontCache: Record<string, Buffer> | null = null

function loadFonts(doc: PdfDoc): void {
  if (!fontCache) {
    const dir = join(process.cwd(), 'assets', 'fonts')
    fontCache = {}
    for (const [name, file] of Object.entries(FONT_FILES)) {
      fontCache[name] = readFileSync(join(dir, file))
    }
  }
  for (const [name, buffer] of Object.entries(fontCache)) {
    doc.registerFont(name, buffer)
  }
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Informational',
}

/**
 * What each severity means in operational terms.
 *
 * Printed in the appendix so the rating is auditable: a reader can check a
 * finding against the definition instead of taking the label on trust.
 */
const SEVERITY_DEFINITION: Record<Severity, string> = {
  critical:
    'Directly exploitable with severe consequences such as remote code execution, authentication bypass, or mass data exposure. Treat as an incident and remediate immediately.',
  high: 'Exploitable weakness with serious impact on confidentiality, integrity or availability. Remediate within the current sprint.',
  medium:
    'A weakness that meaningfully increases risk, usually requiring a precondition or in combination with another issue. Schedule remediation.',
  low: 'A hardening gap with limited direct impact. Address as part of routine maintenance.',
  info: 'Observation with no direct security impact. Recorded for completeness and situational awareness.',
}

/**
 * Short severity label for narrow table columns.
 *
 * "Informational" is too wide for the register column and wraps onto a second
 * line, which makes an otherwise tidy table look broken.
 */
const SEVERITY_SHORT: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

const CONFIDENCE_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  probable: 'Probable',
  observed: 'Observed',
}

const CONFIDENCE_DEFINITION: Record<string, string> = {
  confirmed: 'Two or more independent tools observed this issue.',
  probable: 'One tool observed this issue directly, with supporting evidence.',
  observed:
    'Inferred from configuration rather than an active test. Real, but carrying no proof of exploitability.',
}

function severityColor(severity: Severity): string {
  return C[severity]
}

/** Severity hue for the dark cover, where print-weight colours read as mud. */
function severityColorOnDark(severity: Severity): string {
  const map: Record<Severity, string> = {
    critical: C.criticalOnDark,
    high: C.highOnDark,
    medium: C.mediumOnDark,
    low: C.lowOnDark,
    info: C.infoOnDark,
  }
  return map[severity]
}

/**
 * Colour for the headline score, on dark.
 *
 * Bands mirror the risk categories the scoring engine produces, so the colour
 * never disagrees with the printed category label.
 */
function riskColorOnDark(score: number): string {
  if (score >= 80) return C.accentOnDark
  if (score >= 60) return C.lowOnDark
  if (score >= 40) return C.highOnDark
  return C.criticalOnDark
}

/* -------------------------------------------------------------- utilities */

function collect(doc: PdfDoc): Promise<Buffer> {
  const chunks: Buffer[] = []
  doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

function truncate(value: string, max = 240): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** Format an ISO timestamp as an unambiguous, locale-independent string. */
function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())} UTC`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'n/a'
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return mins ? `${mins} min ${secs} s` : `${secs} s`
}

/** Stable, human-quotable identifier for a finding: VS-001, VS-002, … */
function findingRef(index: number): string {
  return `VS-${String(index + 1).padStart(3, '0')}`
}

/* --------------------------------------------------------- document state */

interface TocEntry {
  number: string
  title: string
  page: number
}

interface Ctx {
  doc: PdfDoc
  report: ScanReport
  /** Zero-based index of the page currently being written. */
  page: number
  /** Pages that must not receive a running header/footer. */
  plain: Set<number>
  /** Index of the page reserved for the table of contents. */
  tocPage: number
  toc: TocEntry[]
  section: number
  sub: number
}

/* ------------------------------------------------------------- primitives */

/**
 * Write outside the text-flow area without triggering a page break.
 *
 * PDFKit's `text()` auto-paginates whenever the cursor passes the bottom
 * margin — including for absolutely positioned text in the header or footer
 * band. Zeroing the margins for the duration of the call suppresses that; the
 * previous implementation omitted this and each footer spawned a blank page,
 * turning a 15-page report into 54 pages.
 */
function outsideFlow(doc: PdfDoc, draw: () => void): void {
  const margins = doc.page.margins
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 }
  try {
    draw()
  } finally {
    doc.page.margins = margins
  }
}

/**
 * Lay down the page tint.
 *
 * A warm off-white rather than the default pure white: over twenty pages it is
 * measurably easier to read, and it stops the phosphor accent looking acidic.
 * Painted before any content, on every page.
 */
function paintPageBackground(doc: PdfDoc): void {
  const cursorY = doc.y
  doc.save()
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(C.page)
  doc.restore()
  doc.y = cursorY
}

function runningHeader(ctx: Ctx): void {
  const { doc, report } = ctx
  const cursorY = doc.y
  outsideFlow(doc, () => {
    doc
      .font(FONT.sansBold)
      .fontSize(7.5)
      .fillColor(C.accentDark)
      .text('VULNSIGHT', CONTENT_LEFT, 40, { width: CONTENT_WIDTH / 2, lineBreak: false })
    doc
      .font(FONT.sans)
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(
        truncate(`Security Assessment: ${report.website.domain}`, 70),
        CONTENT_LEFT + CONTENT_WIDTH / 2,
        40,
        { width: CONTENT_WIDTH / 2, align: 'right', lineBreak: false },
      )
  })
  // Restore the flow cursor: the header must not move where content starts.
  doc.y = cursorY
  doc
    .moveTo(CONTENT_LEFT, 54)
    .lineTo(PAGE.width - M.right, 54)
    .lineWidth(0.5)
    .strokeColor(C.ruleStrong)
    .stroke()
}

/** Start a fresh content page. */
function newPage(ctx: Ctx): void {
  ctx.doc.addPage()
}

/** Guarantee `height` points of room, breaking the page if needed. */
function need(ctx: Ctx, height: number): void {
  if (ctx.doc.y + height > CONTENT_BOTTOM) newPage(ctx)
}

/** Top-level numbered heading. Registers a table-of-contents entry. */
function h1(ctx: Ctx, title: string): void {
  const { doc } = ctx
  // A heading stranded at the foot of a page reads as a mistake.
  if (doc.y > CONTENT_BOTTOM - 120) newPage(ctx)
  ctx.section += 1
  ctx.sub = 0
  const number = String(ctx.section)
  ctx.toc.push({ number, title, page: ctx.page })

  doc.moveDown(0.6)
  const y = doc.y
  doc.rect(CONTENT_LEFT, y, 3, 17).fill(C.accent)
  doc
    .font(FONT.sansBold)
    .fontSize(14)
    .fillColor(C.ink)
    .text(`${number}.  ${title}`, CONTENT_LEFT + 12, y + 1, { width: CONTENT_WIDTH - 12 })
  doc.moveDown(0.5)
  const ruleY = doc.y
  doc
    .moveTo(CONTENT_LEFT, ruleY)
    .lineTo(PAGE.width - M.right, ruleY)
    .lineWidth(0.75)
    .strokeColor(C.ruleStrong)
    .stroke()
  doc.y = ruleY + 12
  doc.x = CONTENT_LEFT
}

/** Second-level heading, numbered under the current section. */
function h2(ctx: Ctx, title: string): void {
  const { doc } = ctx
  if (doc.y > CONTENT_BOTTOM - 90) newPage(ctx)
  ctx.sub += 1
  doc.moveDown(0.5)
  doc
    .font(FONT.sansBold)
    .fontSize(10.5)
    .fillColor(C.accentDark)
    .text(`${ctx.section}.${ctx.sub}  ${title}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH })
  doc.moveDown(0.4)
  doc.x = CONTENT_LEFT
}

function para(ctx: Ctx, text: string, options: { size?: number; color?: string } = {}): void {
  const { doc } = ctx
  if (!text?.trim()) return
  doc
    .font(FONT.sans)
    .fontSize(options.size ?? 9.5)
    .fillColor(options.color ?? C.body)
    .text(text.trim(), CONTENT_LEFT, doc.y, {
      width: CONTENT_WIDTH,
      align: 'left',
      lineGap: 2.6,
    })
  doc.moveDown(0.55)
  doc.x = CONTENT_LEFT
}

function bullets(ctx: Ctx, items: string[], indent = 0): void {
  const { doc } = ctx
  for (const item of items) {
    if (!item?.trim()) continue
    need(ctx, 26)
    const y = doc.y
    doc
      .font(FONT.sans)
      .fontSize(9.5)
      .fillColor(C.accent)
      .text('•', CONTENT_LEFT + indent, y, { width: 10, lineBreak: false })
    doc
      .font(FONT.sans)
      .fontSize(9.5)
      .fillColor(C.body)
      .text(item.trim(), CONTENT_LEFT + indent + 12, y, {
        width: CONTENT_WIDTH - indent - 12,
        lineGap: 2.4,
      })
    doc.moveDown(0.35)
  }
  doc.moveDown(0.2)
  doc.x = CONTENT_LEFT
}

/** A small filled label. Used for severity and confidence, nothing else. */
function chip(doc: PdfDoc, text: string, x: number, y: number, color: string): number {
  doc.font(FONT.sansBold).fontSize(7)
  const width = doc.widthOfString(text.toUpperCase()) + 14
  doc.roundedRect(x, y, width, 13, 3).fill(color)
  doc
    .fillColor(C.white)
    .text(text.toUpperCase(), x, y + 3.6, { width, align: 'center', lineBreak: false })
  return width
}

/** Outlined variant, for labels that must not compete with severity. */
function chipOutline(doc: PdfDoc, text: string, x: number, y: number): number {
  doc.font(FONT.sansBold).fontSize(7)
  const width = doc.widthOfString(text.toUpperCase()) + 14
  doc.roundedRect(x, y, width, 13, 3).lineWidth(0.6).strokeColor(C.ruleStrong).stroke()
  doc
    .fillColor(C.muted)
    .text(text.toUpperCase(), x, y + 3.6, { width, align: 'center', lineBreak: false })
  return width
}

interface Column {
  label: string
  /** Leave empty cells blank instead of printing an em dash placeholder. */
  blankable?: boolean
  width: number
  align?: 'left' | 'right' | 'center'
  /** Render as fixed-width text — used for ports, hashes and raw values. */
  mono?: boolean
}

/**
 * A ruled table with a repeating header row.
 *
 * Rows are measured before they are drawn so a row is never split across a
 * page boundary — a half-row is the fastest way to make a report look
 * machine-generated.
 */
function table(
  ctx: Ctx,
  columns: Column[],
  rows: (string | { text: string; color?: string; bold?: boolean })[][],
  options: { zebra?: boolean } = {},
): void {
  const { doc } = ctx
  const zebra = options.zebra ?? true
  const padX = 8
  const padY = 6

  const drawHead = () => {
    const y = doc.y
    doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, 20).fill(C.accentDark)
    let x = CONTENT_LEFT
    for (const column of columns) {
      doc
        .font(FONT.sansBold)
        .fontSize(7.2)
        .fillColor(C.white)
        .text(column.label.toUpperCase(), x + padX, y + 6.6, {
          width: column.width - padX * 2,
          align: column.align ?? 'left',
          lineBreak: false,
        })
      x += column.width
    }
    doc.y = y + 20
  }

  need(ctx, 60)
  drawHead()

  rows.forEach((row, rowIndex) => {
    const cells = row.map((cell) => (typeof cell === 'string' ? { text: cell } : cell))
    // Measure the tallest cell so the row height fits its content exactly.
    let height = 0
    cells.forEach((cell, i) => {
      const column = columns[i]
      doc.font(column?.mono ? FONT.mono : FONT.sans).fontSize(8.2)
      const measured = doc.heightOfString(cell.text || (column?.blankable ? ' ' : '-'), {
        width: (column?.width ?? 100) - padX * 2,
        lineGap: 1.6,
      })
      height = Math.max(height, measured)
    })
    height += padY * 2

    if (doc.y + height > CONTENT_BOTTOM) {
      newPage(ctx)
      drawHead()
    }

    const y = doc.y
    if (zebra && rowIndex % 2 === 1) {
      doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, height).fill(C.wash)
    }

    let x = CONTENT_LEFT
    cells.forEach((cell, i) => {
      const column = columns[i]
      if (!column) return
      doc
        .font(cell.bold ? FONT.sansBold : column.mono ? FONT.mono : FONT.sans)
        .fontSize(8.2)
        .fillColor(cell.color ?? C.body)
        .text(cell.text || (column.blankable ? '' : '-'), x + padX, y + padY, {
          width: column.width - padX * 2,
          align: column.align ?? 'left',
          lineGap: 1.6,
        })
      x += column.width
    })

    doc
      .moveTo(CONTENT_LEFT, y + height)
      .lineTo(CONTENT_LEFT + CONTENT_WIDTH, y + height)
      .lineWidth(0.4)
      .strokeColor(C.rule)
      .stroke()
    doc.y = y + height
  })

  doc.moveDown(0.9)
  doc.x = CONTENT_LEFT
}

/** Two-column definition list, used for document control and finding metadata. */
function definitionList(
  ctx: Ctx,
  entries: [string, string][],
  options: { labelWidth?: number } = {},
): void {
  const { doc } = ctx
  const labelWidth = options.labelWidth ?? 120
  for (const [label, value] of entries) {
    doc.font(FONT.sans).fontSize(8.6)
    const height =
      Math.max(
        doc.heightOfString(value || '-', { width: CONTENT_WIDTH - labelWidth - 10, lineGap: 2 }),
        11,
      ) + 7
    need(ctx, height + 4)
    const y = doc.y
    doc
      .font(FONT.sansBold)
      .fontSize(8.6)
      .fillColor(C.muted)
      .text(label, CONTENT_LEFT, y, { width: labelWidth - 8 })
    doc
      .font(FONT.sans)
      .fontSize(8.6)
      .fillColor(C.ink)
      .text(value || '-', CONTENT_LEFT + labelWidth, y, {
        width: CONTENT_WIDTH - labelWidth,
        lineGap: 2,
      })
    doc.y = y + height
    doc
      .moveTo(CONTENT_LEFT, doc.y - 3)
      .lineTo(CONTENT_LEFT + CONTENT_WIDTH, doc.y - 3)
      .lineWidth(0.4)
      .strokeColor(C.rule)
      .stroke()
  }
  doc.moveDown(0.6)
  doc.x = CONTENT_LEFT
}

/** A boxed note — used for scope, authorisation and coverage warnings. */
function calloutBox(ctx: Ctx, title: string, body: string, accent = C.accent): void {
  const { doc } = ctx
  doc.font(FONT.sans).fontSize(8.8)
  const textHeight = doc.heightOfString(body, { width: CONTENT_WIDTH - 34, lineGap: 2.4 })
  const height = textHeight + 34
  need(ctx, height + 8)
  const y = doc.y
  doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, height).fill(C.wash)
  doc.rect(CONTENT_LEFT, y, 3, height).fill(accent)
  doc
    .font(FONT.sansBold)
    .fontSize(8.6)
    .fillColor(accent)
    .text(title.toUpperCase(), CONTENT_LEFT + 16, y + 9, { width: CONTENT_WIDTH - 32 })
  doc
    .font(FONT.sans)
    .fontSize(8.8)
    .fillColor(C.body)
    .text(body, CONTENT_LEFT + 16, y + 22, { width: CONTENT_WIDTH - 34, lineGap: 2.4 })
  doc.y = y + height + 12
  doc.x = CONTENT_LEFT
}

/** Fixed-width evidence block. Raw output is quoted, never paraphrased. */
function evidenceBlock(ctx: Ctx, label: string, value: string): void {
  const { doc } = ctx
  const text = truncate(value, 900)
  doc.font(FONT.mono).fontSize(7.8)
  const textHeight = doc.heightOfString(text, { width: CONTENT_WIDTH - 24, lineGap: 1.8 })
  const height = textHeight + 26
  need(ctx, height + 6)
  const y = doc.y
  doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, height).fillAndStroke(C.washAlt, C.rule)
  doc
    .font(FONT.sansBold)
    .fontSize(6.8)
    .fillColor(C.muted)
    .text(label.toUpperCase(), CONTENT_LEFT + 12, y + 7, { width: CONTENT_WIDTH - 24 })
  doc
    .font(FONT.mono)
    .fontSize(7.8)
    .fillColor(C.ink)
    .text(text, CONTENT_LEFT + 12, y + 17, { width: CONTENT_WIDTH - 24, lineGap: 1.8 })
  doc.y = y + height + 8
  doc.x = CONTENT_LEFT
}

/* ------------------------------------------------------------------ cover */

function coverPage(ctx: Ctx): void {
  const { doc, report } = ctx
  ctx.plain.add(ctx.page)

  /*
   * The cover is the console: a dark screen with scanlines, the score in the
   * brand display face, and the severity split beneath it. It is the one place
   * in the document where the full dark treatment earns its ink, because it is
   * doing the job the CRT does on the site — showing the verdict at a glance.
   */
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(C.console)

  // Scanlines. Very low contrast: texture, not pattern.
  doc.save()
  for (let y = 0; y < PAGE.height; y += 3) {
    doc.rect(0, y, PAGE.width, 1).fillOpacity(0.35).fill('#060B10')
  }
  doc.restore()
  doc.fillOpacity(1)

  // Masthead
  doc
    .font(FONT.display)
    .fontSize(26)
    .fillColor(C.consoleText)
    .text('VulnSight', M.left, 56, { lineBreak: false })
  doc
    .font(FONT.mono)
    .fontSize(7.5)
    .fillColor(C.consoleDim)
    .text('AUTOMATED WEB SECURITY ASSESSMENT', M.left, 88, { characterSpacing: 1.6 })

  doc
    .moveTo(M.left, 108)
    .lineTo(PAGE.width - M.right, 108)
    .lineWidth(0.75)
    .strokeColor(C.consoleRule)
    .stroke()

  // Title and target
  doc
    .font(FONT.sansBold)
    .fontSize(24)
    .fillColor(C.consoleText)
    .text('Security Assessment Report', M.left, 136, { width: CONTENT_WIDTH, lineGap: 2 })
  doc
    .font(FONT.mono)
    .fontSize(13)
    .fillColor(C.accentOnDark)
    .text(report.website.domain, M.left, doc.y + 6, { width: CONTENT_WIDTH })

  /* ---- score panel: the verdict, exactly as the site leads with it ---- */
  const panelY = 240
  const panelH = 112
  doc.rect(M.left, panelY, CONTENT_WIDTH, panelH).fill(C.consoleAlt)
  doc.rect(M.left, panelY, 3, panelH).fill(riskColorOnDark(report.risk.score))

  doc
    .font(FONT.mono)
    .fontSize(7.5)
    .fillColor(C.consoleDim)
    .text('RISK SCORE', M.left + 22, panelY + 20, { characterSpacing: 1.4 })

  // The score uses the mono face: its digits are uniform width, so 50 and 100
  // occupy the same box and the layout never shifts between reports.
  doc
    .font(FONT.monoBold)
    .fontSize(44)
    .fillColor(riskColorOnDark(report.risk.score))
    .text(String(report.risk.score), M.left + 20, panelY + 36, { lineBreak: false })

  const scoreWidth = doc.widthOfString(String(report.risk.score))
  doc
    .font(FONT.mono)
    .fontSize(11)
    .fillColor(C.consoleDim)
    .text('/100', M.left + 24 + scoreWidth, panelY + 62, { lineBreak: false })
  doc
    .font(FONT.monoBold)
    .fontSize(11)
    .fillColor(riskColorOnDark(report.risk.score))
    .text(report.risk.category.toUpperCase(), M.left + 20, panelY + 84, {
      characterSpacing: 1.2,
      lineBreak: false,
    })

  // Right side of the panel: the two numbers that matter most.
  const confirmed = report.vulnerabilities.filter((v) => (v.confirmations?.length ?? 0) > 1).length
  const statX = M.left + CONTENT_WIDTH / 2 + 10
  const stats: [string, string, string][] = [
    ['FINDINGS', String(report.vulnerabilities.length), C.consoleText],
    ['CONFIRMED BY 2+ TOOLS', String(confirmed), confirmed > 0 ? C.accentOnDark : C.consoleDim],
  ]
  stats.forEach(([label, value, color], i) => {
    const y = panelY + 24 + i * 42
    doc
      .font(FONT.mono)
      .fontSize(7.5)
      .fillColor(C.consoleDim)
      .text(label, statX, y, { characterSpacing: 1.2, lineBreak: false })
    doc
      .font(FONT.monoBold)
      .fontSize(20)
      .fillColor(color)
      .text(value, statX, y + 12, { lineBreak: false })
  })

  /* ---- severity split as a single proportional bar ---- */
  const barY = panelY + panelH + 34
  doc
    .font(FONT.mono)
    .fontSize(7.5)
    .fillColor(C.consoleDim)
    .text('FINDINGS BY SEVERITY', M.left, barY, { characterSpacing: 1.4 })

  const total = SEVERITY_ORDER.reduce((sum, s2) => sum + report.severity_distribution[s2], 0)
  let barX = M.left
  const barTop = barY + 18
  if (total > 0) {
    for (const severity of SEVERITY_ORDER) {
      const count = report.severity_distribution[severity]
      if (count === 0) continue
      const w = (count / total) * CONTENT_WIDTH
      doc.rect(barX, barTop, Math.max(w - 1.5, 1.5), 7).fill(severityColorOnDark(severity))
      barX += w
    }
  } else {
    doc.rect(M.left, barTop, CONTENT_WIDTH, 7).fill(C.consoleRule)
  }

  const legendY = barTop + 20
  const cellWidth = CONTENT_WIDTH / 5
  SEVERITY_ORDER.forEach((severity, index) => {
    const count = report.severity_distribution[severity]
    const x = M.left + index * cellWidth
    doc.rect(x, legendY + 2, 7, 7).fill(count > 0 ? severityColorOnDark(severity) : C.consoleRule)
    doc
      .font(FONT.monoBold)
      .fontSize(12)
      .fillColor(count > 0 ? C.consoleText : C.consoleDim)
      .text(String(count), x + 13, legendY, { lineBreak: false })
    doc
      .font(FONT.mono)
      .fontSize(7)
      .fillColor(C.consoleDim)
      .text(SEVERITY_LABEL[severity].toUpperCase(), x + 13, legendY + 15, {
        width: cellWidth - 16,
        characterSpacing: 0.5,
      })
  })

  /* ---- document control ---- */
  const dcY = legendY + 48
  doc
    .font(FONT.mono)
    .fontSize(7.5)
    .fillColor(C.consoleDim)
    .text('DOCUMENT CONTROL', M.left, dcY, { characterSpacing: 1.4 })
  doc
    .moveTo(M.left, dcY + 14)
    .lineTo(PAGE.width - M.right, dcY + 14)
    .lineWidth(0.5)
    .strokeColor(C.consoleRule)
    .stroke()

  const rows: [string, string][] = [
    ['Target', report.metadata.url],
    ['Report reference', report.scan_id.toUpperCase()],
    ['Assessment type', `${titleCase(report.metadata.scan_mode)} automated assessment`],
    ['Date of assessment', formatDate(report.metadata.timestamp)],
    ['Assessment duration', formatDuration(report.metadata.duration_seconds)],
    ['Classification', 'Confidential, for the recipient organisation only'],
  ]
  rows.forEach(([label, value], i) => {
    const y = dcY + 26 + i * 17
    doc
      .font(FONT.mono)
      .fontSize(7.5)
      .fillColor(C.consoleDim)
      .text(label.toUpperCase(), M.left, y, { width: 150, characterSpacing: 0.8, lineBreak: false })
    doc
      .font(FONT.sans)
      .fontSize(8.6)
      .fillColor(C.consoleText)
      .text(truncate(value, 78), M.left + 156, y - 1, {
        width: CONTENT_WIDTH - 156,
        lineBreak: false,
      })
  })

  /* ---- what to do first: the cover should answer this without turning a page ---- */
  const priority = [...report.vulnerabilities]
    .filter((v) => (v.confirmations?.length ?? 0) > 1)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .slice(0, 3)

  if (priority.length > 0) {
    const pY = dcY + 26 + rows.length * 17 + 26
    doc
      .font(FONT.mono)
      .fontSize(7.5)
      .fillColor(C.consoleDim)
      .text('START HERE', M.left, pY, { characterSpacing: 1.4 })
    doc
      .moveTo(M.left, pY + 14)
      .lineTo(PAGE.width - M.right, pY + 14)
      .lineWidth(0.5)
      .strokeColor(C.consoleRule)
      .stroke()
    doc
      .font(FONT.sans)
      .fontSize(8)
      .fillColor(C.consoleDim)
      .text(
        'Seen by more than one scanner, in severity order. Full detail in section 4.',
        M.left,
        pY + 22,
        { width: CONTENT_WIDTH },
      )

    priority.forEach((finding, i) => {
      const y = pY + 44 + i * 24
      const index = report.vulnerabilities.indexOf(finding)
      doc.rect(M.left, y + 1, 2.5, 13).fill(severityColorOnDark(finding.severity))
      doc
        .font(FONT.monoBold)
        .fontSize(8)
        .fillColor(C.consoleDim)
        .text(findingRef(index), M.left + 12, y + 3, { width: 44, lineBreak: false })
      doc
        .font(FONT.sans)
        .fontSize(9)
        .fillColor(C.consoleText)
        .text(truncate(finding.title, 62), M.left + 60, y + 2, {
          width: CONTENT_WIDTH - 60 - 74,
          lineBreak: false,
        })
      doc
        .font(FONT.mono)
        .fontSize(7.5)
        .fillColor(severityColorOnDark(finding.severity))
        .text(`${finding.confirmations?.length ?? 0} TOOLS`, PAGE.width - M.right - 70, y + 4, {
          width: 70,
          align: 'right',
          lineBreak: false,
        })
    })
  }

  /* ---- footer disclaimer ---- */
  doc
    .moveTo(M.left, PAGE.height - 96)
    .lineTo(PAGE.width - M.right, PAGE.height - 96)
    .lineWidth(0.5)
    .strokeColor(C.consoleRule)
    .stroke()
  doc
    .font(FONT.sans)
    .fontSize(7.4)
    .fillColor(C.consoleDim)
    .text(
      'This report contains sensitive information about security weaknesses in the system named above. Handle, store and transmit it accordingly. Testing was automated and non-destructive; it does not replace a manual penetration test, and the absence of a finding is not proof of the absence of a weakness.',
      M.left,
      PAGE.height - 84,
      { width: CONTENT_WIDTH, lineGap: 1.6, height: 62 },
    )
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/* -------------------------------------------------- table of contents page */

/** Reserve the contents page; it is filled in once page numbers are known. */
function reserveTocPage(ctx: Ctx): void {
  newPage(ctx)
  ctx.tocPage = ctx.page
}

function renderToc(ctx: Ctx): void {
  const { doc } = ctx
  doc.switchToPage(ctx.tocPage)
  doc.x = CONTENT_LEFT
  doc.y = M.top

  doc.font(FONT.sansBold).fontSize(16).fillColor(C.ink).text('Contents', CONTENT_LEFT, M.top)
  const ruleY = doc.y + 8
  doc
    .moveTo(CONTENT_LEFT, ruleY)
    .lineTo(PAGE.width - M.right, ruleY)
    .lineWidth(0.75)
    .strokeColor(C.ruleStrong)
    .stroke()

  let y = ruleY + 18
  for (const entry of ctx.toc) {
    const label = `${entry.number}.  ${entry.title}`
    doc.font(FONT.sans).fontSize(9.5).fillColor(C.ink)
    const labelWidth = doc.widthOfString(label)
    doc.text(label, CONTENT_LEFT, y, { lineBreak: false })

    // Human page numbers are 1-based and the cover counts as page 1.
    const pageLabel = String(entry.page + 1)
    doc.font(FONT.sans).fontSize(9.5).fillColor(C.muted)
    const numberWidth = doc.widthOfString(pageLabel)
    doc.text(pageLabel, PAGE.width - M.right - numberWidth, y, { lineBreak: false })

    const dotsStart = CONTENT_LEFT + labelWidth + 6
    const dotsEnd = PAGE.width - M.right - numberWidth - 6
    if (dotsEnd > dotsStart) {
      doc
        .moveTo(dotsStart, y + 7)
        .lineTo(dotsEnd, y + 7)
        .lineWidth(0.5)
        .dash(1, { space: 2.5 })
        .strokeColor(C.ruleStrong)
        .stroke()
        .undash()
    }
    y += 20
  }
}

/* ------------------------------------------------------ report body pieces */

function scopeAndAuthorisation(ctx: Ctx): void {
  const { report } = ctx
  h1(ctx, 'Scope and authorisation')

  para(
    ctx,
    `This report documents an automated, non-destructive security assessment of ${report.metadata.url}, ` +
      `carried out on ${formatDate(report.metadata.timestamp)} and completed in ${formatDuration(
        report.metadata.duration_seconds,
      )}. The assessment examined the target as an unauthenticated, external visitor would see it.`,
  )

  h2(ctx, 'In scope')
  bullets(ctx, [
    `The single host ${report.website.domain}, reached over HTTP(S) at ${report.metadata.url}.`,
    'HTTP response headers, cookie attributes, TLS configuration and certificate validity.',
    'Publicly reachable network services on the host, as identified by a port scan.',
    'Software and version fingerprints disclosed by the target, and public vulnerabilities matching them.',
    'Passive analysis of the rendered page and its resources.',
  ])

  h2(ctx, 'Out of scope')
  bullets(ctx, [
    'Authenticated functionality, business logic, and anything behind a login.',
    'Exploitation, payload delivery, password attacks, and denial-of-service testing.',
    'Source code, infrastructure configuration, and internal networks.',
    'Third-party services the target depends on but does not control.',
  ])

  h2(ctx, 'Authorisation and conduct')
  calloutBox(
    ctx,
    'Authorisation statement',
    'This assessment was requested for the target named above. Only non-destructive, read-only checks were ' +
      'performed: no exploitation was attempted, no data was modified or exfiltrated, and no denial-of-service ' +
      'condition was induced. Scanning a system without the owner\u2019s permission is unlawful in most ' +
      'jurisdictions; the requester is responsible for holding that permission.',
  )
}

function executiveSummary(ctx: Ctx): void {
  const { doc, report } = ctx
  h1(ctx, 'Executive summary')

  const distribution = report.severity_distribution
  const actionable = distribution.critical + distribution.high + distribution.medium
  const confirmed = report.vulnerabilities.filter((v) => v.confidence === 'confirmed').length

  // A single risk panel: the number, the wording, and the arithmetic behind it.
  need(ctx, 130)
  const y = doc.y
  const panelHeight = 96
  doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, panelHeight).fillAndStroke(C.wash, C.rule)
  doc.rect(CONTENT_LEFT, y, 3, panelHeight).fill(riskColor(report.risk.category))

  doc
    .font(FONT.sans)
    .fontSize(7.6)
    .fillColor(C.muted)
    .text('OVERALL RISK RATING', CONTENT_LEFT + 18, y + 14, { characterSpacing: 1.1 })
  doc
    .font(FONT.sansBold)
    .fontSize(30)
    .fillColor(riskColor(report.risk.category))
    .text(`${report.risk.score}`, CONTENT_LEFT + 18, y + 28, { lineBreak: false })
  doc
    .font(FONT.sans)
    .fontSize(11)
    .fillColor(C.muted)
    .text('/100', CONTENT_LEFT + 18 + doc.widthOfString(`${report.risk.score}`) + 42, y + 48, {
      lineBreak: false,
    })
  doc
    .font(FONT.sansBold)
    .fontSize(11)
    .fillColor(C.ink)
    .text(report.risk.category, CONTENT_LEFT + 18, y + 66, { lineBreak: false })

  const statsX = CONTENT_LEFT + 180
  const stats: [string, string][] = [
    ['Findings', String(report.vulnerabilities.length)],
    ['Needing action', String(actionable)],
    ['Multi-tool confirmed', String(confirmed)],
    ['Known CVEs', String(report.cves.length)],
  ]
  stats.forEach(([label, value], index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const x = statsX + col * ((CONTENT_WIDTH - 200) / 2)
    const sy = y + 18 + row * 38
    doc.font(FONT.sansBold).fontSize(17).fillColor(C.ink).text(value, x, sy, { lineBreak: false })
    doc
      .font(FONT.sans)
      .fontSize(7.6)
      .fillColor(C.muted)
      .text(label.toUpperCase(), x, sy + 21, { characterSpacing: 0.8, lineBreak: false })
  })
  doc.y = y + panelHeight + 16
  doc.x = CONTENT_LEFT

  h2(ctx, 'What we found')
  para(
    ctx,
    report.ai.executive_summary?.trim() ||
      `The assessment recorded ${report.vulnerabilities.length} finding(s) against ${report.website.domain}. ` +
        `${actionable} of them warrant remediation work; the remainder are hardening opportunities and observations.`,
  )

  if (report.ai.key_risks?.length) {
    h2(ctx, 'Principal risks')
    bullets(ctx, report.ai.key_risks.slice(0, 6))
  }

  h2(ctx, 'Severity profile')
  severityChart(ctx)
  para(
    ctx,
    'Severity is assigned by deterministic rules from the observed evidence and is reproducible: the same ' +
      'evidence always yields the same rating. It is never adjusted by a language model.',
    { size: 8.4, color: C.muted },
  )

  h2(ctx, 'How the score was calculated')
  para(
    ctx,
    'The score starts at 100 and deductions are applied for each finding, weighted by severity. Every ' +
      'deduction is listed below so the number can be checked rather than taken on trust.',
  )
  table(
    ctx,
    [
      { label: 'Deduction', width: CONTENT_WIDTH - 90 },
      { label: 'Points', width: 90, align: 'right' },
    ],
    [
      ...report.risk.penalties.map((penalty) => [
        penalty.label,
        // A hyphen-minus, not U+2212: the standard PDF fonts have no glyph for
        // the typographic minus and silently substitute a stray quote mark.
        { text: `-${penalty.points}`, color: C.high },
      ]),
      [
        { text: 'Final score', bold: true },
        { text: `${report.risk.score}/100`, bold: true, color: C.ink },
      ],
    ],
  )
}

function riskColor(category: string): string {
  if (category === 'Critical') return C.critical
  if (category === 'High') return C.high
  if (category === 'Moderate') return C.medium
  return C.low
}

/** Horizontal severity distribution chart with counts. */
function severityChart(ctx: Ctx): void {
  const { doc, report } = ctx
  const rows = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: report.severity_distribution[severity],
  }))
  const max = Math.max(1, ...rows.map((row) => row.count))

  need(ctx, rows.length * 22 + 12)
  const labelWidth = 92
  const numberWidth = 26
  const trackWidth = CONTENT_WIDTH - labelWidth - numberWidth

  for (const row of rows) {
    const y = doc.y
    doc
      .font(FONT.sans)
      .fontSize(8.4)
      .fillColor(C.body)
      .text(SEVERITY_LABEL[row.severity], CONTENT_LEFT, y + 2, {
        width: labelWidth - 8,
        lineBreak: false,
      })
    doc.rect(CONTENT_LEFT + labelWidth, y + 2, trackWidth, 10).fill(C.washAlt)
    if (row.count > 0) {
      const width = Math.max(3, (row.count / max) * trackWidth)
      doc.rect(CONTENT_LEFT + labelWidth, y + 2, width, 10).fill(severityColor(row.severity))
    }
    doc
      .font(FONT.sansBold)
      .fontSize(8.4)
      .fillColor(row.count > 0 ? C.ink : C.faint)
      .text(String(row.count), CONTENT_LEFT + labelWidth + trackWidth + 8, y + 2, {
        width: numberWidth - 8,
        align: 'right',
        lineBreak: false,
      })
    doc.y = y + 18
  }
  doc.moveDown(0.7)
  doc.x = CONTENT_LEFT
}

function findingsRegister(ctx: Ctx): void {
  const { report } = ctx
  h1(ctx, 'Findings register')

  if (report.vulnerabilities.length === 0) {
    para(
      ctx,
      'No findings were recorded. This means the automated checks that ran did not observe a weakness. ' +
        'it does not mean the target is free of weaknesses. Review the coverage section before drawing conclusions.',
    )
    return
  }

  para(
    ctx,
    'Every finding in this assessment, in severity order. The retest column is left blank for the ' +
      'receiving team to record verification once remediation is complete.',
  )

  table(
    ctx,
    [
      // 52pt, not 44: the mono face is wider than Helvetica, and "VS-001"
      // needs 29.5pt plus 8pt padding either side. At 44 it wrapped to two
      // lines and rendered as "VS-00 / 1".
      { label: 'Ref', width: 52, mono: true },
      { label: 'Finding', width: CONTENT_WIDTH - 52 - 62 - 68 - 66 },
      { label: 'Severity', width: 62 },
      { label: 'Confidence', width: 68 },
      { label: 'Retest', width: 66, blankable: true },
    ],
    report.vulnerabilities.map((finding, index) => [
      { text: findingRef(index), bold: true },
      finding.title,
      {
        // SEVERITY_SHORT, not the full label: "Informational" is 50.8pt in a
        // 46pt column and wrapped to "Information / al".
        text: SEVERITY_SHORT[finding.severity],
        color: severityColor(finding.severity),
        bold: true,
      },
      CONFIDENCE_LABEL[finding.confidence ?? 'probable'] ?? 'Probable',
      '',
    ]),
  )
}

function detailedFindings(ctx: Ctx): void {
  const { report } = ctx
  h1(ctx, 'Detailed findings')

  if (report.vulnerabilities.length === 0) {
    para(ctx, 'No findings to detail.')
    return
  }

  para(
    ctx,
    'Each finding below records what was observed, why it matters, the raw evidence supporting it, and ' +
      'what to do about it. Evidence is quoted exactly as the tool reported it.',
  )

  report.vulnerabilities.forEach((finding, index) => {
    detailedFinding(ctx, finding, index)
  })
}

function detailedFinding(ctx: Ctx, finding: Vulnerability, index: number): void {
  const { doc } = ctx

  // Keep the title, chips and metadata table together at minimum.
  if (doc.y > CONTENT_BOTTOM - 190) newPage(ctx)

  ctx.sub += 1
  const ref = findingRef(index)
  const color = severityColor(finding.severity)

  doc.moveDown(0.4)
  const y = doc.y
  doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, 26).fill(C.washAlt)
  doc.rect(CONTENT_LEFT, y, 3, 26).fill(color)
  doc
    .font(FONT.sansBold)
    .fontSize(10.5)
    .fillColor(C.ink)
    .text(`${ctx.section}.${ctx.sub}  ${ref}  ${finding.title}`, CONTENT_LEFT + 14, y + 7.5, {
      width: CONTENT_WIDTH - 28,
      lineBreak: false,
      ellipsis: true,
    })
  doc.y = y + 34
  doc.x = CONTENT_LEFT

  // Chips: severity first, then supporting context.
  const chipY = doc.y
  let chipX = CONTENT_LEFT
  chipX += chip(doc, SEVERITY_LABEL[finding.severity], chipX, chipY, color) + 6
  const confidence = finding.confidence ?? 'probable'
  chipX += chipOutline(doc, CONFIDENCE_LABEL[confidence] ?? confidence, chipX, chipY) + 6
  const confirmations = finding.confirmations?.length ?? 0
  if (confirmations > 1) {
    chipX += chipOutline(doc, `${confirmations} tools agree`, chipX, chipY) + 6
  }
  if (finding.cve_id) chipX += chipOutline(doc, finding.cve_id, chipX, chipY) + 6
  if (finding.cwe_id) chipOutline(doc, finding.cwe_id, chipX, chipY)
  doc.y = chipY + 22
  doc.x = CONTENT_LEFT

  const sources = finding.confirmations?.length
    ? [...new Set(finding.confirmations.map((c) => c.source))].join(', ')
    : finding.source

  definitionList(
    ctx,
    [
      [
        'Severity',
        `${SEVERITY_LABEL[finding.severity]}${finding.cvss_score !== null ? `, CVSS ${finding.cvss_score.toFixed(1)}` : ''}`,
      ],
      [
        'Confidence',
        `${CONFIDENCE_LABEL[confidence] ?? confidence}. ${CONFIDENCE_DEFINITION[confidence] ?? ''}`,
      ],
      ['Detected by', sources],
      ['Affected asset', finding.location ?? ctx.report.website.domain],
      ...(finding.owasp_category
        ? ([['OWASP', finding.owasp_category]] as [string, string][])
        : []),
      ...(finding.correlation_key
        ? ([['Correlation key', finding.correlation_key]] as [string, string][])
        : []),
    ],
    { labelWidth: 104 },
  )

  labelledPara(ctx, 'Description', finding.description)
  labelledPara(ctx, 'Impact', finding.impact)

  if (finding.evidence) {
    evidenceBlock(ctx, 'Observed evidence', finding.evidence)
  }

  // Independent corroboration is the most valuable thing in the report; show it.
  if (finding.confirmations && finding.confirmations.length > 1) {
    labelledPara(
      ctx,
      'Independent observations',
      'This finding was reported by more than one tool. Each observation is listed below with the wording that tool used.',
    )
    table(
      ctx,
      [
        { label: 'Tool', width: 96 },
        { label: 'Reported as', width: CONTENT_WIDTH - 96 - 150 },
        { label: 'Seen at', width: 150 },
      ],
      finding.confirmations.map((c) => [
        c.source,
        truncate(c.raw_title, 110),
        truncate(c.location ?? '-', 60),
      ]),
    )
  }

  labelledPara(ctx, 'Remediation', finding.recommendation)

  if (finding.references.length) {
    labelledPara(ctx, 'References', '')
    bullets(
      ctx,
      finding.references.slice(0, 6).map((reference) => reference),
    )
  }

  // Retest strip: the report is a working document, not a one-way artefact.
  need(ctx, 34)
  const retestY = doc.y
  doc.rect(CONTENT_LEFT, retestY, CONTENT_WIDTH, 24).fillAndStroke(C.white, C.rule)
  doc
    .font(FONT.sansBold)
    .fontSize(7)
    .fillColor(C.muted)
    .text('RETEST', CONTENT_LEFT + 12, retestY + 9, { lineBreak: false })
  const cellW = (CONTENT_WIDTH - 70) / 3
  ;['Fixed by', 'Date', 'Verified by'].forEach((label, i) => {
    const x = CONTENT_LEFT + 70 + i * cellW
    doc
      .font(FONT.sans)
      .fontSize(7)
      .fillColor(C.faint)
      .text(label, x, retestY + 9, { width: cellW - 10, lineBreak: false })
    doc
      .moveTo(x + doc.widthOfString(label) + 6, retestY + 17)
      .lineTo(x + cellW - 14, retestY + 17)
      .lineWidth(0.5)
      .strokeColor(C.rule)
      .stroke()
  })
  doc.y = retestY + 34
  doc.x = CONTENT_LEFT
}

function labelledPara(ctx: Ctx, label: string, text: string): void {
  const { doc } = ctx
  need(ctx, 30)
  doc
    .font(FONT.sansBold)
    .fontSize(8)
    .fillColor(C.accentDark)
    .text(label.toUpperCase(), CONTENT_LEFT, doc.y, { characterSpacing: 0.8 })
  doc.moveDown(0.25)
  if (text.trim()) para(ctx, text, { size: 9 })
  doc.x = CONTENT_LEFT
}

function remediationPlan(ctx: Ctx): void {
  const { report } = ctx
  const roadmap = report.ai.remediation
  const hasPlan =
    roadmap &&
    (roadmap.immediate.length > 0 || roadmap.short_term.length > 0 || roadmap.long_term.length > 0)
  if (!hasPlan && !report.ai.recommendations?.length) return

  h1(ctx, 'Remediation plan')
  para(
    ctx,
    'Recommended work, ordered by urgency. Sequencing reflects exposure and effort: the immediate items ' +
      'close the largest gaps for the least work.',
  )

  const groups: [string, string, string[]][] = [
    ['Immediate', 'Within 7 days', roadmap?.immediate ?? []],
    ['Short term', 'Within 30 days', roadmap?.short_term ?? []],
    ['Longer term', 'Next quarter', roadmap?.long_term ?? []],
  ]

  for (const [title, timeframe, items] of groups) {
    if (!items.length) continue
    h2(ctx, `${title} (${timeframe.toLowerCase()})`)
    bullets(ctx, items)
  }

  if (!hasPlan && report.ai.recommendations?.length) {
    h2(ctx, 'Recommended actions')
    bullets(ctx, report.ai.recommendations)
  }
}

function vulnerableComponents(ctx: Ctx, cves: CveEntry[]): void {
  if (!cves.length) return
  h1(ctx, 'Known vulnerable components')
  para(
    ctx,
    'Public vulnerabilities matching software versions the target disclosed. A match means the disclosed ' +
      'version falls in the affected range; it is not proof that the specific instance is exploitable, ' +
      'because back-ported vendor patches often leave the version string unchanged.',
  )

  table(
    ctx,
    [
      { label: 'CVE', width: 92, mono: true },
      { label: 'CVSS', width: 44, align: 'right' },
      { label: 'Component', width: 118 },
      { label: 'Summary', width: CONTENT_WIDTH - 92 - 44 - 118 },
    ],
    cves.map((cve) => [
      { text: cve.cve_id, bold: true },
      { text: cve.cvss_score.toFixed(1), color: severityColor(cve.severity), bold: true },
      truncate(cve.affected_component, 40),
      truncate(cve.description, 240),
    ]),
  )
}

function assetInventory(ctx: Ctx): void {
  const { report } = ctx
  h1(ctx, 'Asset and configuration inventory')
  para(
    ctx,
    'The observable attack surface, recorded as fact. Nothing in this section is a finding on its own; ' +
      'it is the ground truth the findings were derived from.',
  )

  h2(ctx, 'Host')
  definitionList(ctx, [
    ['Domain', report.website.domain],
    ['IP address', report.website.ip_address || 'Not resolved'],
    ['Server banner', report.website.server || 'Not disclosed'],
    ['Page title', report.website.title || 'Not collected'],
  ])

  ports(ctx, report.open_ports)
  reachability(ctx, report.reachability ?? [])
  technologies(ctx)
  securityHeaders(ctx, report.security_headers)
  tlsSection(ctx)
}

function ports(ctx: Ctx, list: OpenPort[]): void {
  h2(ctx, 'Network services')
  if (!list.length) {
    para(
      ctx,
      'No open ports were confirmed, or the port scan did not run. See section on coverage.',
    )
    return
  }
  table(
    ctx,
    [
      // 70pt: the mono face renders "31337/tcp" at 44.3pt, and 58 left only 42.
      { label: 'Port', width: 70, mono: true },
      { label: 'Service', width: 104 },
      { label: 'Product and version', width: CONTENT_WIDTH - 70 - 104 - 62 },
      { label: 'Risk', width: 62 },
    ],
    list.map((port) => [
      { text: `${port.port}/${port.protocol}`, bold: true },
      port.service || 'unknown',
      truncate([port.product, port.version, port.extrainfo].filter(Boolean).join(' ') || '-', 90),
      { text: SEVERITY_SHORT[port.risk], color: severityColor(port.risk) },
    ]),
  )
}

function reachability(ctx: Ctx, list: OpenPort[]): void {
  if (!list.length) return
  h2(ctx, 'Web port reachability')
  para(
    ctx,
    'Connectivity facts for the standard web ports, recorded separately from open services so a closed ' +
      'or filtered port is never presented as an exposed one.',
    { size: 8.6, color: C.muted },
  )
  table(
    ctx,
    [
      { label: 'Port', width: 70, mono: true },
      { label: 'State', width: 90 },
      { label: 'Observation', width: CONTENT_WIDTH - 160 },
    ],
    list.map((port) => [
      { text: `${port.port}/${port.protocol}`, bold: true },
      port.state,
      truncate(port.evidence ?? port.service ?? '-', 120),
    ]),
  )
}

function technologies(ctx: Ctx): void {
  const list = ctx.report.technologies
  if (!list.length) return
  h2(ctx, 'Technology fingerprints')
  table(
    ctx,
    [
      { label: 'Technology', width: 122 },
      // Version strings can be long ("6.6.1p1 Ubuntu 2ubuntu2.13"); they are
      // truncated below rather than allowed to wrap the row.
      { label: 'Version', width: 118, mono: true },
      { label: 'Category', width: 92 },
      { label: 'Evidence source', width: CONTENT_WIDTH - 332 },
    ],
    list.map((tech) => [
      { text: tech.name, bold: true },
      truncate(tech.version ?? '-', 22),
      tech.category,
      truncate(tech.source ?? tech.evidence ?? '-', 60),
    ]),
  )
}

function securityHeaders(ctx: Ctx, headers: SecurityHeader[]): void {
  if (!headers.length) return
  h2(ctx, 'Security response headers')
  table(
    ctx,
    [
      { label: 'Header', width: 150 },
      { label: 'Present', width: 58 },
      { label: 'Value', width: CONTENT_WIDTH - 208 },
    ],
    headers.map((header) => [
      { text: header.name, bold: true },
      {
        text: header.present ? 'Yes' : 'No',
        color: header.present ? C.low : C.high,
        bold: true,
      },
      truncate(header.value ?? header.recommendation, 150),
    ]),
  )
}

function tlsSection(ctx: Ctx): void {
  const ssl = ctx.report.ssl
  h2(ctx, 'Transport layer security')
  if (ssl.available === false) {
    para(
      ctx,
      'Certificate details were not collected, so no claim is made about the TLS configuration. This is ' +
        'not the same as finding it invalid.',
    )
    return
  }
  definitionList(ctx, [
    ['Certificate valid', ssl.valid ? 'Yes' : 'No'],
    ['Issuer', ssl.issuer],
    ['Subject', ssl.subject],
    ['Expires', `${ssl.expires} (${ssl.days_remaining} days remaining)`],
    ['Negotiated protocol', ssl.tls_version],
    ['Configuration grade', ssl.grade],
  ])
}

function methodology(ctx: Ctx): void {
  const { report } = ctx
  h1(ctx, 'Methodology and tooling')

  para(
    ctx,
    'The assessment runs a fixed pipeline. Each stage contributes evidence; nothing is asserted without a ' +
      'source. Where several tools observe the same weakness, the observations are correlated into one ' +
      'finding rather than repeated, and the agreement is recorded as confidence.',
  )

  h2(ctx, 'Assessment stages')
  bullets(ctx, [
    'Target validation: hostname resolution and safety checks that prevent scanning internal or reserved address space.',
    'HTTP and TLS probing: headers, cookies, redirect chain, certificate chain and negotiated protocol.',
    'Rendered-page analysis: the page is loaded in a real browser so client-side behaviour and resources are visible.',
    'Network service discovery: port scan and service/version detection.',
    'Template scanning: a signature engine tests for known misconfigurations and exposures.',
    'Passive web scanning: a proxy-based scanner reviews traffic without attacking the target.',
    'Vulnerability enrichment: disclosed versions are matched against the National Vulnerability Database.',
    'Correlation and scoring: observations are grouped deterministically, then severity and risk are computed by fixed rules.',
  ])

  h2(ctx, 'Tools used and what each produced')
  table(
    ctx,
    [
      { label: 'Tool', width: 96 },
      { label: 'Status', width: 66 },
      { label: 'Outcome', width: CONTENT_WIDTH - 162 },
    ],
    toolRows(report).map(([name, outcome, status]) => [
      { text: name, bold: true },
      { text: TOOL_STATUS_LABEL[status], color: TOOL_STATUS_COLOR[status], bold: true },
      truncate(outcome, 220),
    ]),
  )

  const commands: [string, string][] = []
  if (report.evidence?.nmap?.command) commands.push(['Nmap', report.evidence.nmap.command])
  if (report.evidence?.nuclei?.command) commands.push(['Nuclei', report.evidence.nuclei.command])
  if (report.evidence?.zap?.api_url) commands.push(['ZAP API', report.evidence.zap.api_url])
  if (commands.length) {
    h2(ctx, 'Exact commands executed')
    para(ctx, 'Recorded verbatim so the assessment can be reproduced independently.', {
      size: 8.6,
      color: C.muted,
    })
    for (const [name, command] of commands) evidenceBlock(ctx, name, command)
  }

  h2(ctx, 'How severity and confidence are decided')
  para(
    ctx,
    'Severity comes from deterministic rules applied to the observed evidence, so it is reproducible and ' +
      'explainable. Language models are used only to summarise and explain findings in plain English. They ' +
      'never set, raise or lower a severity, and never create a finding.',
  )
  table(
    ctx,
    [
      { label: 'Confidence', width: 100 },
      { label: 'Meaning', width: CONTENT_WIDTH - 100 },
    ],
    (['confirmed', 'probable', 'observed'] as const).map((level) => [
      { text: CONFIDENCE_LABEL[level], bold: true },
      CONFIDENCE_DEFINITION[level],
    ]),
    { zebra: true },
  )
}

/** Execution outcome of a tool: it ran, ran partially, failed, or never ran. */
type ToolStatus = 'ran' | 'partial' | 'unavailable' | 'not-run'

function toolRows(report: ScanReport): [string, string, ToolStatus][] {
  return [
    [
      'Browser (Playwright)',
      report.evidence?.browser?.available
        ? 'Rendered the page and captured screenshot and DOM evidence.'
        : (report.evidence?.browser?.reason ?? 'Not collected'),
      toolStatus(report.evidence?.browser?.available),
    ],
    [
      'Nmap',
      report.evidence?.nmap?.available
        ? `${report.evidence.nmap.ports.length} open port(s) confirmed from the scan output.`
        : (report.evidence?.nmap?.reason ?? 'Not run'),
      toolStatus(report.evidence?.nmap?.available),
    ],
    [
      'Nuclei',
      report.evidence?.nuclei?.available
        ? `${report.evidence.nuclei.results.length} template result(s)${
            report.evidence.nuclei.truncated ? ' (run stopped early, coverage partial)' : ''
          }.`
        : (report.evidence?.nuclei?.reason ?? 'Not run'),
      report.evidence?.nuclei?.available && report.evidence.nuclei.truncated
        ? 'partial'
        : toolStatus(report.evidence?.nuclei?.available),
    ],
    [
      'OWASP ZAP',
      report.evidence?.zap?.available
        ? `${report.evidence.zap.alerts.length} passive alert(s).`
        : (report.evidence?.zap?.reason ?? 'Not run'),
      toolStatus(report.evidence?.zap?.available),
    ],
    [
      'NVD',
      report.evidence?.cve?.available
        ? `${report.evidence.cve.cves.length} matching CVE(s) across ${report.evidence.cve.queried_components.length} queried component(s).`
        : (report.evidence?.cve?.reason ?? 'Not run'),
      toolStatus(report.evidence?.cve?.available),
    ],
    [
      'AI narrative',
      report.ai.available
        ? `Summaries generated by ${report.ai.generated_by}. Severity untouched.`
        : (report.evidence?.ai?.reason ?? 'Deterministic summary used.'),
      report.ai.available ? 'ran' : 'not-run',
    ],
  ]
}

function toolStatus(available: boolean | undefined): ToolStatus {
  if (available === true) return 'ran'
  if (available === false) return 'unavailable'
  return 'not-run'
}

const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  ran: 'Ran',
  partial: 'Partial',
  unavailable: 'Unavailable',
  'not-run': 'Not run',
}

const TOOL_STATUS_COLOR: Record<ToolStatus, string> = {
  ran: C.low,
  partial: C.medium,
  unavailable: C.medium,
  'not-run': C.faint,
}

function coverage(ctx: Ctx): void {
  const { report } = ctx
  h1(ctx, 'Coverage and limitations')

  calloutBox(
    ctx,
    'Read this before acting on the report',
    'Absence of a finding is not evidence of security. This was an automated, unauthenticated, ' +
      'non-destructive assessment. It cannot find business-logic flaws, access-control mistakes, or anything ' +
      'reachable only after login, and it does not attempt exploitation. Treat it as a strong baseline, not ' +
      'as a substitute for a manual penetration test.',
    C.medium,
  )

  if (report.notes?.length) {
    h2(ctx, 'Checks that did not run or did not finish')
    table(
      ctx,
      [
        { label: 'Stage', width: 170 },
        { label: 'Status', width: 78 },
        { label: 'Reason', width: CONTENT_WIDTH - 248 },
      ],
      report.notes.map((note) => [
        { text: note.stage, bold: true },
        {
          text:
            note.status === 'partial'
              ? 'Partial'
              : note.status === 'failed'
                ? 'Failed'
                : note.status === 'skipped'
                  ? 'Not run'
                  : 'Unavailable',
          color: note.status === 'partial' ? C.medium : C.muted,
        },
        truncate(note.detail, 220),
      ]),
    )
  } else {
    h2(ctx, 'Checks that did not run')
    para(ctx, 'Every stage in the pipeline ran and produced data.')
  }

  h2(ctx, 'Standing limitations')
  bullets(ctx, [
    'Version-based CVE matching can over-report: vendors frequently back-port fixes without changing the version string.',
    'Passive scanning observes what the site chooses to reveal; a weakness behind authentication or a rate limiter is invisible to it.',
    'A point-in-time scan reflects the configuration at the moment of testing. Re-test after any deployment.',
  ])
}

function appendix(ctx: Ctx): void {
  const { report } = ctx
  h1(ctx, 'Appendix')

  h2(ctx, 'Severity definitions')
  table(
    ctx,
    [
      { label: 'Rating', width: 92 },
      { label: 'Definition and expected response', width: CONTENT_WIDTH - 92 },
    ],
    SEVERITY_ORDER.map((severity) => [
      { text: SEVERITY_LABEL[severity], color: severityColor(severity), bold: true },
      SEVERITY_DEFINITION[severity],
    ]),
  )

  if (report.owasp_mapping?.length) {
    h2(ctx, 'OWASP Top 10 coverage')
    table(
      ctx,
      [
        { label: 'Category', width: 80, mono: true },
        { label: 'Name', width: CONTENT_WIDTH - 80 - 70 },
        { label: 'Findings', width: 70, align: 'right' },
      ],
      report.owasp_mapping.map((entry) => [
        { text: entry.id, bold: true },
        entry.name,
        { text: String(entry.count), bold: true },
      ]),
    )
  }

  screenshotAppendix(ctx)

  h2(ctx, 'Disclaimer')
  para(
    ctx,
    'This report is provided for the recipient organisation on an as-is basis. It records what automated ' +
      'tooling observed at a single point in time. VulnSight accepts no liability for actions taken, or not ' +
      'taken, on the basis of this document, and makes no warranty that the target is free of weaknesses ' +
      'not listed here.',
    { size: 8.4, color: C.muted },
  )
}

function screenshotAppendix(ctx: Ctx): void {
  const { doc, report } = ctx
  const screenshot = report.website.screenshot
  if (!screenshot) return

  h2(ctx, 'Rendered page capture')
  para(
    ctx,
    'The target as rendered in a real browser at the time of testing, retained as evidence of the state assessed.',
    { size: 8.6, color: C.muted },
  )

  const boxHeight = 300
  need(ctx, boxHeight + 12)
  const y = doc.y
  doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, boxHeight).fillAndStroke(C.washAlt, C.rule)
  try {
    doc.image(screenshot, CONTENT_LEFT + 10, y + 10, {
      fit: [CONTENT_WIDTH - 20, boxHeight - 20],
      align: 'center',
      valign: 'center',
    })
  } catch (error) {
    const reason = error instanceof Error && error.message ? ` (${error.message})` : ''
    doc
      .font(FONT.sans)
      .fontSize(8.6)
      .fillColor(C.muted)
      .text(
        `A screenshot was captured but could not be embedded in this document${reason}.`,
        CONTENT_LEFT + 20,
        y + boxHeight / 2 - 8,
        { width: CONTENT_WIDTH - 40, align: 'center' },
      )
  }
  doc.y = y + boxHeight + 14
  doc.x = CONTENT_LEFT
}

/* ---------------------------------------------------------------- footers */

/**
 * Footers are painted last because they carry the total page count, which is
 * unknown until the body is finished.
 */
function paintFooters(ctx: Ctx): void {
  const { doc, report } = ctx
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(i)
    if (ctx.plain.has(i)) continue

    const y = PAGE.height - 44
    doc
      .moveTo(CONTENT_LEFT, y)
      .lineTo(PAGE.width - M.right, y)
      .lineWidth(0.5)
      .strokeColor(C.rule)
      .stroke()
    outsideFlow(doc, () => {
      doc
        .font(FONT.sans)
        .fontSize(6.8)
        .fillColor(C.faint)
        .text('CONFIDENTIAL', CONTENT_LEFT, y + 8, {
          width: CONTENT_WIDTH / 3,
          characterSpacing: 0.8,
          lineBreak: false,
        })
      doc
        .font(FONT.sans)
        .fontSize(6.8)
        .fillColor(C.faint)
        .text(report.scan_id.toUpperCase(), CONTENT_LEFT + CONTENT_WIDTH / 3, y + 8, {
          width: CONTENT_WIDTH / 3,
          align: 'center',
          lineBreak: false,
        })
      doc
        .font(FONT.sans)
        .fontSize(6.8)
        .fillColor(C.muted)
        .text(`Page ${i + 1} of ${range.count}`, CONTENT_LEFT + (CONTENT_WIDTH * 2) / 3, y + 8, {
          width: CONTENT_WIDTH / 3,
          align: 'right',
          lineBreak: false,
        })
    })
  }
}

/* ------------------------------------------------------------------ entry */

export async function generateReportPdf(report: ScanReport): Promise<Buffer> {
  const doc: PdfDoc = new PDFDocument({
    size: 'A4',
    bufferPages: true,
    margins: { top: M.top, bottom: M.bottom, left: M.left, right: M.right },
    info: {
      Title: `Security Assessment Report: ${report.website.domain}`,
      Author: 'VulnSight',
      Subject: `Automated web security assessment of ${report.metadata.url}`,
      Keywords: 'security, assessment, vulnerability, report, vulnsight',
      CreationDate: new Date(report.metadata.timestamp),
    },
  })

  // Brand faces must be registered before anything is written.
  loadFonts(doc)

  // Attach the collector before anything is written: PDFKit streams data as
  // it is produced, so a listener added later would miss the earliest chunks.
  const done = collect(doc)

  const ctx: Ctx = {
    doc,
    report,
    page: 0,
    plain: new Set<number>(),
    tocPage: 1,
    toc: [],
    section: 0,
    sub: 0,
  }

  /*
   * Track the page cursor ourselves. PDFKit exposes no reliable "current page
   * index" during flow layout, and the table of contents needs one.
   */
  doc.on('pageAdded', () => {
    ctx.page += 1
    // Lay the page tint down first so everything else paints on top of it.
    paintPageBackground(doc)
    if (!ctx.plain.has(ctx.page)) runningHeader(ctx)
  })

  // The first page exists before any 'pageAdded' fires, so tint it directly.
  paintPageBackground(doc)

  coverPage(ctx)

  // The contents page must be reserved before its header is painted, so it is
  // marked plain up front rather than after the fact.
  ctx.plain.add(1)
  reserveTocPage(ctx)

  newPage(ctx)
  scopeAndAuthorisation(ctx)
  executiveSummary(ctx)
  findingsRegister(ctx)
  detailedFindings(ctx)
  remediationPlan(ctx)
  vulnerableComponents(ctx, report.cves)
  assetInventory(ctx)
  methodology(ctx)
  coverage(ctx)
  appendix(ctx)

  renderToc(ctx)
  paintFooters(ctx)

  doc.end()
  return done
}
