/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * Emit a self-contained server bundle. This lets the container ship only the
   * dependencies actually imported at runtime instead of the full node_modules
   * tree, which keeps the image substantially smaller.
   */
  output: 'standalone',

  images: {
    unoptimized: true,
  },

  /*
   * Playwright must not be traced into the standalone bundle. It resolves its
   * browser driver from its own package directory at runtime, and bundling it
   * breaks that lookup. It stays a regular runtime dependency instead.
   */
  serverExternalPackages: ['playwright', 'playwright-core'],

  /*
   * styled-components needs SWC's transform to work correctly with server
   * rendering. Without it, class names generated on the server do not match the
   * ones generated on the client and React logs a hydration mismatch.
   */
  compiler: {
    styledComponents: true,
  },
}

export default nextConfig
