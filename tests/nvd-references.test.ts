import { describe, expect, it } from 'vitest'
import { __testing__ } from '@/lib/scanner/cve'

const { references } = __testing__

/**
 * Regression cover for NVD reference extraction.
 *
 * History: the original implementation read `cve.references.referenceData`,
 * which is the NVD **1.0** response shape. The 2.0 API this project queries
 * returns `cve.references` as a plain array, so every CVE ended up with an
 * empty reference list and fell back to a generic NVD detail link.
 *
 * Verified against the live API on 2026-08-01 for CVE-2021-41773:
 *   typeof cve.references            -> Array
 *   cve.references.referenceData     -> undefined
 *
 * Fixed in Phase 1. Both shapes are now accepted, so a cached or proxied 1.0
 * response still produces links.
 */

/** Trimmed excerpt of a real NVD 2.0 response. */
const NVD_2_0_REFERENCES = [
  {
    url: 'http://packetstormsecurity.com/files/164418/Apache-HTTP-Server-2.4.49-Path-Traversal.html',
    source: 'security@apache.org',
    tags: ['Exploit', 'Third Party Advisory', 'VDB Entry'],
  },
  {
    url: 'https://httpd.apache.org/security/vulnerabilities_24.html',
    source: 'security@apache.org',
    tags: ['Vendor Advisory'],
  },
]

/** The legacy 1.0 shape the current implementation expects. */
const NVD_1_0_REFERENCES = {
  referenceData: [
    { url: 'https://httpd.apache.org/security/vulnerabilities_24.html', name: 'vendor' },
  ],
}

describe('NVD reference extraction', () => {
  it('extracts URLs from the NVD 2.0 array shape', () => {
    const result = references({ references: NVD_2_0_REFERENCES })
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('packetstormsecurity.com')
    expect(result[1]).toContain('httpd.apache.org')
  })

  it('still parses the legacy 1.0 shape', () => {
    expect(references({ references: NVD_1_0_REFERENCES })).toEqual([
      'https://httpd.apache.org/security/vulnerabilities_24.html',
    ])
  })

  it('returns an empty list when a CVE has no references', () => {
    expect(references({})).toEqual([])
    expect(references({ references: undefined })).toEqual([])
  })

  it('keeps supporting the legacy 1.0 shape after the fix', () => {
    expect(references({ references: NVD_1_0_REFERENCES })).toEqual([
      'https://httpd.apache.org/security/vulnerabilities_24.html',
    ])
  })

  it('caps the reference list at eight entries', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://example.com/${i}` }))
    expect(references({ references: many })).toHaveLength(8)
  })
})
