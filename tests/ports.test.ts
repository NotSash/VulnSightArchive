import { describe, expect, it } from 'vitest'
import { mergePorts } from '@/lib/scanner/run'
import type { OpenPort } from '@/types/report'

/**
 * Port merging and reporting.
 *
 * Two rules matter here. First, the report must never present a closed or
 * filtered port as an exposed service — the field is called `open_ports` and
 * readers act on it. Second, when a TCP connect probe and an Nmap service scan
 * disagree, Nmap wins: it actually probes the service, whereas a bare connect
 * only proves something accepted a socket.
 */

function port(overrides: Partial<OpenPort> & { port: number }): OpenPort {
  return {
    protocol: 'tcp',
    service: 'http',
    state: 'open',
    risk: 'info',
    ...overrides,
  }
}

describe('mergePorts', () => {
  it('returns only ports that are open', () => {
    const merged = mergePorts(
      [
        port({ port: 80, state: 'open' }),
        port({ port: 443, state: 'closed' }),
        port({ port: 8080, state: 'filtered' }),
      ],
      [],
    )
    expect(merged.map((p) => p.port)).toEqual([80])
  })

  it('lets Nmap correct a connect probe that reported open', () => {
    // A load balancer can accept a TCP connection for a port with nothing
    // behind it. Nmap's service probe is the more reliable signal.
    const merged = mergePorts(
      [port({ port: 443, state: 'open', service: 'https' })],
      [port({ port: 443, state: 'closed', service: 'https' })],
    )
    expect(merged).toEqual([])
  })

  it('lets Nmap promote a port the connect probe missed', () => {
    const merged = mergePorts(
      [port({ port: 443, state: 'filtered' })],
      [port({ port: 443, state: 'open', service: 'https', product: 'nginx' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ state: 'open', product: 'nginx' })
  })

  it('prefers Nmap service metadata over the probe placeholder', () => {
    const merged = mergePorts(
      [port({ port: 80, service: 'http' })],
      [port({ port: 80, service: 'http', product: 'Apache httpd', version: '2.4.49' })],
    )
    expect(merged[0]).toMatchObject({ product: 'Apache httpd', version: '2.4.49' })
  })

  it('keeps probe metadata when Nmap supplies none', () => {
    const merged = mergePorts(
      [port({ port: 80, evidence: 'TCP connect succeeded' })],
      [port({ port: 80 })],
    )
    expect(merged[0].evidence).toBe('TCP connect succeeded')
  })

  it('keeps the most severe risk assessment from either source', () => {
    const merged = mergePorts(
      [port({ port: 23, risk: 'info' })],
      [port({ port: 23, service: 'telnet', risk: 'high' })],
    )
    expect(merged[0].risk).toBe('high')
  })

  it('does not downgrade a risk already assessed as more severe', () => {
    const merged = mergePorts(
      [port({ port: 23, risk: 'high' })],
      [port({ port: 23, risk: 'info' })],
    )
    expect(merged[0].risk).toBe('high')
  })

  it('treats the same number on different protocols as distinct ports', () => {
    const merged = mergePorts(
      [port({ port: 53, protocol: 'tcp' })],
      [port({ port: 53, protocol: 'udp' })],
    )
    expect(merged).toHaveLength(2)
  })

  it('returns ports in ascending order', () => {
    const merged = mergePorts([], [port({ port: 443 }), port({ port: 22 }), port({ port: 80 })])
    expect(merged.map((p) => p.port)).toEqual([22, 80, 443])
  })

  it('handles empty input from either side', () => {
    expect(mergePorts([], [])).toEqual([])
    expect(mergePorts([port({ port: 80 })], [])).toHaveLength(1)
    expect(mergePorts([], [port({ port: 80 })])).toHaveLength(1)
  })
})
