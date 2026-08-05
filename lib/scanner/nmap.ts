import { XMLParser } from 'fast-xml-parser'
import { commandLine, findBinary, runCommand } from '@/lib/scanner/tools'
import type { NmapEvidence, OpenPort, ScanMode, Severity } from '@/types/report'

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function attr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function riskForPort(port: number, service: string): Severity {
  const name = service.toLowerCase()
  if (['telnet', 'ftp', 'rlogin', 'rexec'].includes(name)) return 'high'
  if (['mysql', 'postgresql', 'ms-sql-s', 'mongodb', 'redis', 'elasticsearch'].includes(name)) {
    return 'medium'
  }
  if ([22, 3389, 5900].includes(port)) return 'low'
  return 'info'
}

/**
 * Services that indicate a port is not genuinely serving anything.
 *
 * `tcpwrapped` means the TCP handshake completed but the connection was closed
 * before any service banner was exchanged. This is the signature of a firewall
 * or IPS that accepts every connection — a host behind one appears to have all
 * 1,000 scanned ports "open", which would flood the report with fabricated
 * exposure findings. Nmap itself treats these as unidentified, and so do we.
 */
const NON_SERVICE_MARKERS = new Set(['tcpwrapped', 'unknown'])

/**
 * True when the scan result looks like an intercepting firewall rather than a
 * genuinely exposed host.
 *
 * Real servers do not run hundreds of distinct services. When most results are
 * `tcpwrapped`, the port list describes the firewall's behaviour, not the
 * target's attack surface.
 */
function looksFiltered(ports: OpenPort[]): boolean {
  if (ports.length < 20) return false
  const wrapped = ports.filter((port) => NON_SERVICE_MARKERS.has(port.service.toLowerCase()))
  return wrapped.length / ports.length > 0.5
}

/**
 * Convert Nmap XML into normalized open-port records.
 *
 * Only ports Nmap explicitly reported as `open` are returned; `closed` and
 * `filtered` entries are discarded so the report never presents an unreachable
 * port as an exposed service. Kept separate from process execution so the
 * parsing contract can be tested against captured Nmap output.
 */
export function parseNmapXml(xml: string): OpenPort[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const parsed = parser.parse(xml)
  const hosts = asArray(parsed?.nmaprun?.host)
  const ports: OpenPort[] = []

  for (const parsedHost of hosts) {
    for (const parsedPort of asArray(parsedHost?.ports?.port)) {
      const state = attr(parsedPort?.state?.['@_state'])
      if (state !== 'open') continue
      const port = Number(parsedPort?.['@_portid'])
      if (!Number.isInteger(port)) continue
      const protocol = attr(parsedPort?.['@_protocol']) ?? 'tcp'
      const service = attr(parsedPort?.service?.['@_name']) ?? 'unknown'
      const product = attr(parsedPort?.service?.['@_product'])
      const version = attr(parsedPort?.service?.['@_version'])
      const extrainfo = attr(parsedPort?.service?.['@_extrainfo'])
      const serviceEvidence = [product, version, extrainfo].filter(Boolean).join(' ')

      ports.push({
        port,
        protocol,
        service,
        state: 'open',
        risk: riskForPort(port, service),
        product,
        version,
        extrainfo,
        evidence: serviceEvidence || `Nmap reported ${port}/${protocol} open as ${service}`,
      })
    }
  }

  const sorted = ports.sort((a, b) => a.port - b.port)

  /*
   * Behind an intercepting firewall every probed port answers, so the port
   * list would otherwise report ~1,000 "open" services and generate exposure
   * findings for ports that host nothing. Keep only ports where a service was
   * actually identified: those are the ones we have evidence for.
   */
  if (looksFiltered(sorted)) {
    return sorted.filter((port) => !NON_SERVICE_MARKERS.has(port.service.toLowerCase()))
  }

  return sorted
}

/**
 * Parse Nmap XML, returning an empty list instead of throwing.
 *
 * Used on the timeout path, where the captured document is expected to be
 * truncated mid-element.
 */
function safeParse(xml: string): OpenPort[] {
  if (!xml.trim()) return []
  try {
    return parseNmapXml(xml)
  } catch {
    return []
  }
}

export async function runNmapScan(host: string, mode: ScanMode): Promise<NmapEvidence> {
  const scannedAt = new Date().toISOString()
  const unavailable = (reason: string): NmapEvidence => ({
    available: false,
    reason,
    binary: null,
    command: null,
    ports: [],
    raw_xml: null,
    scanned_at: scannedAt,
  })

  const tool = await findBinary('nmap', 'NMAP_PATH')
  if (!tool.available || !tool.binary) return unavailable(tool.reason ?? 'nmap unavailable')

  /*
   * Port selection is a deliberate trade-off between coverage and completing
   * at all. A full `-p 1-65535` sweep with service detection does not finish
   * against a typical internet host inside any reasonable timeout, so the
   * previous configuration meant comprehensive scans almost always reported
   * Nmap as "timed out" and contributed nothing. Scanning the top 3,000 ports
   * covers essentially every service that matters in practice and completes
   * reliably.
   */
  const timeoutMs = mode === 'comprehensive' ? 300_000 : 90_000
  const portArgs = mode === 'comprehensive' ? ['--top-ports', '3000'] : ['--top-ports', '1000']
  const args = [
    '-oX',
    '-',
    '-Pn',
    '-sT',
    '-sV',
    '--version-light',
    '-T3',
    '--host-timeout',
    `${Math.floor(timeoutMs / 1000)}s`,
    ...portArgs,
    host,
  ]

  const result = await runCommand(tool.binary, args, {
    timeoutMs: timeoutMs + 5_000,
    maxOutputBytes: 8 * 1024 * 1024,
  })

  if (result.timedOut) {
    /*
     * A timeout does not necessarily mean no useful data. Nmap streams XML as
     * it works, so a partial document often contains fully-scanned ports.
     * Salvage whatever parses and report the scan as incomplete rather than
     * discarding confirmed findings — but never claim full coverage.
     */
    const salvaged = safeParse(result.stdout)
    const seconds = Math.round(timeoutMs / 1000)

    if (salvaged.length > 0) {
      return {
        available: true,
        reason: `Nmap timed out after ${seconds} seconds. ${salvaged.length} port(s) confirmed before the scan was stopped; coverage is incomplete.`,
        binary: tool.binary,
        command: commandLine(tool.binary, args),
        ports: salvaged,
        raw_xml: result.stdout || null,
        scanned_at: scannedAt,
      }
    }

    return {
      available: false,
      reason: `Nmap timed out after ${seconds} seconds before producing any usable result.`,
      binary: tool.binary,
      command: result.command,
      ports: [],
      raw_xml: result.stdout || null,
      scanned_at: scannedAt,
    }
  }

  if (!result.ok && !result.stdout.trim()) {
    return {
      available: false,
      reason: `Nmap failed${result.stderr ? `: ${result.stderr.trim().slice(0, 500)}` : '.'}`,
      binary: tool.binary,
      command: result.command,
      ports: [],
      raw_xml: null,
      scanned_at: scannedAt,
    }
  }

  try {
    const ports = parseNmapXml(result.stdout)

    return {
      available: true,
      reason: result.stderr.trim() || null,
      binary: tool.binary,
      command: commandLine(tool.binary, args),
      ports,
      raw_xml: result.stdout,
      scanned_at: scannedAt,
    }
  } catch (error) {
    return {
      available: false,
      reason: `Nmap ran, but its XML output could not be parsed${
        error instanceof Error && error.message ? `: ${error.message}` : '.'
      }`,
      binary: tool.binary,
      command: result.command,
      ports: [],
      raw_xml: result.stdout || null,
      scanned_at: scannedAt,
    }
  }
}
