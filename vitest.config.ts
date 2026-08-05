import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration.
 *
 * The scan engine is plain TypeScript with no React dependency, so the default
 * Node environment is correct and keeps the suite fast. The `@/` alias mirrors
 * `tsconfig.json` so test files import modules exactly as source files do.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Network-touching integration tests are opt-in via `pnpm test:live`.
    exclude: ['tests/live/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['lib/**/*.ts'],
      exclude: ['lib/report/pdf.ts'],
    },
  },
})
