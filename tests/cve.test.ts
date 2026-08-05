import { describe, expect, it } from 'vitest'
import { __testing__, collectComponents } from '@/lib/scanner/cve'
import type { OpenPort, TechnologyEntry } from '@/types/report'

const { compareVersions, inRange, cpeMatchesComponent, walkCpeMatches, cvss } = __testing__

/**
 * CVE matching decides whether the report accuses software of being
 * vulnerable. A false positive here is worse than a miss: it destroys trust in
 * every other finding. These tests pin the conservative behaviour in place.
 */

function tech(overrides: Partial<TechnologyEntry> & { name: string }): TechnologyEntry {
  return { category: 'Web Server', version: null, ...overrides }
}

function port(overrides: Partial<OpenPort> & { port: number }): OpenPort {
  return {
    protocol: 'tcp',
    service: 'http',
    state: 'open',
    risk: 'info',
    ...overrides,
  }
}

describe('compareVersions', () => {
  it('orders simple numeric versions', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('compares segment by segment rather than lexically', () => {
    // A string comparison would wrongly place 2.10 before 2.9.
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.100', '1.99')).toBeGreaterThan(0)
  })

  it('treats missing trailing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0)
  })

  it('handles the real-world Apache versions used in CVE matching', () => {
    expect(compareVersions('2.4.49', '2.4.50')).toBeLessThan(0)
    expect(compareVersions('2.4.49', '2.4.49')).toBe(0)
  })
})

describe('inRange', () => {
  it('accepts a version inside an inclusive range', () => {
    expect(
      inRange('2.4.49', { versionStartIncluding: '2.4.0', versionEndIncluding: '2.4.50' }),
    ).toBe(true)
  })

  it('rejects a version below an inclusive lower bound', () => {
    expect(inRange('2.3.9', { versionStartIncluding: '2.4.0' })).toBe(false)
  })

  it('respects an exclusive upper bound', () => {
    expect(inRange('2.4.50', { versionEndExcluding: '2.4.50' })).toBe(false)
    expect(inRange('2.4.49', { versionEndExcluding: '2.4.50' })).toBe(true)
  })

  it('respects an exclusive lower bound', () => {
    expect(inRange('2.4.0', { versionStartExcluding: '2.4.0' })).toBe(false)
    expect(inRange('2.4.1', { versionStartExcluding: '2.4.0' })).toBe(true)
  })

  it('returns false when the CPE declares no range at all', () => {
    // Without bounds there is nothing to prove, so we must not claim a match.
    expect(inRange('1.0.0', {})).toBe(false)
  })
})

describe('cpeMatchesComponent', () => {
  const apache = { name: 'Apache', version: '2.4.49', source: 'http-response' }

  it('matches an exact product and version', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: true,
        criteria: 'cpe:2.3:a:apache:http_server:2.4.49:*:*:*:*:*:*:*',
      }),
    ).toBe(true)
  })

  it('refuses a different version of the same product', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: true,
        criteria: 'cpe:2.3:a:apache:http_server:2.4.51:*:*:*:*:*:*:*',
      }),
    ).toBe(false)
  })

  it('refuses an entry explicitly marked not vulnerable', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: false,
        criteria: 'cpe:2.3:a:apache:http_server:2.4.49:*:*:*:*:*:*:*',
      }),
    ).toBe(false)
  })

  it('refuses a malformed or non-2.3 CPE string', () => {
    expect(cpeMatchesComponent(apache, { vulnerable: true, criteria: 'not-a-cpe' })).toBe(false)
    expect(cpeMatchesComponent(apache, { vulnerable: true, criteria: '' })).toBe(false)
  })

  it('matches a wildcard version through the declared range instead', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: true,
        criteria: 'cpe:2.3:a:apache:http_server:*:*:*:*:*:*:*:*',
        versionStartIncluding: '2.4.0',
        versionEndExcluding: '2.4.50',
      }),
    ).toBe(true)
  })

  it('rejects a wildcard-version CPE whose range excludes the observed version', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: true,
        criteria: 'cpe:2.3:a:apache:http_server:*:*:*:*:*:*:*:*',
        versionStartIncluding: '2.4.50',
      }),
    ).toBe(false)
  })

  it('does not match an unrelated product that happens to share a version', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: true,
        criteria: 'cpe:2.3:a:nginx:nginx:2.4.49:*:*:*:*:*:*:*',
      }),
    ).toBe(false)
  })

  it('resolves known vendor/product naming aliases', () => {
    expect(
      cpeMatchesComponent(
        { name: 'nginx', version: '1.20.0', source: 'http-response' },
        { vulnerable: true, criteria: 'cpe:2.3:a:f5:nginx:1.20.0:*:*:*:*:*:*:*' },
      ),
    ).toBe(true)
  })
})

describe('walkCpeMatches', () => {
  it('collects matches from nested configuration nodes', () => {
    const configurations = [
      {
        nodes: [
          {
            cpeMatch: [{ criteria: 'cpe:2.3:a:x:y:1.0:*:*:*:*:*:*:*' }],
            nodes: [{ cpeMatch: [{ criteria: 'cpe:2.3:a:x:y:2.0:*:*:*:*:*:*:*' }] }],
          },
        ],
      },
    ]
    expect(walkCpeMatches(configurations)).toHaveLength(2)
  })

  it('returns an empty list for absent or malformed configurations', () => {
    expect(walkCpeMatches(undefined)).toEqual([])
    expect(walkCpeMatches(null)).toEqual([])
    expect(walkCpeMatches('nonsense')).toEqual([])
    expect(walkCpeMatches([])).toEqual([])
  })
})

describe('cvss', () => {
  it('prefers CVSS v3.1 scoring when present', () => {
    const result = cvss({
      metrics: {
        cvssMetricV31: [{ cvssData: { baseScore: 9.8, baseSeverity: 'CRITICAL' } }],
        cvssMetricV2: [{ cvssData: { baseScore: 5.0, baseSeverity: 'MEDIUM' } }],
      },
    })
    expect(result.score).toBe(9.8)
    expect(result.severity).toBe('critical')
  })

  it('falls back to CVSS v2 when no v3/v4 metric exists', () => {
    const result = cvss({ metrics: { cvssMetricV2: [{ cvssData: { baseScore: 5.0 } }] } })
    expect(result.score).toBe(5)
    expect(result.severity).toBe('medium')
  })

  it('derives severity from the numeric score when the label is missing', () => {
    expect(cvss({ metrics: { cvssMetricV31: [{ cvssData: { baseScore: 7.5 } }] } }).severity).toBe(
      'high',
    )
    expect(cvss({ metrics: { cvssMetricV31: [{ cvssData: { baseScore: 3.1 } }] } }).severity).toBe(
      'low',
    )
  })

  it('returns an informational zero when no metrics are published', () => {
    expect(cvss({})).toEqual({ score: 0, severity: 'info' })
  })
})

describe('collectComponents', () => {
  it('ignores technologies with no detected version', () => {
    // Querying NVD by product name alone is how scanners invent CVEs.
    expect(collectComponents([tech({ name: 'Apache', version: null })], [])).toEqual([])
  })

  it('ignores technologies whose version was inferred rather than disclosed', () => {
    expect(
      collectComponents([tech({ name: 'Apache', version: '2.4.49', confidence: 'medium' })], []),
    ).toEqual([])
  })

  it('accepts a high-confidence versioned technology', () => {
    const result = collectComponents(
      [tech({ name: 'Apache', version: '2.4.49', confidence: 'high' })],
      [],
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Apache', version: '2.4.49' })
  })

  it('accepts Nmap service banners that carry both product and version', () => {
    const result = collectComponents(
      [],
      [port({ port: 22, service: 'ssh', product: 'OpenSSH', version: '8.2p1' })],
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'OpenSSH', version: '8.2p1', source: 'nmap:22/tcp' })
  })

  it('ignores Nmap results missing a product or version', () => {
    expect(collectComponents([], [port({ port: 80, product: 'nginx' })])).toEqual([])
    expect(collectComponents([], [port({ port: 80, version: '1.0' })])).toEqual([])
  })

  it('deduplicates the same product and version from multiple sources', () => {
    const result = collectComponents(
      [tech({ name: 'nginx', version: '1.20.0', confidence: 'high' })],
      [port({ port: 80, service: 'http', product: 'nginx', version: '1.20.0' })],
    )
    expect(result).toHaveLength(1)
  })

  it('caps the number of components so a scan cannot hammer the NVD API', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      tech({ name: `Product${i}`, version: `1.0.${i}`, confidence: 'high' }),
    )
    expect(collectComponents(many, []).length).toBeLessThanOrEqual(8)
  })
})

describe('compareVersions — semver pre-release precedence', () => {
  it('sorts a pre-release below its final release', () => {
    // A digits-only comparison treats these as equal, which silently corrupts
    // CVE range matching around release boundaries.
    expect(compareVersions('1.0.0-rc1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc1')).toBeGreaterThan(0)
  })

  it('orders pre-release tags against each other', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareVersions('1.0.0-rc1', '1.0.0-rc2')).toBeLessThan(0)
  })

  it('treats identical pre-releases as equal', () => {
    expect(compareVersions('1.0.0-rc1', '1.0.0-rc1')).toBe(0)
  })

  it('ignores build metadata, which does not affect precedence', () => {
    expect(compareVersions('1.0.0-rc1+build5', '1.0.0-rc1')).toBe(0)
  })

  it('still compares plain releases numerically', () => {
    expect(compareVersions('2.4.49', '2.4.50')).toBeLessThan(0)
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0)
  })

  it('excludes a pre-release from a range that ends at the release', () => {
    // versionEndExcluding: 1.0.0 must exclude 1.0.0 but include 1.0.0-rc1.
    expect(inRange('1.0.0-rc1', { versionEndExcluding: '1.0.0' })).toBe(true)
    expect(inRange('1.0.0', { versionEndExcluding: '1.0.0' })).toBe(false)
  })
})

describe('CVE false positives from vendor-level matching', () => {
  // Regression: a live scan of scanme.nmap.org attributed Apache CXF and
  // Apache Groovy CVEs to an Apache HTTP Server banner, because matching
  // considered the CPE *vendor* field and used substring comparison.
  const apache = { name: 'Apache', version: '2.4.7', source: 'nmap:80/tcp' }

  it('matches the Apache HTTP Server product', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: true,
        criteria: 'cpe:2.3:a:apache:http_server:2.4.7:*:*:*:*:*:*:*',
      }),
    ).toBe(true)
  })

  it('does NOT match Apache CXF', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: true,
        criteria: 'cpe:2.3:a:apache:cxf:2.4.7:*:*:*:*:*:*:*',
      }),
    ).toBe(false)
  })

  it('does NOT match Apache Groovy', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: true,
        criteria: 'cpe:2.3:a:apache:groovy:2.4.7:*:*:*:*:*:*:*',
      }),
    ).toBe(false)
  })

  it('does NOT match Apache Tomcat', () => {
    expect(
      cpeMatchesComponent(apache, {
        vulnerable: true,
        criteria: 'cpe:2.3:a:apache:tomcat:2.4.7:*:*:*:*:*:*:*',
      }),
    ).toBe(false)
  })

  it('does not let a product name match by substring', () => {
    // "nginx" must not authorise a match against "nginx_unit".
    expect(
      cpeMatchesComponent(
        { name: 'nginx', version: '1.20.0', source: 'http' },
        { vulnerable: true, criteria: 'cpe:2.3:a:nginx:nginx_unit:1.20.0:*:*:*:*:*:*:*' },
      ),
    ).toBe(false)
  })

  it('still matches when the banner already includes the product', () => {
    expect(
      cpeMatchesComponent(
        { name: 'Apache httpd', version: '2.4.7', source: 'nmap' },
        { vulnerable: true, criteria: 'cpe:2.3:a:apache:http_server:2.4.7:*:*:*:*:*:*:*' },
      ),
    ).toBe(true)
  })
})
