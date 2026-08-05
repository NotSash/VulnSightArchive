import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseNmapXml } from '@/lib/scanner/nmap'
import { nucleiArgs, nucleiTimeoutMs, parseNucleiLine } from '@/lib/scanner/nuclei'
import { normalizeCwe, severityFromZap, splitReferences } from '@/lib/scanner/zap'

/**
 * Parser contracts for external tool output.
 *
 * These tools are third-party binaries and services whose output format can
 * change between versions. Pinning the parsing behaviour against captured
 * fixtures means an upstream format change surfaces as a failing test rather
 * than as silently empty findings in a customer's report.
 */

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')

describe('parseNmapXml', () => {
  const ports = parseNmapXml(fixture('nmap-sample.xml'))

  it('returns only ports Nmap reported as open', () => {
    // The fixture contains a closed 8080 and a filtered 9090. Neither is an
    // exposed service and neither may appear in the report.
    expect(ports.map((p) => p.port)).toEqual([22, 23, 80, 443, 3306])
    expect(ports.every((p) => p.state === 'open')).toBe(true)
  })

  it('extracts product and version for CVE enrichment', () => {
    const http = ports.find((p) => p.port === 80)
    expect(http).toMatchObject({ service: 'http', product: 'Apache httpd', version: '2.4.49' })
  })

  it('captures extrainfo when the service probe provides it', () => {
    expect(ports.find((p) => p.port === 22)?.extrainfo).toContain('Ubuntu Linux')
  })

  it('grades plaintext administrative protocols as high risk', () => {
    expect(ports.find((p) => p.port === 23)?.risk).toBe('high')
  })

  it('grades exposed databases as medium risk', () => {
    expect(ports.find((p) => p.port === 3306)?.risk).toBe('medium')
  })

  it('grades remote access as low risk', () => {
    expect(ports.find((p) => p.port === 22)?.risk).toBe('low')
  })

  it('grades ordinary web ports as informational', () => {
    expect(ports.find((p) => p.port === 443)?.risk).toBe('info')
  })

  it('attaches human-readable evidence to every port', () => {
    for (const port of ports) {
      expect(port.evidence).toBeTruthy()
    }
  })

  it('returns ports in ascending order', () => {
    const numbers = ports.map((p) => p.port)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })

  it('returns an empty list when the scan found no hosts', () => {
    expect(parseNmapXml('<?xml version="1.0"?><nmaprun></nmaprun>')).toEqual([])
  })

  it('does not throw on truncated XML from a timed-out scan', () => {
    // A killed Nmap leaves half-written XML; that must degrade, not crash.
    expect(() => parseNmapXml('<?xml version="1.0"?><nmaprun><host><ports>')).not.toThrow()
  })
})

describe('parseNucleiLine', () => {
  it('parses a full template result', () => {
    const line = JSON.stringify({
      'template-id': 'CVE-2021-41773',
      info: {
        name: 'Apache 2.4.49 - Path Traversal',
        severity: 'critical',
        reference: ['https://nvd.nist.gov/vuln/detail/CVE-2021-41773'],
        classification: {},
        tags: ['cve', 'cve2021', 'apache', 'rce'],
      },
      'matched-at': 'https://example.com/cgi-bin/.%2e/etc/passwd',
      'extracted-results': ['root:x:0:0:root:/root:/bin/bash'],
    })
    const result = parseNucleiLine(line)
    expect(result).toMatchObject({
      template_id: 'CVE-2021-41773',
      name: 'Apache 2.4.49 - Path Traversal',
      severity: 'critical',
      matched_at: 'https://example.com/cgi-bin/.%2e/etc/passwd',
    })
    expect(result?.cve_ids).toContain('CVE-2021-41773')
    expect(result?.evidence).toContain('root:x:0:0')
  })

  it('recovers the CVE id from the template id when classification omits it', () => {
    const line = JSON.stringify({ 'template-id': 'CVE-2023-1234', info: { severity: 'high' } })
    expect(parseNucleiLine(line)?.cve_ids).toEqual(['CVE-2023-1234'])
  })

  it('reads CVE and CWE ids from the classification block', () => {
    const line = JSON.stringify({
      'template-id': 'generic-check',
      info: {
        severity: 'medium',
        classification: { 'cve-id': 'CVE-2020-5555', 'cwe-id': 'CWE-79' },
      },
    })
    const result = parseNucleiLine(line)
    expect(result?.cve_ids).toEqual(['CVE-2020-5555'])
    expect(result?.cwe_ids).toEqual(['CWE-79'])
  })

  it('defaults an unrecognised severity to informational', () => {
    const line = JSON.stringify({ 'template-id': 'x', info: { severity: 'unknown-level' } })
    expect(parseNucleiLine(line)?.severity).toBe('info')
  })

  it('accepts every documented severity level', () => {
    for (const severity of ['critical', 'high', 'medium', 'low', 'info']) {
      const line = JSON.stringify({ 'template-id': 't', info: { severity } })
      expect(parseNucleiLine(line)?.severity).toBe(severity)
    }
  })

  it('returns null for a non-JSON line rather than throwing', () => {
    // Nuclei interleaves diagnostics with results on stdout.
    expect(parseNucleiLine('[INF] Templates loaded: 4821')).toBeNull()
    expect(parseNucleiLine('')).toBeNull()
    expect(parseNucleiLine('{broken json')).toBeNull()
  })

  it('falls back to the template id when the template has no name', () => {
    expect(parseNucleiLine(JSON.stringify({ 'template-id': 'my-template' }))?.name).toBe(
      'my-template',
    )
  })

  it('keeps only absolute URLs from the reference list', () => {
    // Template authors sometimes put free text in `reference`; that is not a
    // usable link and must not reach the report. Matches the ZAP parser.
    const line = JSON.stringify({
      'template-id': 't',
      info: { severity: 'low', reference: ['https://example.com/a', 'not-a-url'] },
    })
    expect(parseNucleiLine(line)?.references).toEqual(['https://example.com/a'])
  })
})

describe('ZAP alert parsing', () => {
  describe('severityFromZap', () => {
    it('maps ZAP risk labels onto the severity scale', () => {
      expect(severityFromZap('High')).toBe('high')
      expect(severityFromZap('Medium')).toBe('medium')
      expect(severityFromZap('Low')).toBe('low')
      expect(severityFromZap('Informational')).toBe('info')
    })

    it('handles the combined "risk (confidence)" form ZAP emits', () => {
      expect(severityFromZap('High (Medium)')).toBe('high')
    })

    it('is case-insensitive', () => {
      expect(severityFromZap('HIGH')).toBe('high')
    })

    it('defaults to informational for unknown or missing values', () => {
      expect(severityFromZap(undefined)).toBe('info')
      expect(severityFromZap(null)).toBe('info')
      expect(severityFromZap('')).toBe('info')
    })
  })

  describe('normalizeCwe', () => {
    it('formats a bare numeric id', () => {
      expect(normalizeCwe(79)).toBe('CWE-79')
      expect(normalizeCwe('693')).toBe('CWE-693')
    })

    it('passes through an already-prefixed id', () => {
      expect(normalizeCwe('CWE-352')).toBe('CWE-352')
      expect(normalizeCwe('cwe-352')).toBe('CWE-352')
    })

    it('returns null when ZAP reports no CWE', () => {
      // ZAP uses -1 and 0 to mean "not applicable".
      expect(normalizeCwe(-1)).toBeNull()
      expect(normalizeCwe(0)).toBeNull()
      expect(normalizeCwe(undefined)).toBeNull()
      expect(normalizeCwe('')).toBeNull()
    })
  })

  describe('splitReferences', () => {
    it("splits ZAP's whitespace-delimited reference blob", () => {
      expect(splitReferences('https://a.example/1\nhttps://b.example/2')).toEqual([
        'https://a.example/1',
        'https://b.example/2',
      ])
    })

    it('discards non-URL text', () => {
      expect(splitReferences('see-the-docs https://a.example/1')).toEqual(['https://a.example/1'])
    })

    it('returns an empty list when there are no references', () => {
      expect(splitReferences(undefined)).toEqual([])
      expect(splitReferences('')).toEqual([])
    })
  })
})

describe('parseNmapXml — partial output from a stopped scan', () => {
  it('recovers completed ports from XML truncated mid-document', () => {
    // Nmap streams XML as it works. When a scan is killed on timeout the
    // document is incomplete, but ports already probed are still usable and
    // must not be thrown away.
    const partial = `<?xml version="1.0"?><nmaprun><host><ports>
      <port protocol="tcp" portid="80"><state state="open"/>
        <service name="http" product="nginx" version="1.20.0"/></port>
      <port protocol="tcp" portid="443"><state state="open"/>
        <service name="https"/></port>`

    const ports = parseNmapXml(partial)
    expect(ports.length).toBeGreaterThanOrEqual(1)
    expect(ports.map((p) => p.port)).toContain(80)
  })

  it('returns an empty list for XML with no recoverable ports', () => {
    expect(parseNmapXml('<?xml version="1.0"?><nmaprun><host>')).toEqual([])
  })
})

describe('parseNmapXml — intercepting firewall behaviour', () => {
  /**
   * Regression: scanning a host behind an IPS returned 1,000 "open" ports,
   * 992 of them `tcpwrapped`. That produced exposure findings for ports
   * hosting nothing, including a fabricated RDP and VNC exposure.
   */
  function xmlWith(ports: { id: number; service: string; product?: string }[]): string {
    const entries = ports
      .map(
        (p) =>
          `<port protocol="tcp" portid="${p.id}"><state state="open"/>` +
          `<service name="${p.service}"${p.product ? ` product="${p.product}"` : ''}/></port>`,
      )
      .join('')
    return `<?xml version="1.0"?><nmaprun><host><ports>${entries}</ports></host></nmaprun>`
  }

  it('drops tcpwrapped noise when most results are unidentified', () => {
    const noise = Array.from({ length: 100 }, (_, i) => ({
      id: 1000 + i,
      service: 'tcpwrapped',
    }))
    const real = [
      { id: 22, service: 'ssh', product: 'OpenSSH' },
      { id: 80, service: 'http', product: 'Apache httpd' },
    ]

    const ports = parseNmapXml(xmlWith([...real, ...noise]))
    expect(ports.map((p) => p.port).sort((a, b) => a - b)).toEqual([22, 80])
  })

  it('keeps tcpwrapped results when they are a small minority', () => {
    // A couple of unidentified services on a normal host is ordinary and
    // should still be reported.
    const ports = parseNmapXml(
      xmlWith([
        { id: 22, service: 'ssh' },
        { id: 80, service: 'http' },
        { id: 443, service: 'https' },
        { id: 8080, service: 'tcpwrapped' },
      ]),
    )
    expect(ports).toHaveLength(4)
  })

  it('does not filter small port lists', () => {
    const ports = parseNmapXml(xmlWith([{ id: 80, service: 'tcpwrapped' }]))
    expect(ports).toHaveLength(1)
  })
})

describe('nucleiTimeoutMs', () => {
  it('defaults to four minutes, ~2.5x the measured pass time', () => {
    // A full pass against a live host measured 94-96s over three runs with the
    // current throughput settings, so 240s carries real headroom without
    // making an unresponsive target block the scan for seven minutes.
    expect(nucleiTimeoutMs({} as NodeJS.ProcessEnv)).toBe(240_000)
  })

  it('honours a deployment override', () => {
    expect(nucleiTimeoutMs({ NUCLEI_TIMEOUT_MS: '600000' } as unknown as NodeJS.ProcessEnv)).toBe(
      600_000,
    )
  })

  it('ignores values that are absurd or unparseable rather than trusting them', () => {
    for (const value of ['0', '10', 'abc', '-5000', '99999999']) {
      expect(nucleiTimeoutMs({ NUCLEI_TIMEOUT_MS: value } as unknown as NodeJS.ProcessEnv)).toBe(
        240_000,
      )
    }
  })
})

/**
 * Nuclei invocation settings.
 *
 * These numbers come from benchmarking the real binary (nuclei 3.4.10) against
 * scanme.nmap.org with the full pinned template repository:
 *
 *   rate-limit 50,  concurrency 25  ->  273 s, 9 findings
 *   rate-limit 150, concurrency 50  ->   95 s, 9 findings   (nothing lost)
 *
 * An earlier version of this file asserted an arithmetic model instead — rate
 * multiplied by budget against an assumed 10,000-template corpus. That model
 * was wrong in both directions (6,839 templates actually load, and throughput
 * is not linear in the rate limit), and it happily passed while a real scan
 * took four and a half minutes. These tests now pin the properties that were
 * actually observed to matter.
 */
describe('nucleiArgs', () => {
  /** Read the value following a flag, e.g. flagValue(args, '-rate-limit'). */
  function flagValue(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag)
    return index === -1 ? undefined : args[index + 1]
  }

  const args = nucleiArgs('http://example.com', '/opt/nuclei-templates')

  it('does not throttle below the tool default', () => {
    // Nuclei's own default is 150/s. The previous value of 50 was a third of
    // that, which tripled the wall clock and bought nothing: the rate limit is
    // a ceiling, and against a slow host the real rate is far lower anyway.
    expect(Number(flagValue(args, '-rate-limit'))).toBeGreaterThanOrEqual(150)
  })

  it('stays polite enough not to look like an attack', () => {
    expect(Number(flagValue(args, '-rate-limit'))).toBeLessThanOrEqual(150)
  })

  it('runs enough templates in parallel to use the waiting time', () => {
    // Most of the elapsed time is spent waiting on the network, so parallelism
    // is close to free locally.
    expect(Number(flagValue(args, '-concurrency'))).toBeGreaterThanOrEqual(50)
  })

  it('does not pass bulk-size, which does nothing for a single target', () => {
    // -bulk-size is "hosts analysed in parallel per template". VulnSight scans
    // one host at a time, so it was pure noise in the command line.
    expect(args).not.toContain('-bulk-size')
  })

  it('disables the template auto-update check', () => {
    // Templates are pinned in the image. Without -duc, every scan makes an
    // outbound call that can hang on a network-restricted host.
    expect(args).toContain('-duc')
  })

  it('disables interactsh, which has no callback server here', () => {
    // Out-of-band templates need a server we do not run, so they can only
    // ever cost time.
    expect(args).toContain('-ni')
  })

  it('skips informational templates so the budget is spent on real findings', () => {
    const severity = flagValue(args, '-severity') ?? ''
    expect(severity).not.toMatch(/\binfo\b/)
    for (const level of ['low', 'medium', 'high', 'critical']) {
      expect(severity).toContain(level)
    }
  })

  it('keeps every protocol type', () => {
    // Measured: 7 of 9 findings on the reference target come from the ~170
    // non-HTTP templates, which complete in 18s. Restricting to -type http
    // would drop most of the value for almost no saving.
    expect(args).not.toContain('-type')
  })

  it('caps a single request so one slow path cannot dominate the run', () => {
    expect(Number(flagValue(args, '-timeout'))).toBeLessThanOrEqual(8)
  })

  it('requests machine-readable output and the given target', () => {
    expect(args).toContain('-jsonl')
    expect(flagValue(args, '-u')).toBe('http://example.com')
    expect(flagValue(args, '-templates')).toBe('/opt/nuclei-templates')
  })

  it('omits the templates flag when no template directory was found', () => {
    // Passing an empty -templates would make Nuclei scan nothing at all.
    expect(nucleiArgs('http://example.com', null)).not.toContain('-templates')
  })
})
