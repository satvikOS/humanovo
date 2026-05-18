import { defineConfig } from 'vitest/config'

// Vitest config for unit tests. Kept separate from vite.config.ts so the
// app build (tsc && vite build) is unaffected. The compute engine is pure
// TypeScript with no DOM dependencies in its math paths, so a node
// environment is sufficient.
export default defineConfig({
  define: { global: 'globalThis' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
