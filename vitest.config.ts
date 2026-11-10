import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tasks/**/*.test.ts'],
    exclude: ['vendor/**', 'node_modules/**', '**/dist/**'],
  },
})