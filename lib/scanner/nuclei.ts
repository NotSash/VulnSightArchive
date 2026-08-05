import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { commandLine, findBinary, runCommand } from '@/lib/scanner/tools'
import type { NucleiEvidence, NucleiResultEvidence, Severity } from '@/types/report'

function severity(value: unknown): Severity {
  const raw = String(value ?? 'info').toLowerCase()
  if (raw === 'critical' || raw === 'high' || raw === 'medium' || raw === 'low') return raw
  return 'info'
}

function asStringArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(asStringArray)
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeCve(value: string): string | null {
  const match = value.toUpperCase().match(/CVE-\d{4}-\d{4,}/)
  return match?.[0] ?? null
}

function normalizeCwe(value: string): string | null {
  const match = value.toUpperCase().match(/CWE-\d+/)
  return match?.[0] ?? null
}

function findTemplatePath(): string | null {
  const configured = process.env.NUCLEI_TEMPLATES?.trim()
  if (configured) return configured

  const candidates = [
    `${homedir()}/nuclei-templates`,
    `${homedir()}/.local/nuclei-templates`,
    `${homedir()}/.config/nuclei/templates`,
    `${process.cwd()}/nuclei-templates`,
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Parse one line of Nuclei JSONL output into a normalized result.
 *
 * Returns `null` for lines that are not valid JSON — Nuclei can interleave
 * diagnostics with results, and a malformed line must never abort the scan.
 * Exported so the parsing contract can be tested against captured output.
 */
export function parseNucleiLine(line: string): NucleiResultEvidence | null {
  let data: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(line)
    /*
     * `JSON.parse('null')` succeeds and returns null, so the catch never
     * fires and the field reads below threw a TypeError. Nuclei emitting one
     * malformed line then aborted the whole scan. Arrays are rejected for the
     * same reason: they parse cleanly but have none of the expected fields.
     * See AUDIT C2.
     */
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    data = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const info = (data.info ?? {}) as Record<string, unknown>
  const classification = (info.classification ?? {}) as Record<string, unknown>
  const templateId = String(data['template-id'] ?? data.templateID ?? 'unknown-template')
  const tags = asStringArray(info.tags)
  const cveIds = new Set<string>()
  const cweIds = new Set<string>()

  for (const raw of [
    ...asStringArray(classification['cve-id']),
    ...asStringArray(classification.cve_id),
    templateId,
    ...tags,
  ]) {
    const cve = normalizeCve(raw)
    if (cve) cveIds.add(cve)
  }

  for (const raw of [
    ...asStringArray(classification['cwe-id']),
    ...asStringArray(classification.cwe_id),
    ...tags,
  ]) {
    const cwe = normalizeCwe(raw)
    if (cwe) cweIds.add(cwe)
  }

  const extracted = asStringArray(data['extracted-results']).join('; ')
  const matcher = asStringArray(data['matcher-name']).join(', ')
  const evidence = extracted || matcher || String(data['curl-command'] ?? '') || null

  return {
    template_id: templateId,
    name: String(info.name ?? templateId),
    severity: severity(info.severity),
    matched_at: data['matched-at'] ? String(data['matched-at']) : null,
    evidence,
    cve_ids: [...cveIds],
    cwe_ids: [...cweIds],
    // Filter to absolute URLs, matching the ZAP parser. Template authors
    // sometimes put free text in `reference`, which is not a usable link.
    references: asStringArray(info.reference).filter((item) => /^https?:\/\//i.test(item)),
  }
}

/**
 * How long Nuclei is allowed to run, in milliseconds.
 *
 * Measured: a full pass over the pinned template set against a live host takes
 * ~95 s at the current throughput settings (three runs, 94-96 s). The budget is
 * 240 s, which is ~2.5x the observed time — enough headroom for a slower target
 * or slower hardware without letting a single stage dominate the scan.
 *
 * It was 420 s, chosen when a pass genuinely could not finish in time. That is
 * no longer true, and an over-long ceiling is not free: it is the worst case a
 * user actually waits through when a host is unresponsive.
 *
 * Overridable with `NUCLEI_TIMEOUT_MS` so a deployment on slower hardware can
 * raise it without a code change. Values outside a sane range are ignored
 * rather than trusted.
 */
export function nucleiTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseInt(env.NUCLEI_TIMEOUT_MS ?? '', 10)
  if (Number.isFinite(raw) && raw >= 30_000 && raw <= 1_800_000) return raw
  return 240_000
}

/*
 * Throughput settings, measured rather than reasoned about.
 *
 * Benchmarked against scanme.nmap.org with the real binary (nuclei 3.4.10) and
 * the full template repository (13,479 files, 6,839 loaded after the severity
 * filter). Three runs per configuration:
 *
 *   rate-limit 50,  concurrency 25  ->  273 s, 9 findings
 *   rate-limit 150, concurrency 50  ->   95 s, 9 findings   (no loss)
 *
 * The earlier note in this file claimed the corpus was ~10,000 templates and
 * that dropping `info` severity was the decisive saving. Both were wrong:
 * measurement shows severity filtering only moves 6,839 -> 6,227 templates,
 * while the request rate is what actually governs wall-clock time. The default
 * `-rate-limit` is 150, so the previous value of 50 was throttling the scan to
 * a third of the tool's own default for no benefit.
 *
 * Notes on the individual flags:
 *
 * - `-rate-limit 150` matches Nuclei's default. It is a ceiling, not a target:
 *   against a slow host the real rate is far lower, and Nuclei still honours
 *   per-host error limits.
 * - `-concurrency 50` runs more templates in parallel. Most of the wall clock
 *   is spent waiting on the network, so this costs little locally.
 * - `-bulk-size` is dropped. It controls how many *hosts* are analysed in
 *   parallel per template; with a single target it never did anything.
 * - `-timeout 6` trims the per-request ceiling. Long-tail requests against an
 *   unresponsive path dominated the previous run.
 * - `-duc` disables the automatic template-update check. The templates are
 *   baked into the image at a pinned version, so the check is a pointless
 *   outbound call on every scan and a hang risk on a network-restricted host.
 * - `-ni` disables interactsh. Out-of-band tests need a callback server we do
 *   not run, so those templates can only ever produce false negatives while
 *   still costing time.
 * - Severity keeps `low`: measurement shows the saving from dropping it is
 *   small, and several genuine findings on the reference target are low.
 * - All protocol types are kept. On the reference target 7 of the 9 findings
 *   come from the 170 non-HTTP templates, which finish in 18 s; excluding them
 *   would have been a large loss of value for almost no time saved.
 */
export function nucleiArgs(url: string, templates: string | null): string[] {
  const args = [
    '-u',
    url,
    '-jsonl',
    '-silent',
    '-no-color',
    '-severity',
    'low,medium,high,critical',
    '-timeout',
    '6',
    '-retries',
    '1',
    '-rate-limit',
    '150',
    '-concurrency',
    '50',
    // Templates are pinned in the image; never reach out to update them.
    '-duc',
    // No interactsh server is run, so out-of-band templates cannot succeed.
    '-ni',
  ]
  if (templates) args.push('-templates', templates)
  return args
}

export async function runNucleiScan(url: string): Promise<NucleiEvidence> {
  const scannedAt = new Date().toISOString()
  const unavailable = (reason: string): NucleiEvidence => ({
    available: false,
    reason,
    binary: null,
    command: null,
    templates: null,
    results: [],
    truncated: false,
    scanned_at: scannedAt,
  })

  const tool = await findBinary('nuclei', 'NUCLEI_PATH')
  if (!tool.available || !tool.binary) return unavailable(tool.reason ?? 'nuclei unavailable')

  const templates = findTemplatePath()
  const args = nucleiArgs(url, templates)

  const timeoutMs = nucleiTimeoutMs()
  const result = await runCommand(tool.binary, args, {
    timeoutMs,
    maxOutputBytes: 10 * 1024 * 1024,
  })

  /*
   * A timeout is not a failure if Nuclei already streamed results. JSONL is
   * emitted one complete line at a time as each template matches, so whatever
   * arrived before the deadline is valid, verified output. Discarding it — as
   * the previous implementation did — silently dropped real findings. The
   * partial pass is kept and flagged as truncated so the report can say the
   * template run did not finish.
   */
  const timedOutWithNothing = result.timedOut && !result.stdout.trim()
  if (timedOutWithNothing) {
    return {
      available: false,
      reason: `Nuclei timed out after ${Math.round(timeoutMs / 1000)}s before producing any results.`,
      binary: tool.binary,
      command: result.command,
      templates,
      results: [],
      truncated: true,
      scanned_at: scannedAt,
    }
  }

  if (!result.ok && !result.timedOut && !result.stdout.trim()) {
    const stderr = result.stderr.trim()
    return {
      available: false,
      reason:
        stderr ||
        'Nuclei ran but produced no JSONL output. Check that templates are installed and readable.',
      binary: tool.binary,
      command: result.command,
      templates,
      results: [],
      truncated: false,
      scanned_at: scannedAt,
    }
  }

  const dedupe = new Map<string, NucleiResultEvidence>()
  for (const line of result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    /*
     * One unparseable line must never end the scan. The parser is defensive,
     * but it reads output from an external binary we do not control, so the
     * loop refuses to trust it either.
     */
    let parsed: NucleiResultEvidence | null = null
    try {
      parsed = parseNucleiLine(line)
    } catch {
      parsed = null
    }
    if (!parsed) continue
    const key = `${parsed.template_id}|${parsed.matched_at ?? ''}|${parsed.evidence ?? ''}`
    if (!dedupe.has(key)) dedupe.set(key, parsed)
  }

  const truncatedNote = result.timedOut
    ? `Nuclei was stopped after ${Math.round(timeoutMs / 1000)}s; ${dedupe.size} result(s) collected before the deadline. Template coverage is partial.`
    : null

  return {
    available: true,
    reason: truncatedNote ?? (result.stderr.trim() || null),
    binary: tool.binary,
    command: commandLine(tool.binary, args),
    templates,
    results: [...dedupe.values()],
    truncated: result.timedOut,
    scanned_at: scannedAt,
  }
}
