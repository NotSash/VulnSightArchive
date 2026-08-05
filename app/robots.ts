import type { MetadataRoute } from 'next'

/**
 * Crawler policy.
 *
 * The marketing page should be indexable — it is how anyone finds the tool.
 * Everything else must not be:
 *
 * - `/api/*` are side-effecting endpoints. A crawler that follows a scan URL
 *   would start real scans against real hosts.
 * - `/scan/*` and `/results/*` contain a security assessment of somebody's
 *   website, keyed by an unguessable id. Indexing those would publish a list
 *   of weaknesses in third-party sites, which is precisely the harm this
 *   product exists to prevent.
 *
 * This is a request, not an access control — the ids are the actual defence,
 * and persistence (Phase 5) will add expiry on top.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/scan/', '/results/'],
      },
    ],
  }
}
